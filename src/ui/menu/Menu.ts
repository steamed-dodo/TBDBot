import type { API } from '@discordjs/core';
import { MessageFlags } from 'discord-api-types/v10';

import type { Interaction } from '../../interaction/types';
import { createReservedAction, generateRoutingId } from '../ids';
import type { MessageTarget } from '../messages';
import { deleteTarget, editTarget, sendChannelMessage } from '../messages';
import { navigationSelect, renderContent } from '../render';
import type { WidgetRouter } from '../router';
import type {
    ActionContext,
    ComponentRow,
    ComponentSpec,
    RenderedContent,
    Widget,
} from '../types';
import type {
    Choice,
    MenuAccess,
    MenuNavigation,
    MenuOptions,
    MenuState,
    Step,
    StepContext,
} from './types';

/** Action prefix used by the menu for choice buttons. */
const CHOICE_ACTION_PREFIX = 'choice:';

/**
 * The unified menu and wizard widget.
 *
 * A wizard is a menu with branching steps and answer capture; both are
 * configurations of this class, so there is a single object model to learn
 * and a single rendering path to maintain.
 */
export class Menu implements Widget<MenuState> {
    /** Name used for diagnostics. */
    public readonly name: string;

    /** Public identity of the menu. */
    public readonly id: string;

    /** Short, framework-generated identity used for routing. */
    public readonly routingId: string;

    /** Discord user ID allowed to operate the menu. */
    public readonly userId: string | undefined;

    /** Whether the menu behaves like a menu or a wizard. */
    public readonly mode: 'menu' | 'wizard';

    /** Navigation chrome rendered alongside the active step. */
    public readonly navigation: MenuNavigation;

    /** Policy controlling which users may interact with the menu. */
    public readonly access: MenuAccess;

    /** Maximum duration of the menu, in milliseconds. */
    public readonly timeout: number;

    /** Whether the menu message is deleted when the timeout elapses. */
    public readonly deleteOnTimeout: boolean;

    /** Namespace used for the menu's custom ids. */
    public readonly namespace: string;

    /**
     * The type used to look up the factory that recreates the menu.
     *
     * @defaultValue 'menu'
     */
    public readonly type: string;

    /** ID of the Discord message backing the menu, when sent. */
    public messageId: string | null = null;

    /** ID of the channel containing the menu's message, when sent. */
    public channelId: string | null = null;

    /** ID of the guild containing the menu's message, when sent. */
    public guildId: string | null = null;

    private readonly api: API;

    private readonly steps: readonly Step[];

    private readonly stepById: Map<string, Step>;

    private readonly options: MenuOptions;

    private currentStepId: string;

    private answers: Record<string, string> = {};

    private history: string[];

    private completed = false;

    private target: MessageTarget | null = null;

    private router: WidgetRouter | null = null;

    private timer: ReturnType<typeof setTimeout> | null = null;

    private closed = false;

    /**
     * @param options - Menu configuration.
     */
    constructor(options: MenuOptions) {
        if (!options.steps || options.steps.length === 0) {
            throw new TypeError('A menu must define at least one step.');
        }

        if (!options.api) {
            throw new TypeError('A menu requires a REST facade.');
        }

        this.options = options;
        this.api = options.api;
        this.steps = options.steps;
        this.name = options.name ?? 'menu';
        this.mode = options.mode ?? 'menu';
        this.userId = options.userId;
        this.access = options.access ?? { type: 'caller-only' };
        this.timeout = options.timeout ?? 180_000;
        this.deleteOnTimeout = options.deleteOnTimeout ?? false;
        this.namespace = options.namespace ?? 'ui';
        this.type = options.type ?? 'menu';
        this.navigation =
            options.navigation ??
            (this.mode === 'wizard' ? 'wizard' : 'prev-next');

        this.stepById = new Map();

        for (const step of options.steps) {
            if (!step.id) {
                throw new TypeError('Every step must have an id.');
            }

            if (this.stepById.has(step.id)) {
                throw new TypeError(`Duplicate step id: "${step.id}".`);
            }

            this.stepById.set(step.id, step);
        }

        const firstStep = options.firstStep ?? options.steps[0]?.id;

        if (!firstStep || !this.stepById.has(firstStep)) {
            throw new TypeError(`Unknown first step: "${firstStep ?? ''}".`);
        }

        this.currentStepId = firstStep;
        this.history = [firstStep];
        this.routingId = options.routingId ?? generateRoutingId();
        this.id = options.id ?? this.routingId;
    }

    /** Current state of the menu. */
    public get state(): MenuState {
        return {
            currentStepId: this.currentStepId,
            answers: { ...this.answers },
            history: [...this.history],
            completed: this.completed,
        };
    }

    /** The step currently displayed. */
    public get currentStep(): Step {
        const step = this.stepById.get(this.currentStepId);

        if (!step) {
            throw new Error(`Unknown step: "${this.currentStepId}".`);
        }

        return step;
    }

    /** Answers collected so far. */
    public get collectedAnswers(): Readonly<Record<string, string>> {
        return { ...this.answers };
    }

    /** Whether the flow has been completed. */
    public get isCompleted(): boolean {
        return this.completed;
    }

    /** Where the menu's message lives, when it has been sent. */
    public get messageTarget(): MessageTarget | null {
        return this.target;
    }

    /**
     * Renders the active step together with the navigation chrome.
     *
     * @returns The content displayed by the menu.
     */
    public async render(): Promise<RenderedContent> {
        const step = this.currentStep;
        const context = this.createContext();
        const content = await step.render(context);

        const rows: ComponentRow[] = [...(content.components ?? [])];

        for (const row of this.buildChoiceRows(step)) {
            rows.push(row);
        }

        for (const row of this.buildNavigationRows()) {
            rows.push(row);
        }

        if (rows.length > 5) {
            throw new RangeError(
                `A menu may not render more than 5 action rows, but ${rows.length} were produced.`,
            );
        }

        return {
            ...(content.content === undefined
                ? {}
                : { content: content.content }),
            ...(content.embeds === undefined ? {} : { embeds: content.embeds }),
            ...(rows.length === 0 ? {} : { components: rows }),
        };
    }

    /**
     * Handles a user-defined action dispatched to the active step.
     *
     * @param action - The user-defined action.
     * @param context - Context describing the triggering interaction.
     */
    public async onAction(
        action: string,
        context: ActionContext,
    ): Promise<void> {
        const step = this.currentStep;

        if (!step.onAction) {
            return;
        }

        await step.onAction(action, this.createContext(context.interaction));
    }

    /**
     * Handles a reserved navigation action.
     *
     * @param action - The reserved action, without the marker.
     * @param context - Context describing the triggering interaction.
     */
    public async onNavigation(
        action: string,
        context: ActionContext,
    ): Promise<void> {
        if (action.startsWith(CHOICE_ACTION_PREFIX)) {
            await this.handleChoice(
                action.slice(CHOICE_ACTION_PREFIX.length),
                context,
            );

            return;
        }

        switch (action) {
            case 'next':
                await this.goToNext(context);
                break;
            case 'previous':
                await this.goToPrevious(context);
                break;
            case 'back':
                await this.goBack(context);
                break;
            case 'select':
                await this.handleSelect(context);
                break;
            default:
                break;
        }
    }

    /**
     * Navigates to a specific step.
     *
     * @param stepId - ID of the step to display.
     * @param context - Context describing the triggering interaction.
     */
    public async setStep(
        stepId: string,
        context?: ActionContext,
    ): Promise<void> {
        if (!this.stepById.has(stepId)) {
            throw new TypeError(`Unknown step: "${stepId}".`);
        }

        this.currentStepId = stepId;
        this.history.push(stepId);

        await this.refresh(context);
    }

    /**
     * Sends the menu to a channel.
     *
     * @param channelId - Channel to send the menu to.
     * @param router - Router used to register the menu.
     * @returns The ID of the created message.
     */
    public async send(
        channelId: string,
        router?: WidgetRouter,
    ): Promise<string> {
        const content = await this.render();
        const message = renderContent(content, this.namespace, this.routingId);
        const created = await sendChannelMessage(this.api, channelId, message);

        this.target = {
            kind: 'channel',
            channelId,
            messageId: created.id,
        };

        await this.register(router);
        this.startTimeout();

        return created.id;
    }

    /**
     * Replies to an interaction with the menu.
     *
     * @param interaction - The interaction to reply to.
     * @param options - Delivery options.
     * @param router - Router used to register the menu.
     */
    public async reply(
        interaction: Interaction,
        options: { readonly ephemeral?: boolean } = {},
        router?: WidgetRouter,
    ): Promise<void> {
        const content = await this.render();
        const message = renderContent(content, this.namespace, this.routingId);

        await interaction.reply({
            ...message,
            ...(options.ephemeral === false
                ? {}
                : { flags: MessageFlags.Ephemeral }),
        });

        this.target = {
            kind: 'interaction',
            applicationId: interaction.applicationId,
            token: interaction.token,
            interactionId: interaction.id,
        };

        await this.register(router);
        this.startTimeout();
    }

    /**
     * Re-renders the menu and pushes the result to its message.
     *
     * @param context - Context describing the triggering interaction.
     */
    public async refresh(_context?: ActionContext): Promise<void> {
        if (!this.target) {
            return;
        }

        const content = await this.render();
        const message = renderContent(content, this.namespace, this.routingId);

        await editTarget(this.api, this.target, message);
    }

    /**
     * Returns the state that should be persisted.
     *
     * A menu that is persisted this way is restored with
     * {@link Menu.restore}, which is what makes a persistent menu possible.
     *
     * @returns The serialisable state of the menu.
     */
    public serialize(): MenuState {
        return this.state;
    }

    /**
     * Restores the menu from a persisted state.
     *
     * @param state - The state produced by {@link Menu.serialize}.
     */
    public restore(state: Partial<MenuState>): void {
        if (state.currentStepId && this.stepById.has(state.currentStepId)) {
            this.currentStepId = state.currentStepId;
        }

        if (state.answers) {
            this.answers = { ...state.answers };
        }

        if (state.history) {
            this.history = [...state.history];
        }

        if (state.completed !== undefined) {
            this.completed = state.completed;
        }
    }

    /**
     * Closes the menu, deleting its message when requested.
     */
    public async close(): Promise<void> {
        if (this.closed) {
            return;
        }

        this.closed = true;
        this.stopTimeout();

        if (this.target?.kind === 'channel' && this.deleteOnTimeout) {
            await deleteTarget(this.api, this.target).catch(() => undefined);
        }

        this.router?.unregister(this.routingId);
        this.target = null;
    }

    private async register(router?: WidgetRouter): Promise<void> {
        if (!router) {
            return;
        }

        this.router = router;

        await router.register(this as Widget<MenuState>, this.target);
    }

    private startTimeout(): void {
        if (this.timeout <= 0 || this.timer) {
            return;
        }

        this.timer = setTimeout(() => {
            void this.close();
        }, this.timeout);

        this.timer.unref?.();
    }

    private stopTimeout(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    private createContext(interaction?: Interaction): StepContext {
        return {
            menu: this,
            stepId: this.currentStepId,
            answers: { ...this.answers },
            ...(interaction ? { interaction } : {}),
        };
    }

    private buildChoiceRows(step: Step): ComponentRow[] {
        if (!step.choices || step.choices.length === 0) {
            return [];
        }

        return [
            step.choices.map((choice) => ({
                type: 'button' as const,
                action: this.choiceAction(choice),
                label: choice.label,
                ...(choice.style === undefined ? {} : { style: choice.style }),
                ...(choice.emoji === undefined ? {} : { emoji: choice.emoji }),
                ...(choice.disabled === undefined
                    ? {}
                    : { disabled: choice.disabled }),
            })),
        ];
    }

    private buildNavigationRows(): ComponentRow[] {
        const rows: ComponentRow[] = [];
        const index = this.steps.findIndex(
            (step) => step.id === this.currentStepId,
        );
        const isFirst = index <= 0;
        const isLast = index === this.steps.length - 1;

        if (this.navigation === 'wizard') {
            rows.push([
                {
                    type: 'button',
                    action: createReservedAction('back'),
                    label: 'Back',
                    disabled: this.history.length < 2,
                },
            ]);

            return rows;
        }

        const buttons: ComponentSpec[] = [];

        if (
            this.navigation === 'prev-next' ||
            this.navigation === 'prev-select-next'
        ) {
            buttons.push({
                type: 'button',
                action: createReservedAction('previous'),
                label: 'Previous',
                disabled: isFirst,
            });

            buttons.push({
                type: 'button',
                action: createReservedAction('next'),
                label: 'Next',
                disabled: isLast,
            });
        }

        if (buttons.length > 0) {
            rows.push(buttons);
        }

        if (
            this.navigation === 'select' ||
            this.navigation === 'prev-select-next'
        ) {
            rows.push([
                navigationSelect(
                    'select',
                    this.steps.map((step) => ({
                        label: step.id,
                        value: step.id,
                    })),
                    {
                        placeholder: 'Select a step',
                    },
                ),
            ]);
        }

        return rows;
    }

    private choiceAction(choice: Choice): string {
        return `~${CHOICE_ACTION_PREFIX}${choice.value}`;
    }

    private async handleChoice(
        value: string,
        context: ActionContext,
    ): Promise<void> {
        const step = this.currentStep;
        const choice = step.choices?.find(
            (candidate) => candidate.value === value,
        );

        if (!choice || choice.disabled) {
            return;
        }

        if (!(await this.canInteract(context.interaction))) {
            await this.denyAccess(context.interaction);

            return;
        }

        await context.interaction.deferUpdate();

        if (this.mode === 'wizard') {
            this.answers[step.id] = choice.value;
        }

        const next = choice.next === undefined ? step.next : choice.next;

        if (next === null || next === undefined) {
            if (this.mode === 'wizard') {
                await this.complete(context);

                return;
            }

            await this.goToNext(context);

            return;
        }

        await this.setStep(next, context);
    }

    private async handleSelect(context: ActionContext): Promise<void> {
        const target = context.values[0];

        if (!target) {
            return;
        }

        if (!(await this.canInteract(context.interaction))) {
            await this.denyAccess(context.interaction);

            return;
        }

        await context.interaction.deferUpdate();
        await this.setStep(target, context);
    }

    private async goToNext(context: ActionContext): Promise<void> {
        if (!(await this.canInteract(context.interaction))) {
            await this.denyAccess(context.interaction);

            return;
        }

        const index = this.steps.findIndex(
            (step) => step.id === this.currentStepId,
        );
        const nextStep = this.steps[index + 1];

        if (!nextStep) {
            return;
        }

        await context.interaction.deferUpdate();
        await this.setStep(nextStep.id, context);
    }

    private async goToPrevious(context: ActionContext): Promise<void> {
        if (!(await this.canInteract(context.interaction))) {
            await this.denyAccess(context.interaction);

            return;
        }

        const index = this.steps.findIndex(
            (step) => step.id === this.currentStepId,
        );
        const previousStep = this.steps[index - 1];

        if (!previousStep) {
            return;
        }

        await context.interaction.deferUpdate();
        await this.setStep(previousStep.id, context);
    }

    private async goBack(context: ActionContext): Promise<void> {
        if (!(await this.canInteract(context.interaction))) {
            await this.denyAccess(context.interaction);

            return;
        }

        const abandoned = this.history.pop();
        const previous = this.history[this.history.length - 1];

        if (!previous) {
            if (abandoned) {
                this.history.push(abandoned);
            }

            return;
        }

        if (abandoned) {
            delete this.answers[abandoned];
        }

        delete this.answers[previous];

        await context.interaction.deferUpdate();

        this.currentStepId = previous;

        await this.refresh(context);
    }

    private async complete(context: ActionContext): Promise<void> {
        this.completed = true;

        await this.options.onComplete?.(
            this.createContext(context.interaction),
        );
        await this.refresh(context);
    }

    private async canInteract(interaction: Interaction): Promise<boolean> {
        switch (this.access.type) {
            case 'everyone':
                return true;
            case 'caller-only':
                return this.userId === undefined
                    ? true
                    : interaction.userId === this.userId;
            case 'custom':
                return (await this.access.filter(interaction)) === true;
            default:
                return true;
        }
    }

    private async denyAccess(interaction: Interaction): Promise<void> {
        try {
            await interaction.reply({
                content: 'You are not allowed to use this menu.',
                flags: MessageFlags.Ephemeral,
            });
        } catch {
            // The interaction may already have been answered.
        }
    }
}
