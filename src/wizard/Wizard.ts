import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    MessageFlags,
    type EmbedBuilder,
    type InteractionWebhook,
    type Message,
    type MessageActionRowComponentBuilder,
    type MessageComponentInteraction,
    type RepliableInteraction,
    type TextBasedChannel,
} from 'discord.js';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'events';

import type {
    WizardChoice,
    WizardCompleteHandler,
    WizardContent,
    WizardContext,
    WizardDeliveryOptions,
    WizardMessageController,
    WizardMessageOptions,
    WizardNavigation,
    WizardOptions,
    WizardStep,
} from './types';

const WIZARD_PREFIX = 'wizard';
const MAX_ROWS = 5;
const MAX_BUTTON_CHOICES = 20;
const MAX_SELECT_CHOICES = 25;

type RenderedWizardMessage = WizardMessageOptions & {
    content?: string;
    embeds?: EmbedBuilder[];
    components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
};

/**
 * Runs a session-only, choice-driven Discord wizard.
 *
 * A wizard is a stateful navigation flow rather than a paginated menu. Each
 * step renders an embed and a set of choices. Selecting a choice records its
 * value under the current step ID and navigates to the next step. A Back
 * button returns through the visited steps and removes answers for steps that
 * were left behind.
 *
 * Wizards are not persisted. They stop on timeout, completion, explicit
 * deletion, or when their message disappears.
 *
 * @remarks
 * A wizard instance can manage only one message and can be initialized only
 * once. Create a new instance for each user session.
 *
 * @event wizardSent
 * Emitted after the wizard message is sent.
 *
 * @event stepChange
 * Emitted after a step is rendered. Receives the step and its ID.
 *
 * @event complete
 * Emitted after the final choice is selected.
 *
 * @event stop
 * Emitted when the wizard is explicitly stopped.
 *
 * @event delete
 * Emitted after the wizard message is deleted.
 *
 * @event end
 * Emitted when the component collector ends.
 *
 * @event wizardError
 * Emitted when an asynchronous wizard operation fails.
 */
export class Wizard extends EventEmitter {
    public readonly name: string;

    private readonly userId: string;
    private readonly steps: readonly WizardStep[];
    private readonly stepMap: Map<string, WizardStep>;
    private readonly firstStep: string;
    private readonly timeout: number;
    private readonly deleteOnTimeout: boolean;
    private readonly onComplete: WizardCompleteHandler | undefined;

    private readonly instanceId = randomUUID();
    private readonly answerMap: Record<string, string> = {};
    private readonly history: string[] = [];

    private stepId: string;
    private renderToken = 0;
    private renderedChoices: readonly WizardChoice[] = [];

    private message: Message | null = null;
    private messageController: WizardMessageController | null = null;
    private collector: ReturnType<
        Message['createMessageComponentCollector']
    > | null = null;
    private started = false;
    private stopped = false;

    /**
     * @param options - Configuration defining the owner, steps, timeout, and
     *                  completion handler.
     *
     * @throws {RangeError} If no steps are supplied or the timeout is invalid.
     * @throws {TypeError} If the owner or a step ID is empty.
     * @throws {Error} If step IDs are duplicated or a step references an
     *                 unknown step.
     */
    constructor(options: WizardOptions) {
        super();

        if (options.steps.length === 0) {
            throw new RangeError('A wizard must have at least one step.');
        }

        if (!options.userId.trim()) {
            throw new TypeError('userId must be present.');
        }

        this.name = options.name ?? 'wizard';
        this.userId = options.userId;
        this.steps = options.steps;
        this.timeout = options.timeout ?? 60_000;
        this.deleteOnTimeout = options.deleteOnTimeout ?? false;
        this.onComplete = options.onComplete;

        if (!Number.isFinite(this.timeout) || this.timeout <= 0) {
            throw new RangeError('timeout must be a positive number.');
        }

        this.stepMap = new Map<string, WizardStep>();

        for (const step of this.steps) {
            if (!step.id.trim()) {
                throw new TypeError('Step ID must not be empty.');
            }

            if (this.stepMap.has(step.id)) {
                throw new Error(`Duplicate step ID: "${step.id}".`);
            }

            this.stepMap.set(step.id, step);
        }

        this.firstStep = options.firstStep ?? this.steps[0]!.id;

        if (!this.stepMap.has(this.firstStep)) {
            throw new Error(`Unknown first step: "${this.firstStep}".`);
        }

        for (const step of this.steps) {
            if (
                step.next !== undefined &&
                step.next !== null &&
                !this.stepMap.has(step.next)
            ) {
                throw new Error(
                    `Step "${step.id}" points to unknown next step "${step.next}".`,
                );
            }
        }

        this.stepId = this.firstStep;
    }

    /** Getter for the step currently being displayed. */
    public get currentStep(): WizardStep {
        return this.stepMap.get(this.stepId)!;
    }

    /** ID of the step currently being displayed. */
    public get currentStepId(): string {
        return this.stepId;
    }

    /** Read-only snapshot of answers collected so far. */
    public get answers(): Readonly<Record<string, string>> {
        return { ...this.answerMap };
    }

    /** Wizard message backing the session, if initialized. */
    public get wizardMessage(): Message | null {
        return this.message;
    }

    /**
     * Sends the first step as the initial response to an interaction.
     *
     * @param interaction - Interaction to respond to.
     * @param delivery - Options controlling response visibility.
     * @param messageOptions - Additional message options managed by Discord.
     * @returns The Discord message associated with the wizard.
     */
    public async reply(
        interaction: RepliableInteraction,
        delivery: WizardDeliveryOptions = { ephemeral: true },
        messageOptions: WizardMessageOptions = {},
    ): Promise<Message> {
        this.assertNotStarted();

        if (interaction.replied) {
            throw new Error(
                'This interaction has already been replied to. Use followUp() instead.',
            );
        }

        const payload = await this.buildPayload(messageOptions);
        const ephemeral = delivery.ephemeral ?? true;

        if (interaction.deferred) {
            await interaction.editReply(payload);
        } else {
            await interaction.reply({
                ...payload,
                flags: ephemeral === false ? undefined : MessageFlags.Ephemeral,
            });
        }

        this.emit('wizardSent');

        const message = await interaction.fetchReply();

        return this.initializeMessage(
            message,
            interaction.deferred || ephemeral
                ? this.createWebhookController(interaction.webhook, '@original')
                : this.createMessageController(message),
        );
    }

    /**
     * Sends the first step as an interaction follow-up.
     *
     * @param interaction - Interaction to follow up on.
     * @param delivery - Options controlling response visibility.
     * @param messageOptions - Additional message options managed by Discord.
     * @returns The Discord message associated with the wizard.
     */
    public async followUp(
        interaction: RepliableInteraction,
        delivery: WizardDeliveryOptions = { ephemeral: true },
        messageOptions: WizardMessageOptions = {},
    ): Promise<Message> {
        this.assertNotStarted();

        const payload = await this.buildPayload(messageOptions);
        const ephemeral = delivery.ephemeral ?? true;

        const message = await interaction.followUp({
            ...payload,
            flags: ephemeral === false ? undefined : MessageFlags.Ephemeral,
        });

        this.emit('wizardSent');

        return this.initializeMessage(
            message,
            ephemeral
                ? this.createWebhookController(interaction.webhook, message.id)
                : this.createMessageController(message),
        );
    }

    /**
     * Sends the first step directly to a text-based channel.
     *
     * @param channel - Channel that receives the wizard message.
     * @param messageOptions - Additional message options managed by Discord.
     * @returns The Discord message associated with the wizard.
     */
    public async send(
        channel: TextBasedChannel,
        messageOptions: WizardMessageOptions = {},
    ): Promise<Message> {
        this.assertNotStarted();

        if (!channel.isSendable()) {
            throw new Error('This channel is not sendable.');
        }

        const message = await channel.send(
            await this.buildPayload(messageOptions),
        );

        this.emit('wizardSent');

        return this.initializeMessage(
            message,
            this.createMessageController(message),
        );
    }

    /**
     * Stops the wizard without deleting its message.
     *
     * Existing components are disabled and the `stop` event is emitted.
     */
    public async stop(): Promise<void> {
        if (!this.started) return;
        if (this.stopped) return;

        this.stopped = true;
        this.collector?.stop('wizard_stopped');

        try {
            await this.disableComponents();
        } finally {
            this.emit('stop');
        }
    }

    /**
     * Stops the wizard and deletes its message.
     *
     * @throws If deleting the Discord message fails.
     */
    public async delete(): Promise<void> {
        this.stopped = true;
        this.collector?.stop('wizard_deleted');

        if (this.message) {
            await this.messageController?.delete();
        }

        this.message = null;

        this.emit('delete');
    }

    private createWebhookController(
        webhook: InteractionWebhook,
        target: '@original' | string,
    ): WizardMessageController {
        return {
            edit: (options) =>
                webhook.editMessage(
                    target,
                    options as Parameters<InteractionWebhook['editMessage']>[1],
                ),
            delete: () => webhook.deleteMessage(target),
        };
    }

    private createMessageController(message: Message): WizardMessageController {
        return {
            edit: (options) => message.edit(options),
            delete: () => message.delete(),
        };
    }

    private assertNotStarted(): void {
        if (this.started) {
            throw new Error('This wizard has already been started.');
        }
    }

    private async initializeMessage(
        message: Message,
        controller: WizardMessageController,
    ): Promise<Message> {
        if (this.started) {
            throw new Error('This wizard has already been started.');
        }

        this.started = true;
        this.message = message;
        this.messageController = controller;

        this.collector = message.createMessageComponentCollector({
            time: this.timeout,
        });

        this.collector.on('collect', (interaction) => {
            void this.handleInteraction(interaction).catch((error: unknown) =>
                this.emit('wizardError', error),
            );
        });

        this.collector.on('end', (_collected, reason) => {
            this.stopped = true;
            this.emit('end');

            if (
                reason === 'messageDelete' ||
                reason === 'channelDelete' ||
                reason === 'threadDelete' ||
                reason === 'guildDelete'
            ) {
                this.message = null;
                this.messageController = null;
                return;
            }

            if (reason !== 'time') return;

            if (this.deleteOnTimeout) {
                void this.delete().catch((error: unknown) =>
                    this.emit('wizardError', error),
                );
            } else {
                void this.disableComponents().catch((error: unknown) =>
                    this.emit('wizardError', error),
                );
            }
        });

        this.emit('stepChange', this.currentStep, this.stepId);

        return message;
    }

    private async handleInteraction(
        interaction: MessageComponentInteraction,
    ): Promise<void> {
        if (interaction.user.id !== this.userId) {
            await interaction.reply({
                content: 'You cannot control this wizard.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        if (this.stopped) {
            await interaction.reply({
                content: 'This wizard has ended.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const action = this.parseAction(interaction);

        if (!action) {
            await interaction.reply({
                content: 'This step is no longer active.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        if (action.type === 'back') {
            await interaction.deferUpdate();
            await this.goBack();
            return;
        }

        const index =
            action.type === 'choice'
                ? action.index
                : interaction.isStringSelectMenu()
                  ? Number(interaction.values[0])
                  : Number.NaN;

        await interaction.deferUpdate();

        if (!Number.isInteger(index) || index < 0) return;

        await this.selectChoice(index, interaction);
    }

    private parseAction(
        interaction: MessageComponentInteraction,
    ):
        | { type: 'back' }
        | { type: 'choice'; index: number }
        | { type: 'select' }
        | null {
        const prefix = `${WIZARD_PREFIX}:${this.instanceId}:${this.renderToken}:`;

        if (!interaction.customId.startsWith(prefix)) return null;

        const action = interaction.customId.slice(prefix.length);

        if (action === 'back') return { type: 'back' };

        if (action === 'select' && interaction.isStringSelectMenu()) {
            return { type: 'select' };
        }

        if (action.startsWith('choice:')) {
            const index = Number(action.slice('choice:'.length));

            if (Number.isInteger(index) && index >= 0) {
                return { type: 'choice', index };
            }
        }

        return null;
    }

    private async selectChoice(
        index: number,
        interaction: MessageComponentInteraction,
    ): Promise<void> {
        const choice = this.renderedChoices[index];

        if (!choice) return;

        this.answerMap[this.stepId] = choice.value;

        const next =
            choice.next !== undefined ? choice.next : this.currentStep.next;

        if (next === undefined || next === null) {
            await this.complete(interaction);
            return;
        }

        await this.navigateTo(next);
    }

    private async navigateTo(stepId: string): Promise<void> {
        if (!this.stepMap.has(stepId)) {
            throw new Error(`Unknown wizard step: "${stepId}".`);
        }

        this.history.push(this.stepId);
        this.stepId = stepId;

        await this.renderCurrentStep();

        this.emit('stepChange', this.currentStep, this.stepId);
    }

    private async goBack(): Promise<void> {
        const previous = this.history.pop();

        if (previous === undefined) return;

        delete this.answerMap[this.stepId];
        this.stepId = previous;

        await this.renderCurrentStep();

        this.emit('stepChange', this.currentStep, this.stepId);
    }

    private async complete(
        interaction: MessageComponentInteraction,
    ): Promise<void> {
        this.stopped = true;
        this.collector?.stop('wizard_complete');
        this.emit('complete', { ...this.answerMap }, interaction);

        try {
            if (this.onComplete) {
                await this.onComplete({
                    wizard: this,
                    stepId: this.stepId,
                    answers: { ...this.answerMap },
                    interaction,
                });
            } else {
                await this.disableComponents();
            }
        } catch (error) {
            this.emit('wizardError', error);
        }
    }

    private async renderCurrentStep(): Promise<void> {
        const controller = this.messageController;

        if (!this.message || !controller) {
            throw new Error('The wizard message is unavailable.');
        }

        this.message = await controller.edit(await this.buildPayload());
    }

    private async buildPayload(
        messageOptions: WizardMessageOptions = {},
    ): Promise<RenderedWizardMessage> {
        const content = await this.renderContent();
        const choices = content.choices ?? [];
        const navigation = content.navigation ?? 'buttons';

        this.renderedChoices = choices;
        this.renderToken += 1;

        const rows = this.buildChoiceRows(
            choices,
            navigation,
            content.selectPlaceholder,
        );

        rows.push(this.buildBackRow());

        if (rows.length > MAX_ROWS) {
            throw new RangeError(
                `A wizard step can have at most ${MAX_ROWS} component rows.`,
            );
        }

        const embeds = [
            ...(content.embed ? [content.embed] : []),
            ...(content.embeds ?? []),
        ];

        return {
            ...messageOptions,
            ...(content.content === undefined
                ? {}
                : { content: content.content }),
            ...(embeds.length === 0 ? {} : { embeds }),
            components: rows,
        };
    }

    private async renderContent(): Promise<WizardContent> {
        const content = await this.currentStep.render(this.createContext());

        const values = new Set<string>();

        for (const choice of content.choices ?? []) {
            if (values.has(choice.value)) {
                throw new Error(
                    `Duplicate choice value "${choice.value}" on step "${this.stepId}".`,
                );
            }

            values.add(choice.value);

            const next =
                choice.next !== undefined ? choice.next : this.currentStep.next;

            if (
                next !== undefined &&
                next !== null &&
                !this.stepMap.has(next)
            ) {
                throw new Error(
                    `Step "${this.stepId}" points to unknown next step "${next}".`,
                );
            }
        }

        return content;
    }

    private buildChoiceRows(
        choices: readonly WizardChoice[],
        navigation: WizardNavigation,
        selectPlaceholder: string | undefined,
    ): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
        if (navigation === 'select') {
            if (choices.length > MAX_SELECT_CHOICES) {
                throw new RangeError(
                    `Select steps can have at most ${MAX_SELECT_CHOICES} choices.`,
                );
            }

            if (choices.length === 0) return [];

            const select = new StringSelectMenuBuilder()
                .setCustomId(this.createCustomId('select'))
                .setPlaceholder(selectPlaceholder ?? 'Select an option')
                .setMinValues(1)
                .setMaxValues(1)
                .addOptions(
                    choices.map((choice, index) => ({
                        label: choice.label,
                        value: String(index),
                        ...(choice.description === undefined
                            ? {}
                            : { description: choice.description }),
                        ...(choice.emoji === undefined
                            ? {}
                            : { emoji: choice.emoji }),
                        ...(choice.disabled === undefined
                            ? {}
                            : { disabled: choice.disabled }),
                    })),
                );

            return [
                new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
                    select,
                ),
            ];
        }

        if (choices.length > MAX_BUTTON_CHOICES) {
            throw new RangeError(
                `Button steps can have at most ${MAX_BUTTON_CHOICES} choices because one row is reserved for Back.`,
            );
        }

        const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];

        for (let offset = 0; offset < choices.length; offset += 5) {
            const chunk = choices.slice(offset, offset + 5);
            const buttons = chunk.map((choice, index) => {
                const button = new ButtonBuilder()
                    .setCustomId(
                        this.createCustomId(`choice:${offset + index}`),
                    )
                    .setLabel(choice.label)
                    .setStyle(choice.style ?? ButtonStyle.Secondary)
                    .setDisabled(choice.disabled ?? false);

                if (choice.emoji !== undefined) {
                    button.setEmoji(choice.emoji);
                }

                return button;
            });

            rows.push(
                new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
                    buttons,
                ),
            );
        }

        return rows;
    }

    private buildBackRow(): ActionRowBuilder<MessageActionRowComponentBuilder> {
        return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(this.createCustomId('back'))
                .setLabel('Back')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(this.history.length === 0),
        );
    }

    private createCustomId(action: string): string {
        return `${WIZARD_PREFIX}:${this.instanceId}:${this.renderToken}:${action}`;
    }

    private createContext(
        interaction?: MessageComponentInteraction,
    ): WizardContext {
        return {
            wizard: this,
            stepId: this.stepId,
            answers: { ...this.answerMap },
            ...(interaction === undefined ? {} : { interaction }),
        };
    }

    private async disableComponents(): Promise<void> {
        const controller = this.messageController;

        if (!this.message || !controller) return;

        const payload = await this.buildPayload();
        const rows = payload.components.map((row) =>
            new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
                row.components.map((component) =>
                    this.disableComponent(component),
                ),
            ),
        );

        this.message = await controller.edit({ components: rows });
    }

    private disableComponent(
        component: MessageActionRowComponentBuilder,
    ): MessageActionRowComponentBuilder {
        if (component instanceof ButtonBuilder) {
            return ButtonBuilder.from(component).setDisabled(true);
        }

        if (component instanceof StringSelectMenuBuilder) {
            return StringSelectMenuBuilder.from(component).setDisabled(true);
        }

        throw new Error(
            `Unsupported component type: ${component.data.type ?? 'unknown'}`,
        );
    }
}
