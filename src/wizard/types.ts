import type {
    ButtonStyle,
    EmbedBuilder,
    Message,
    MessageComponentInteraction,
    MessageCreateOptions,
    MessageEditOptions,
} from 'discord.js';
import type { Wizard } from './Wizard';

/**
 * Controls how a wizard step renders its choices.
 *
 * - `buttons`: Choices are rendered as buttons.
 * - `select`: Choices are rendered as a single string select menu.
 */
export type WizardNavigation = 'buttons' | 'select';

/**
 * A choice displayed by a wizard step.
 *
 * Selecting a choice stores its value in {@link Wizard.answers} under the
 * current step's ID, then navigates to `next`.
 */
export interface WizardChoice {
    /** Value stored when this choice is selected. */
    readonly value: string;

    /** Text displayed on the button or select option. */
    readonly label: string;

    /** Optional description shown by select menus. */
    readonly description?: string;

    /** Optional emoji displayed on buttons or select options. */
    readonly emoji?: string;

    /** Button style used when the step renders choices as buttons. */
    readonly style?: ButtonStyle;

    /** Whether this choice is disabled. */
    readonly disabled?: boolean;

    /**
     * Step ID to navigate to after selecting this choice.
     *
     * When omitted, the step's own `next` value is used. When both are
     * omitted, or `next` is `null`, selecting the choice completes the wizard.
     */
    readonly next?: string | null;
}

/**
 * Content rendered for a single wizard step.
 */
export interface WizardContent {
    /** Optional plain-text content displayed above the embeds. */
    readonly content?: string;

    /** Embed displayed for this step. */
    readonly embed?: EmbedBuilder;

    /** Multiple embeds displayed for this step. */
    readonly embeds?: readonly EmbedBuilder[];

    /** Choices displayed for this step. */
    readonly choices?: readonly WizardChoice[];

    /**
     * How the choices are rendered.
     *
     * @defaultValue 'buttons'
     */
    readonly navigation?: WizardNavigation;

    /** Placeholder shown by select-menu navigation. */
    readonly selectPlaceholder?: string;
}

/**
 * Context passed to step render functions and completion handlers.
 */
export interface WizardContext {
    /** Wizard handling the interaction. */
    readonly wizard: Wizard;

    /** ID of the step being rendered. */
    readonly stepId: string;

    /** Read-only snapshot of answers collected so far. */
    readonly answers: Readonly<Record<string, string>>;

    /** Interaction that triggered the render, when available. */
    readonly interaction?: MessageComponentInteraction;
}

/**
 * Definition of one wizard step.
 */
export interface WizardStep {
    /** Unique identifier used for navigation and answers. */
    readonly id: string;

    /**
     * Default next step for choices that do not define their own `next`.
     *
     * `null` completes the wizard. When omitted, choices without their own
     * `next` also complete the wizard.
     */
    readonly next?: string | null;

    /** Builds the content displayed for this step. */
    render(context: WizardContext): WizardContent | Promise<WizardContent>;
}

/**
 * Called after the final choice has been selected.
 *
 * The triggering interaction is already acknowledged with `deferUpdate()`,
 * so the handler can update the wizard message, send a follow-up, or run the
 * wizard's side effects.
 */
export type WizardCompleteHandler = (
    context: WizardContext,
) => void | Promise<void>;

/** Configuration options used to construct a {@link Wizard}. */
export interface WizardOptions {
    /** Optional name used for diagnostics and events. */
    readonly name?: string;

    /** Discord user ID allowed to operate the wizard. */
    readonly userId: string;

    /** Steps available in the wizard. */
    readonly steps: readonly WizardStep[];

    /**
     * ID of the step displayed first.
     *
     * @defaultValue The ID of the first step in `steps`.
     */
    readonly firstStep?: string;

    /**
     * Maximum duration of the wizard, in milliseconds.
     *
     * @defaultValue 60000
     */
    readonly timeout?: number;

    /**
     * Whether to delete the wizard message when it times out.
     *
     * @defaultValue false
     */
    readonly deleteOnTimeout?: boolean;

    /** Called when a choice completes the wizard. */
    readonly onComplete?: WizardCompleteHandler;
}

/** Options controlling the visibility of an interaction-based wizard response. */
export interface WizardDeliveryOptions {
    /**
     * Whether the response should be visible only to the invoking user.
     *
     * @defaultValue true
     */
    readonly ephemeral?: boolean;
}

/**
 * Message options accepted by the wizard's delivery methods.
 *
 * Embed content, component rows, and message flags are managed by the wizard.
 */
export type WizardMessageOptions = Omit<
    MessageCreateOptions,
    'embeds' | 'components' | 'flags'
>;

/** Controls the message backing a wizard. */
export type WizardMessageController = {
    edit(options: MessageEditOptions): Promise<Message>;
    delete(): Promise<unknown>;
};
