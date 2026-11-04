import type { EmbedBuilder } from '@discordjs/builders';
import type { API } from '@discordjs/core';

import type { Interaction } from '../../interaction/types';
import type { ComponentButtonStyle, ComponentRow, EmojiSpec } from '../types';
import type { Flow } from './Flow';

/**
 * A choice offered by a step.
 *
 * Selecting a choice stores its value under the step's ID (in a wizard) and
 * navigates to the choice's `next` step.
 */
export interface Choice {
    /** Value stored when the choice is selected. */
    readonly value: string;

    /** Text displayed on the button or select option. */
    readonly label: string;

    /** Optional description shown by select menus. */
    readonly description?: string;

    /** Optional emoji displayed on buttons or select options. */
    readonly emoji?: EmojiSpec;

    /** Button style used when the choice is rendered as a button. */
    readonly style?: ComponentButtonStyle;

    /** Whether the choice is disabled. */
    readonly disabled?: boolean;

    /**
     * Step ID to navigate to after selecting this choice.
     *
     * When omitted, the step's own `next` value is used. When both are
     * omitted, or `next` is `null`, a wizard completes the flow.
     */
    readonly next?: string | null;
}

/**
 * Content rendered for a single step.
 */
export interface StepContent {
    /** Optional plain-text content displayed above the embeds. */
    readonly content?: string;

    /** Embeds displayed for this step. */
    readonly embeds?: readonly EmbedBuilder[];

    /** Custom component rows displayed for this step. */
    readonly components?: readonly ComponentRow[];
}

/**
 * Context passed to step render functions and action handlers.
 */
export interface StepContext<S extends FlowState = FlowState> {
    /** The flow handling the interaction. */
    readonly flow: Flow<S>;

    /** ID of the step being rendered. */
    readonly stepId: string;

    /** The state the flow currently holds. */
    readonly state: S;

    /** Read-only snapshot of the answers collected so far. */
    readonly answers: Readonly<Record<string, string>>;

    /** Interaction that triggered the render, when available. */
    readonly interaction?: Interaction;
}

/**
 * Definition of a single step.
 *
 * The `Step` type is the same for menus and wizards; the two differ only in
 * which optional members are populated and in how the steps are traversed.
 */
export interface Step {
    /** Unique identifier used for navigation and answers. */
    readonly id: string;

    /**
     * Step to navigate to once this step is completed.
     *
     * `null` completes a wizard. When omitted, a wizard completes the flow
     * and a menu advances to the next step in the list.
     */
    readonly next?: string | null;

    /** Choices offered by the step. */
    readonly choices?: readonly Choice[];

    /** Builds the content displayed for this step. */
    render(context: StepContext): StepContent | Promise<StepContent>;

    /**
     * Handles a user-defined action dispatched while this step is active.
     *
     * @param action - The user-defined action.
     * @param context - Context describing the current step.
     */
    onAction?(action: string, context: StepContext): void | Promise<void>;
}

/**
 * The state of a flow.
 *
 * The framework holds this value and hands it back to the widget on every
 * render, so there is exactly one copy of it.
 */
export interface FlowState {
    /** ID of the step currently displayed. */
    readonly currentStepId: string;

    /** Answers collected so far, keyed by step ID. */
    readonly answers: Readonly<Record<string, string>>;

    /** Steps visited during the current flow, oldest first. */
    readonly history: readonly string[];

    /** Whether the flow has been completed. */
    readonly completed: boolean;
}

/**
 * Controls which users may interact with a flow.
 *
 * - `caller-only`: Only the user who owns the flow may interact.
 * - `everyone`: Any user may interact.
 * - `custom`: Access is determined by a user-provided filter.
 */
export type MenuAccess =
    | { readonly type: 'caller-only' }
    | { readonly type: 'everyone' }
    | {
          readonly type: 'custom';
          readonly filter: (
              interaction: Interaction,
          ) => boolean | Promise<boolean>;
      };

/**
 * Configuration shared by every flow.
 */
export interface FlowOptions {
    /** The REST facade used to send and edit the flow's message. */
    readonly api: API;

    /** Optional name used for diagnostics. */
    readonly name?: string;

    /**
     * Discord user ID allowed to operate the flow.
     *
     * Used by the `caller-only` access policy.
     */
    readonly userId?: string;

    /** Steps available in the flow. */
    readonly steps: readonly Step[];

    /**
     * ID of the step displayed first.
     *
     * @defaultValue The ID of the first step in `steps`.
     */
    readonly firstStep?: string;

    /**
     * Policy controlling which users may interact with the flow.
     *
     * @defaultValue { type: 'caller-only' }
     */
    readonly access?: MenuAccess;

    /**
     * Maximum duration of the flow, in milliseconds.
     *
     * @defaultValue 180000
     */
    readonly timeout?: number;

    /**
     * Whether to delete the flow's message when the timeout elapses.
     *
     * @defaultValue false
     */
    readonly deleteOnTimeout?: boolean;

    /**
     * Routing id used for the flow's custom ids.
     *
     * Generated automatically when omitted.
     */
    readonly routingId?: string;

    /**
     * Public identity of the flow.
     *
     * Defaults to the routing id.
     */
    readonly id?: string;

    /**
     * Namespace used for the flow's custom ids.
     *
     * @defaultValue 'ui'
     */
    readonly namespace?: string;

    /**
     * The type used to look up the factory that recreates the flow.
     *
     * @defaultValue 'menu'
     */
    readonly type?: string;
}

/**
 * Called after a wizard has been completed.
 */
export type WizardCompleteHandler = (
    context: StepContext,
) => void | Promise<void>;

/**
 * Navigation chrome rendered by a menu.
 *
 * - `prev-next`: Previous and Next buttons.
 * - `prev-select-next`: A step select menu with Previous and Next buttons.
 * - `select`: A step select menu only.
 */
export type MenuNavigation = 'prev-next' | 'prev-select-next' | 'select';

/**
 * Configuration options used to construct a {@link Menu}.
 */
export interface MenuOptions extends FlowOptions {
    /**
     * Navigation chrome rendered alongside the active step.
     *
     * @defaultValue 'prev-next'
     */
    readonly navigation?: MenuNavigation;
}

/**
 * Configuration options used to construct a {@link Wizard}.
 */
export interface WizardOptions extends FlowOptions {
    /** Called when the wizard completes. */
    readonly onComplete?: WizardCompleteHandler;
}
