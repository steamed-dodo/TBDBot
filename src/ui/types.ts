import type { EmbedBuilder } from '@discordjs/builders';
import type {
    APIMessageComponentEmoji,
    ButtonStyle,
} from 'discord-api-types/v10';

import type { Interaction } from '../interaction/types';
import type { WidgetRouter } from './router';

/**
 * Button styles that may be used on a framework-rendered button.
 *
 * Link and premium buttons carry a URL or SKU instead of a custom id, so
 * they cannot be routed and are therefore not supported.
 */
export type ComponentButtonStyle =
    | ButtonStyle.Primary
    | ButtonStyle.Secondary
    | ButtonStyle.Success
    | ButtonStyle.Danger;

/**
 * An emoji displayed on a component.
 *
 * A plain string is treated as the emoji's name.
 */
export type EmojiSpec = string | APIMessageComponentEmoji;

/**
 * A button rendered by the framework.
 *
 * The `action` is the user-defined part of the custom id. The framework
 * mints the full custom id, so the user never has to think about the
 * `custom_id` budget.
 */
export interface ButtonSpec {
    /** Discriminant identifying the component kind. */
    readonly type: 'button';

    /** Action dispatched to the widget when the button is pressed. */
    readonly action: string;

    /** Text displayed on the button. */
    readonly label: string;

    /** Visual style of the button. */
    readonly style?: ComponentButtonStyle;

    /** Emoji displayed on the button. */
    readonly emoji?: EmojiSpec;

    /** Whether the button is disabled. */
    readonly disabled?: boolean;
}

/** A single option of a select menu. */
export interface SelectOptionSpec {
    /** Text displayed for the option. */
    readonly label: string;

    /** Value reported when the option is selected. */
    readonly value: string;

    /** Optional description shown below the label. */
    readonly description?: string;

    /** Optional emoji displayed next to the label. */
    readonly emoji?: EmojiSpec;

    /** Whether the option is selected by default. */
    readonly default?: boolean;
}

/** A string select menu rendered by the framework. */
export interface SelectSpec {
    /** Discriminant identifying the component kind. */
    readonly type: 'select';

    /** Action dispatched to the widget when a value is selected. */
    readonly action: string;

    /** Options offered by the select menu. */
    readonly options: readonly SelectOptionSpec[];

    /** Placeholder shown when nothing is selected. */
    readonly placeholder?: string;

    /** Whether the select menu is disabled. */
    readonly disabled?: boolean;
}

/** Any component the framework can render. */
export type ComponentSpec = ButtonSpec | SelectSpec;

/** A row of components. */
export type ComponentRow = readonly ComponentSpec[];

/**
 * Content produced by a widget's `render()` method.
 *
 * Embeds are supplied as builders; the framework converts them to their API
 * representation as part of the rendering pipeline.
 */
export interface RenderedContent {
    /** Plain-text content displayed above the embeds. */
    readonly content?: string;

    /** Embeds displayed by the widget. */
    readonly embeds?: readonly EmbedBuilder[];

    /** Interactive components displayed by the widget. */
    readonly components?: readonly ComponentRow[];
}

/**
 * Context handed to a widget when an action is dispatched.
 */
export interface ActionContext<S = unknown> {
    /** The widget that received the action. */
    readonly widget: Widget<S>;

    /** The interaction that triggered the action. */
    readonly interaction: Interaction;

    /**
     * The user-defined action.
     *
     * The reserved framework prefix has already been stripped.
     */
    readonly action: string;

    /** The untouched `custom_id` of the component that triggered the action. */
    readonly rawCustomId: string;

    /** Values selected in a select menu, when applicable. */
    readonly values: readonly string[];

    /** The router that dispatched the action. */
    readonly router: WidgetRouter;

    /**
     * The state the widget currently holds.
     *
     * The widget never reads its own state implicitly: the framework holds
     * the one true value and hands it back on every render.
     */
    readonly state: S;

    /**
     * Replaces the widget's state and repaints it.
     *
     * The next state is a full value, not a patch: the caller computes it
     * however it likes, and the framework never holds a stale copy.
     *
     * @param next - The new state of the widget.
     */
    update(next: S): Promise<void>;
}

/**
 * Navigation actions the framework reserves for itself.
 *
 * Actions carrying the reserved prefix are interpreted by the framework and
 * never reach `Widget.onAction`.
 */
export type NavigationAction = 'next' | 'previous' | 'back' | 'select';

/**
 * A unit of state plus the way it is displayed.
 *
 * The widget does not own its state: the framework holds the current value
 * and passes it to {@link Widget.render} on every repaint. The widget is a
 * pure function of that value, which is what makes it safe to replace the
 * state rather than mutate it in place.
 *
 * The important property of this interface is that the repaint can be
 * triggered from anywhere — a component interaction, a timer, a queue
 * worker, another process — because the widget is not tied to a collector's
 * lifetime.
 */
export interface Widget<S = unknown> {
    /** Stable, user-facing identity of the widget. */
    readonly id: string;

    /**
     * Short, framework-generated identity used for routing.
     *
     * It is opaque to users but stable across restarts for persistent
     * widgets, which is what makes routing work after a cold start.
     */
    readonly routingId: string;

    /**
     * Builds the content displayed by the widget.
     *
     * @param state - The current state of the widget.
     */
    render(state: S): RenderedContent | Promise<RenderedContent>;

    /**
     * Handles a user-defined action.
     *
     * @param action - The user-defined action, without the reserved prefix.
     * @param context - Context describing the triggering interaction.
     */
    onAction?(action: string, context: ActionContext<S>): void | Promise<void>;

    /**
     * Handles a reserved navigation action.
     *
     * The reserved marker has already been stripped, so the action is the
     * name the framework — or the widget — reserved.
     *
     * @param action - The reserved navigation action.
     * @param context - Context describing the triggering interaction.
     */
    onNavigation?(
        action: string,
        context: ActionContext<S>,
    ): void | Promise<void>;
}
