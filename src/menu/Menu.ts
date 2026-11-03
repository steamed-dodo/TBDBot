import {
    Message,
    type RepliableInteraction,
    MessageFlags,
    type TextBasedChannel,
    MessageComponentInteraction,
    ButtonInteraction,
    ActionRowBuilder,
    type MessageActionRowComponentBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    UserSelectMenuBuilder,
    RoleSelectMenuBuilder,
    MentionableSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    InteractionWebhook,
    type StringSelectMenuInteraction,
} from 'discord.js';
import { EventEmitter } from 'events';
import type {
    MenuPage,
    MenuOptions,
    MenuAccess,
    MenuDeliveryOptions,
    MenuMessageOptions,
    MenuNavigation,
    NavigationAction,
    CompatibleMessageOptions,
    MenuMessageController,
} from './types';

const NAV_PREFIX = 'menu:navigation';
const NAV_PREVIOUS = `${NAV_PREFIX}previous`;
const NAV_NEXT = `${NAV_PREFIX}next`;
const NAV_SELECT = `${NAV_PREFIX}select`;
const NAV_BACK = `${NAV_PREFIX}back`;

/**
 * Manages a paginated Discord menu with interactive navigation controls.
 *
 * A menu consists of one or more pages, each containing an embed and
 * optional custom components. The menu adds Previous, Next, and Stop
 * buttons automatically and collects component interactions until it
 * is stopped or its configured timeout expires.
 *
 * The class extends {@link EventEmitter} to expose lifecycle events,
 * including `pageChange`, `stop`, `delete`, and `end`.
 *
 * @remarks
 * A menu instance can manage only one message and can be initialized
 * only once. Create a new instance if another menu message is required.
 *
 * @event pageChange
 * Emitted after the page-change callback has been attempted.
 * Receives the active {@link MenuPage} and its zero-based index.
 * Callback failures are reported through menuError and do not
 * prevent this event from being emitted.
 *
 * @event menuSent
 * Emitted when the menu is sent through either .reply(), .followUp() or .send().
 *
 * @event stop
 * Emitted when the menu is explicitly stopped.
 *
 * @event delete
 * Emitted after the menu's deletion operation completes successfully.
 *
 * @event end
 * Emitted when the component collector ends, whether due to timeout
 * or another reason.
 *
 * @event menuError
 * Emitted when an asynchronous menu operation fails.
 * Receives the error as its argument.
 */
export class Menu extends EventEmitter {
    readonly name: string;

    private readonly userId: string;
    private readonly pages: readonly MenuPage[];
    private readonly timeout: number;
    private readonly deleteOnTimeout: boolean;
    private readonly onPageChange: MenuOptions['onPageChange'];
    private readonly navigation: MenuNavigation;

    private readonly access: MenuAccess;

    private pageIndex = 0;
    private readonly pageHistory: number[] = [];
    private pageChangeQueue: Promise<void> = Promise.resolve();

    private message: Message | null = null;
    private messageController: MenuMessageController | null = null;
    private collector: ReturnType<
        Message['createMessageComponentCollector']
    > | null = null;
    private started = false;
    private stopped = false;

    /**
     * Creates a menu and validates its configuration.
     *
     * @param options - Configuration defining the owner, pages, timeout,
     *                  access policy, and optional callbacks.
     *
     * @throws {RangeError} If no pages are supplied or the timeout is not
     *                      a finite positive number.
     * @throws {TypeError} If the owner ID or a page name is empty.
     * @throws {Error} If page names are duplicated or a custom component uses
     *                  the reserved navigation prefix.
     */
    constructor(options: MenuOptions) {
        super();

        if (options.pages.length === 0) {
            throw new RangeError('A menu must have at least one page.');
        }

        if (!options.userId.trim()) {
            throw new TypeError('userId must be present.');
        }

        this.name = options.name;

        this.userId = options.userId;
        this.pages = options.pages;
        this.timeout = options.timeout ?? 180_000;
        this.deleteOnTimeout = options.deleteOnTimeout ?? false;
        this.onPageChange = options.onPageChange;
        this.navigation = options.navigation ?? 'prev-next';

        this.access = options.access ?? { type: 'caller-only' };

        if (!Number.isFinite(this.timeout) || this.timeout <= 0) {
            throw new RangeError('timeout must be a positive number.');
        }

        const navigationRows = this.navigation === 'prev-select-next' ? 2 : 1;
        const maxCustomRows = 5 - navigationRows;
        const names = new Set<string>();

        for (const page of this.pages) {
            if (!page.name.trim()) {
                throw new TypeError('Page name must not be empty.');
            }

            if (names.has(page.name)) {
                throw new Error(`Duplicate page name: "${page.name}".`);
            }

            names.add(page.name);

            if ((page.components?.length ?? 0) > maxCustomRows) {
                throw new RangeError(
                    `Pages can have at most ${maxCustomRows} custom rows, "${page.name}" has ${page.components?.length}`,
                );
            }

            for (const row of page.components ?? []) {
                for (const component of row.components) {
                    if (
                        'custom_id' in component.data &&
                        typeof component.data.custom_id === 'string' &&
                        component.data.custom_id.startsWith(NAV_PREFIX)
                    ) {
                        throw new Error(
                            `Custom component IDs must not use "${NAV_PREFIX}".`,
                        );
                    }
                }
            }
        }
    }

    /**
     * Gets the currently active page.
     *
     * @returns The page at the current zero-based page index.
     */
    public get currentPage(): MenuPage {
        return this.pages[this.pageIndex]!;
    }

    /**
     * Gets the zero-based index of the currently active page.
     *
     * @returns The active page index.
     */
    public get currentPageIndex(): number {
        return this.pageIndex;
    }

    /**
     * Gets the Discord message associated with this menu.
     *
     * @returns The menu message, or `null` if the menu has not been initialized
     *          or its message reference has been cleared.
     */
    public get menuMessage(): Message | null {
        return this.message;
    }

    /**
     * Sends the menu as the initial response to an interaction.
     *
     * If the interaction has already been deferred, its existing response
     * is edited through the interaction webhook. This preserves the response
     * visibility that was chosen when it was deferred.
     *
     * @param interaction - The interaction to respond to.
     * @param delivery - Options controlling response visibility. (keep in mind that if the interaction was defered the visibility that was set can't be changed)
     * @param messageOptions - Additional message options, excluding embeds,
     *                         components, and flags managed by the menu.
     * @returns The Discord message associated with the menu.
     *
     * @throws {Error} If the interaction has already been replied to.
     * @throws {Error} If this menu instance has already been initialized.
     * @throws If Discord rejects the response or message initialization fails.
     */
    public async reply(
        interaction: RepliableInteraction,
        delivery: MenuDeliveryOptions = { ephemeral: true },
        messageOptions: MenuMessageOptions = {},
    ): Promise<Message> {
        this.assertNotStarted();

        const payload = this.buildPayload(messageOptions);

        const ephemeral = delivery.ephemeral ?? true;

        if (interaction.replied) {
            throw new Error(
                'This interaction has already been replied to. Use followUp() instead.',
            );
        }

        if (interaction.deferred) {
            await interaction.editReply(payload);
        } else {
            await interaction.reply({
                ...payload,
                flags: ephemeral === false ? undefined : MessageFlags.Ephemeral,
            });
        }

        this.emit('menuSent');

        const message = await interaction.fetchReply();

        return await this.initializeMessage(
            message,
            interaction.deferred || ephemeral
                ? this.createWebhookController(interaction.webhook, '@original')
                : this.createMessageController(message),
        );
    }

    /**
     * Sends the menu as an additional interaction follow-up.
     *
     * @param interaction - The interaction to follow up on.
     * @param delivery - Options controlling response visibility. (keep in mind that if the interaction was defered the visibility that was set can't be changed)
     * @param messageOptions - Additional message options managed by Discord.
     * @returns The resulting Discord message.
     *
     * @throws If Discord rejects the follow-up or this menu cannot be initialized.
     */
    public async followUp(
        interaction: RepliableInteraction,
        delivery: MenuDeliveryOptions = { ephemeral: true },
        messageOptions: MenuMessageOptions = {},
    ): Promise<Message> {
        this.assertNotStarted();

        const payload = this.buildPayload(messageOptions);

        const message = await interaction.followUp({
            ...payload,
            flags:
                delivery.ephemeral === false
                    ? undefined
                    : MessageFlags.Ephemeral,
        });

        this.emit('menuSent');

        return await this.initializeMessage(
            message,
            delivery.ephemeral
                ? this.createWebhookController(interaction.webhook, message.id)
                : this.createMessageController(message),
        );
    }

    /**
     * Sends the menu directly to a text-based Discord channel.
     *
     * @param channel - A channel that supports sending messages.
     * @param messageOptions - Additional message options managed by Discord.
     * @returns The resulting Discord message.
     *
     * @throws {Error} If the channel is not sendable.
     * @throws If sending the message or initializing the menu fails.
     */
    public async send(
        channel: TextBasedChannel,
        messageOptions: MenuMessageOptions = {},
    ): Promise<Message> {
        this.assertNotStarted();

        if (!channel.isSendable()) {
            throw new Error('This channel is not sendable.');
        }
        const message = await channel.send(this.buildPayload(messageOptions));

        this.emit('menuSent');

        return await this.initializeMessage(
            message,
            this.createMessageController(message),
        );
    }

    /**
     * Changes the active page and updates the menu message.
     *
     * @param index - Zero-based index of the page to display.
     * @returns A promise that resolves when the message edit and page-change
     *          notification have completed.
     *
     * @throws {Error} If the menu has not been initialized or has stopped.
     * @throws {RangeError} If the index is not a valid page index.
     * @throws If the Discord message edit or page-change notification fails.
     */
    public async setPage(index: number): Promise<void> {
        return this.queuePageChange(() => this.performPageChange(index));
    }

    /**
     * Returns to the previously visited page.
     *
     * This is primarily useful for `wizard` menus, where the built-in Back
     * button uses the recorded navigation history. If no previous page exists,
     * the call does nothing.
     *
     * @returns A promise that resolves when the page change completes.
     */
    public async back(): Promise<void> {
        return this.stepBack();
    }

    /**
     * Stops the menu without deleting its message.
     *
     * Stops collecting interactions and emits the `stop` event.
     * Existing message components are automatically disabled.
     *
     * @returns A promise that resolves when the stop operation completes.
     */
    public async stop(): Promise<void> {
        if (!this.started) return;
        if (this.stopped) return;

        this.stopped = true;
        this.collector?.stop('menu_stopped');

        try {
            await this.disableComponents();
        } finally {
            this.emit('stop');
        }
    }

    /**
     * Stops the menu and deletes its associated message, if present.
     *
     * Clears the stored message reference after attempting deletion.
     * Emits the `delete` event after the deletion operation completes.
     *
     * @returns A promise that resolves when deletion and event emission complete.
     *
     * @throws If deleting the Discord message fails.
     */
    public async delete(): Promise<void> {
        this.stopped = true;
        this.collector?.stop('menu_deleted');

        const message = this.message;

        if (message) {
            await this.messageController?.delete();
        }

        this.message = null;

        this.emit('delete');
    }

    private createWebhookController(
        webhook: InteractionWebhook,
        target: '@original' | string,
    ): MenuMessageController {
        return {
            edit: (options) =>
                webhook.editMessage(
                    target,
                    options as Parameters<InteractionWebhook['editMessage']>[1],
                ),
            delete: () => webhook.deleteMessage(target),
        };
    }

    private createMessageController(message: Message): MenuMessageController {
        return {
            edit: (options) => message.edit(options),
            delete: () => message.delete(),
        };
    }

    private assertNotStarted(): void {
        if (this.started) {
            throw new Error('This menu has already been started.');
        }
    }

    private queuePageChange(operation: () => Promise<void>): Promise<void> {
        const queued = this.pageChangeQueue.then(operation);

        this.pageChangeQueue = queued.catch(() => undefined);

        return queued;
    }

    private stepPage(delta: number): Promise<void> {
        return this.queuePageChange(async () => {
            const target = this.pageIndex + delta;

            if (target < 0 || target >= this.pages.length) return;

            await this.performPageChange(target);
        });
    }

    private stepBack(): Promise<void> {
        return this.queuePageChange(async () => {
            const previous = this.pageHistory.pop();

            if (previous === undefined) return;

            try {
                await this.performPageChange(previous, false);
            } catch (error) {
                this.pageHistory.push(previous);
                throw error;
            }
        });
    }

    private async performPageChange(
        index: number,
        recordHistory = true,
    ): Promise<void> {
        if (!this.message) {
            throw new Error('Start the menu before changing pages.');
        }

        if (this.stopped) {
            throw new Error('This menu has stopped.');
        }

        if (
            !Number.isInteger(index) ||
            index < 0 ||
            index >= this.pages.length
        ) {
            throw new RangeError(`Invalid page index: ${index}.`);
        }

        const page = this.pages[index]!;
        const controller = this.messageController;

        if (!controller) {
            throw new Error('The menu message controller is unavailable.');
        }

        const previousIndex = this.pageIndex;
        const shouldRecordHistory = recordHistory && index !== previousIndex;

        if (shouldRecordHistory) {
            this.pageHistory.push(previousIndex);
        }

        try {
            this.message = await controller.edit({
                embeds: [page.embed],
                components: this.buildComponents(index),
            });
        } catch (error) {
            if (shouldRecordHistory) {
                this.pageHistory.pop();
            }

            throw new Error(
                'There was an issue updating the message to new page',
                {
                    cause: error,
                },
            );
        }

        this.pageIndex = index;

        if (this.stopped) {
            await this.disableComponents();
            return;
        }

        await this.notifyPageChange();
    }

    private async handleInteraction(
        interaction: MessageComponentInteraction,
    ): Promise<void> {
        if (!(await this.canInteract(interaction))) {
            await interaction.reply({
                content: 'You cannot control this menu.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        if (this.stopped) {
            await interaction.reply({
                content: 'This menu has ended.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        if (interaction.customId.startsWith(NAV_PREFIX)) {
            if (interaction.isButton()) {
                await this.handleNavigation(interaction);
                return;
            }

            if (interaction.isStringSelectMenu()) {
                await this.handlePageSelect(interaction);
                return;
            }

            await interaction.deferUpdate();
            return;
        }

        const handler = this.currentPage.onInteraction;

        if (!handler) {
            await interaction.reply({
                content: 'This component has no action handler.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        try {
            await handler(interaction, this);
        } catch (error) {
            this.emit('menuError', error);

            if (!interaction.replied && !interaction.deferred) {
                await interaction
                    .reply({
                        content:
                            'An error occurred while handling this interaction.',
                        flags: MessageFlags.Ephemeral,
                    })
                    .catch((replyError: unknown) => {
                        this.emit('menuError', replyError);
                    });
            }
        }
    }

    private async canInteract(
        interaction: MessageComponentInteraction,
    ): Promise<boolean> {
        switch (this.access?.type) {
            case 'caller-only':
                return interaction.user.id === this.userId;

            case 'everyone':
                return true;

            case 'custom':
                try {
                    return await this.access.filter(interaction);
                } catch (error) {
                    this.emit('menuError', error);
                    return interaction.user.id === this.userId;
                }
        }
    }

    private async handleNavigation(
        interaction: ButtonInteraction,
    ): Promise<void> {
        const action = interaction.customId.slice(
            NAV_PREFIX.length,
        ) as NavigationAction;

        if (action !== 'previous' && action !== 'next' && action !== 'back') {
            await interaction.deferUpdate();
            return;
        }

        await interaction.deferUpdate();

        switch (action) {
            case 'previous':
                await this.stepPage(-1);
                break;

            case 'next':
                await this.stepPage(1);
                break;

            case 'back':
                await this.stepBack();
                break;
        }
    }

    private async handlePageSelect(
        interaction: StringSelectMenuInteraction,
    ): Promise<void> {
        const value = interaction.values[0];
        const index = Number(value);

        await interaction.deferUpdate();

        if (
            !Number.isInteger(index) ||
            index < 0 ||
            index >= this.pages.length
        ) {
            return;
        }

        await this.setPage(index);
    }

    private buildPayload(
        messageOptions: MenuMessageOptions,
    ): CompatibleMessageOptions {
        return {
            ...messageOptions,
            embeds: [this.currentPage.embed],
            components: this.buildComponents(),
        };
    }

    private buildComponents(
        index: number = this.pageIndex,
    ): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
        const pageRows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = (
            this.pages[index]!.components ?? []
        ).map((row) =>
            ActionRowBuilder.from<MessageActionRowComponentBuilder>(row),
        );

        return [...pageRows, ...this.buildNavigationRows(index)];
    }

    private buildNavigationRows(
        index: number,
    ): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
        switch (this.navigation) {
            case 'select':
                return [this.buildPageSelect(index)];

            case 'prev-select-next':
                return [
                    this.buildPageSelect(index),
                    this.buildPreviousNextButtons(index),
                ];

            case 'wizard':
                return [this.buildBackButton()];

            case 'prev-next':
            default:
                return [this.buildPreviousNextButtons(index)];
        }
    }

    private buildPreviousNextButtons(
        index: number,
    ): ActionRowBuilder<MessageActionRowComponentBuilder> {
        return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(NAV_PREVIOUS)
                .setLabel('Previous')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(index === 0),
            new ButtonBuilder()
                .setCustomId(NAV_NEXT)
                .setLabel('Next')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(index === this.pages.length - 1),
        );
    }

    private buildBackButton(): ActionRowBuilder<MessageActionRowComponentBuilder> {
        return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(NAV_BACK)
                .setLabel('Back')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(this.pageHistory.length === 0),
        );
    }

    private buildPageSelect(
        index: number,
    ): ActionRowBuilder<MessageActionRowComponentBuilder> {
        const select = new StringSelectMenuBuilder()
            .setCustomId(NAV_SELECT)
            .setPlaceholder('Go to page')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(
                this.pages.map((page, pageIndex) => ({
                    label: page.name,
                    value: String(pageIndex),
                    default: pageIndex === index,
                })),
            );

        return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
            select,
        );
    }

    private async notifyPageChange(): Promise<void> {
        try {
            await this.onPageChange?.(this.currentPage, this.pageIndex);
        } catch (error) {
            this.emit('menuError', error);
        }
        this.emit('pageChange', this.currentPage, this.pageIndex);
    }

    private async disableComponents(): Promise<void> {
        const controller = this.messageController;

        if (!this.message || !controller) return;

        const rows = this.buildComponents(this.pageIndex).map((row) => {
            const components = row.components.map((component) =>
                this.disableComponent(component),
            );

            return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
                components,
            );
        });

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

        if (component instanceof UserSelectMenuBuilder) {
            return UserSelectMenuBuilder.from(component).setDisabled(true);
        }

        if (component instanceof RoleSelectMenuBuilder) {
            return RoleSelectMenuBuilder.from(component).setDisabled(true);
        }

        if (component instanceof MentionableSelectMenuBuilder) {
            return MentionableSelectMenuBuilder.from(component).setDisabled(
                true,
            );
        }

        if (component instanceof ChannelSelectMenuBuilder) {
            return ChannelSelectMenuBuilder.from(component).setDisabled(true);
        }

        throw new Error(
            `Unsupported component type: ${component.data.type ?? 'unknown'}`,
        );
    }

    private async initializeMessage(
        message: Message,
        messageController: MenuMessageController,
    ): Promise<Message> {
        if (this.started) {
            throw new Error('This menu has already been started.');
        }

        this.started = true;
        this.message = message;
        this.messageController = messageController;

        this.collector = message.createMessageComponentCollector({
            time: this.timeout,
        });

        this.collector.on('collect', (interaction) => {
            void this.handleInteraction(interaction).catch((error: unknown) =>
                this.emit('menuError', error),
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
                    this.emit('menuError', error),
                );
            } else {
                void this.disableComponents().catch((error: unknown) =>
                    this.emit('menuError', error),
                );
            }
        });

        await this.notifyPageChange();

        return message;
    }
}
