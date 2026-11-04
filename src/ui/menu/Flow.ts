import { MessageFlags } from 'discord-api-types/v10';

import type { Interaction } from '../../interaction/types';
import { generateRoutingId } from '../ids';
import type { MessageTarget } from '../messages';
import { deleteTarget, editTarget, sendChannelMessage } from '../messages';
import { renderContent } from '../render';
import type { WidgetRouter } from '../router';
import type {
    ActionContext,
    ComponentRow,
    RenderedContent,
    Widget,
} from '../types';
import type {
    Choice,
    FlowOptions,
    FlowState,
    MenuAccess,
    Step,
    StepContext,
} from './types';

/** Action prefix used by the flows for choice buttons. */
export const CHOICE_ACTION_PREFIX = 'choice:';

/**
 * The shared machinery behind {@link Menu} and {@link Wizard}.
 *
 * A flow owns the steps, the navigation chrome, the delivery, and the
 * access policy. What makes a menu a menu and a wizard a wizard is *how the
 * steps are traversed*, and that is a difference in the state transitions
 * rather than a flag: the two subclasses implement
 * {@link Flow.nextState} differently and nothing else.
 */
export abstract class Flow<
    S extends FlowState = FlowState,
> implements Widget<S> {
    /** Name used for diagnostics. */
    public readonly name: string;

    /** Public identity of the flow. */
    public readonly id: string;

    /** Short, framework-generated identity used for routing. */
    public readonly routingId: string;

    /** Discord user ID allowed to operate the flow. */
    public readonly userId: string | undefined;

    /** Policy controlling which users may interact with the flow. */
    public readonly access: MenuAccess;

    /** Maximum duration of the flow, in milliseconds. */
    public readonly timeout: number;

    /** Whether the flow's message is deleted when the timeout elapses. */
    public readonly deleteOnTimeout: boolean;

    /** Namespace used for the flow's custom ids. */
    public readonly namespace: string;

    /** The type used to look up the factory that recreates the flow. */
    public readonly type: string;

    /** ID of the Discord message backing the flow, when sent. */
    public messageId: string | null = null;

    /** ID of the channel containing the flow's message, when sent. */
    public channelId: string | null = null;

    /** ID of the guild containing the flow's message, when sent. */
    public guildId: string | null = null;

    /** The steps available in the flow. */
    protected readonly steps: readonly Step[];

    /** The steps indexed by their ID. */
    protected readonly stepById: Map<string, Step>;

    /** The configuration the flow was built with. */
    protected readonly options: FlowOptions;

    private target: MessageTarget | null = null;

    private router: WidgetRouter | null = null;

    private timer: ReturnType<typeof setTimeout> | null = null;

    private closed = false;

    /**
     * @param options - Flow configuration.
     */
    constructor(options: FlowOptions) {
        if (!options.steps || options.steps.length === 0) {
            throw new TypeError('A flow must define at least one step.');
        }

        if (!options.api) {
            throw new TypeError('A flow requires a REST facade.');
        }

        this.options = options;
        this.steps = options.steps;
        this.name = options.name ?? 'flow';
        this.userId = options.userId;
        this.access = options.access ?? { type: 'caller-only' };
        this.timeout = options.timeout ?? 180_000;
        this.deleteOnTimeout = options.deleteOnTimeout ?? false;
        this.namespace = options.namespace ?? 'ui';
        this.type = options.type ?? 'menu';

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

        this.routingId = options.routingId ?? generateRoutingId();
        this.id = options.id ?? this.routingId;
    }

    /**
     * Where the flow's message lives, when it has been sent.
     *
     * @returns The message target, or `null` when the flow was never sent.
     */
    public get messageTarget(): MessageTarget | null {
        return this.target;
    }

    /**
     * The state the flow starts in.
     *
     * @returns The initial state.
     */
    public initialState(): S {
        return {
            currentStepId: this.options.firstStep ?? this.steps[0]!.id,
            answers: {},
            history: [this.options.firstStep ?? this.steps[0]!.id],
            completed: false,
        } as unknown as S;
    }

    /**
     * Renders the active step together with the navigation chrome.
     *
     * @param state - The state the flow currently holds.
     * @returns The content displayed by the flow.
     */
    public async render(state: S): Promise<RenderedContent> {
        const step = this.stepOf(state.currentStepId);
        const content = await step.render(this.context(state));

        const rows: ComponentRow[] = [...(content.components ?? [])];

        for (const row of this.choiceRows(step)) {
            rows.push(row);
        }

        for (const row of this.chromeRows(state)) {
            rows.push(row);
        }

        if (rows.length > 5) {
            throw new RangeError(
                `A flow may not render more than 5 action rows, but ${rows.length} were produced.`,
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
        context: ActionContext<S>,
    ): Promise<void> {
        const step = this.stepOf(context.state.currentStepId);

        if (!step.onAction) {
            return;
        }

        await step.onAction(
            action,
            this.context(context.state, context.interaction),
        );
    }

    /**
     * Handles a reserved navigation action.
     *
     * @param action - The reserved action, without the marker.
     * @param context - Context describing the triggering interaction.
     */
    public async onNavigation(
        action: string,
        context: ActionContext<S>,
    ): Promise<void> {
        if (!(await this.canInteract(context.interaction))) {
            await this.denyAccess(context.interaction);

            return;
        }

        // Acknowledge before doing any work: the interaction token is only
        // valid for three seconds.
        await context.interaction.deferUpdate();

        const next = await this.nextState(context.state, action, context);

        if (!next) {
            await context.router.refresh(this.routingId);

            return;
        }

        await context.update(next);

        if (next.completed && !context.state.completed) {
            await this.onComplete?.(this.context(next, context.interaction));
        }
    }

    /**
     * Computes the state that follows an action.
     *
     * This is the only place where a menu and a wizard differ: the
     * transitions are structural rather than a flag on a shared class.
     *
     * @param state - The state the flow currently holds.
     * @param action - The reserved action, without the marker.
     * @param context - Context describing the triggering interaction.
     * @returns The next state, or `null` when the action changes nothing.
     */
    protected abstract nextState(
        state: S,
        action: string,
        context: ActionContext<S>,
    ): Promise<S | null> | S | null;

    /**
     * Builds the navigation chrome rendered alongside the active step.
     *
     * @param state - The state the flow currently holds.
     * @returns The chrome rows.
     */
    protected abstract chromeRows(state: S): ComponentRow[];

    /**
     * Called when the flow completes.
     *
     * @param context - Context describing the completed flow.
     */
    protected async onComplete?(context: StepContext<S>): Promise<void>;

    /**
     * Returns the state that should be persisted.
     *
     * @param state - The state the flow currently holds.
     * @returns The serialisable state.
     */
    public serialize(state: S): unknown {
        return state;
    }

    /**
     * Restores the flow from a persisted state.
     *
     * @param data - The persisted state.
     * @returns The restored state.
     */
    public restore(data: unknown): S {
        const initial = this.initialState();

        if (typeof data !== 'object' || data === null) {
            return initial;
        }

        const record = data as Partial<FlowState>;

        const currentStepId =
            typeof record.currentStepId === 'string' &&
            this.stepById.has(record.currentStepId)
                ? record.currentStepId
                : initial.currentStepId;

        const answers =
            record.answers && typeof record.answers === 'object'
                ? { ...record.answers }
                : { ...initial.answers };

        const history = Array.isArray(record.history)
            ? [...record.history]
            : [...initial.history];

        const completed =
            typeof record.completed === 'boolean'
                ? record.completed
                : initial.completed;

        return {
            ...initial,
            currentStepId,
            answers,
            history,
            completed,
        };
    }

    /**
     * Sends the flow to a channel.
     *
     * @param channelId - Channel to send the flow to.
     * @param router - Router used to register the flow.
     * @returns The ID of the created message.
     */
    public async send(
        channelId: string,
        router?: WidgetRouter,
    ): Promise<string> {
        const state = this.initialState();
        const content = await this.render(state);
        const message = renderContent(content, this.namespace, this.routingId);
        const created = await sendChannelMessage(
            this.options.api,
            channelId,
            message,
        );

        this.target = {
            kind: 'channel',
            channelId,
            messageId: created.id,
        };

        this.messageId = created.id;
        this.channelId = channelId;

        await this.register(router, state);
        this.startTimeout();

        return created.id;
    }

    /**
     * Replies to an interaction with the flow.
     *
     * @param interaction - The interaction to reply to.
     * @param options - Delivery options.
     * @param router - Router used to register the flow.
     */
    public async reply(
        interaction: Interaction,
        options: { readonly ephemeral?: boolean } = {},
        router?: WidgetRouter,
    ): Promise<void> {
        const state = this.initialState();
        const content = await this.render(state);
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
            expiresAt: interaction.expiresAt,
        };

        this.channelId = interaction.channelId;

        await this.register(router, state);
        this.startTimeout();
    }

    /**
     * Re-renders the flow with its current state and pushes the result to
     * its message.
     */
    public async refresh(): Promise<void> {
        if (!this.target) {
            return;
        }

        const state = this.router?.stateOf<S>(this.routingId);

        if (state === undefined) {
            return;
        }

        const content = await this.render(state);
        const message = renderContent(content, this.namespace, this.routingId);

        await editTarget(this.options.api, this.target, message);
    }

    /**
     * Closes the flow, deleting its message when requested.
     */
    public async close(): Promise<void> {
        if (this.closed) {
            return;
        }

        this.closed = true;
        this.stopTimeout();

        if (this.target?.kind === 'channel' && this.deleteOnTimeout) {
            await deleteTarget(this.options.api, this.target).catch(
                () => undefined,
            );
        }

        this.router?.unregister(this.routingId);
        this.target = null;
    }

    /**
     * Builds the context handed to a step.
     *
     * @param state - The state the flow currently holds.
     * @param interaction - The triggering interaction, when there is one.
     * @returns The step context.
     */
    protected context(state: S, interaction?: Interaction): StepContext<S> {
        return {
            flow: this,
            stepId: state.currentStepId,
            state,
            answers: { ...state.answers },
            ...(interaction ? { interaction } : {}),
        };
    }

    /**
     * Looks up a step by ID.
     *
     * @param stepId - ID of the step.
     * @returns The step.
     */
    protected stepOf(stepId: string): Step {
        const step = this.stepById.get(stepId);

        if (!step) {
            throw new Error(`Unknown step: "${stepId}".`);
        }

        return step;
    }

    /**
     * The zero-based position of a step in the flow.
     *
     * @param stepId - ID of the step.
     * @returns The index of the step, or `-1`.
     */
    protected indexOf(stepId: string): number {
        return this.steps.findIndex((step) => step.id === stepId);
    }

    /**
     * Finds a choice of the active step.
     *
     * @param state - The state the flow currently holds.
     * @param value - The value of the choice.
     * @returns The choice, when it exists and is enabled.
     */
    protected findChoice(state: S, value: string): Choice | undefined {
        const step = this.stepOf(state.currentStepId);
        const choice = step.choices?.find(
            (candidate) => candidate.value === value,
        );

        if (!choice || choice.disabled) {
            return undefined;
        }

        return choice;
    }

    /**
     * Builds the rows that render the choices of a step.
     *
     * @param step - The step being rendered.
     * @returns The choice rows.
     */
    protected choiceRows(step: Step): ComponentRow[] {
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

    /**
     * The action segment used for a choice button.
     *
     * @param choice - The choice.
     * @returns The action segment.
     */
    protected choiceAction(choice: Choice): string {
        return `~${CHOICE_ACTION_PREFIX}${choice.value}`;
    }

    /**
     * Checks whether the interaction may drive the flow.
     *
     * @param interaction - The interaction.
     * @returns `true` when the interaction is allowed.
     */
    protected async canInteract(interaction: Interaction): Promise<boolean> {
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

    /**
     * Answers an interaction that is not allowed to drive the flow.
     *
     * @param interaction - The interaction.
     */
    protected async denyAccess(interaction: Interaction): Promise<void> {
        try {
            await interaction.reply({
                content: 'You are not allowed to use this menu.',
                flags: MessageFlags.Ephemeral,
            });
        } catch {
            // The interaction may already have been answered.
        }
    }

    private async register(
        router: WidgetRouter | undefined,
        state: S,
    ): Promise<void> {
        if (!router) {
            return;
        }

        this.router = router;

        await router.register(this as Widget<S>, this.target, state);
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
}
