import {
    LabelBuilder,
    ModalBuilder,
    TextInputBuilder,
} from '@discordjs/builders';
import type { API } from '@discordjs/core';
import type {
    APIMessageComponentEmoji,
    APIModalSubmissionComponent,
    APIModalSubmitInteraction,
    TextInputStyle,
} from 'discord-api-types/v10';
import {
    ComponentType,
    TextInputStyle as TextInputStyles,
} from 'discord-api-types/v10';

import type { Interaction } from '../../interaction/types';
import { createCustomId, generateRoutingId } from '../ids';
import type { WidgetRouter } from '../router';
import type { ActionContext, RenderedContent, Widget } from '../types';

/**
 * A single text input displayed by a modal.
 */
export interface ModalField {
    /**
     * Identifier of the field.
     *
     * It is used as the `custom_id` of the text input and as the key of the
     * submitted value.
     */
    readonly id: string;

    /** Label displayed above the input. */
    readonly label: string;

    /** Placeholder shown while the input is empty. */
    readonly placeholder?: string;

    /** Value pre-filled in the input. */
    readonly value?: string;

    /** Whether the input must be filled in. */
    readonly required?: boolean;

    /** Minimum number of characters accepted. */
    readonly minLength?: number;

    /** Maximum number of characters accepted. */
    readonly maxLength?: number;

    /** Whether the input is a single line or a paragraph. */
    readonly style?: TextInputStyle;
}

/**
 * Configuration options used to construct a {@link Modal}.
 */
export interface ModalOptions {
    /** The REST facade. */
    readonly api: API;

    /** Title displayed at the top of the modal. */
    readonly title: string;

    /** Fields displayed inside the modal. */
    readonly fields: readonly ModalField[];

    /**
     * Custom id of the modal.
     *
     * Defaults to a framework-minted id built from the routing id.
     */
    readonly customId?: string;

    /**
     * Routing id used for the modal.
     *
     * Generated automatically when omitted.
     */
    readonly routingId?: string;

    /** Public identity of the modal. */
    readonly id?: string;

    /**
     * Namespace used for the modal's custom id.
     *
     * @defaultValue 'ui'
     */
    readonly namespace?: string;
}

/**
 * The state of a modal.
 */
export interface ModalState {
    /** Values submitted by the user, keyed by field ID. */
    readonly values: Readonly<Record<string, string>>;

    /** Whether the modal has been submitted. */
    readonly submitted: boolean;
}

/**
 * Builds the components of a modal.
 *
 * Text inputs have to live inside a label, and getting that nesting right is
 * fiddly, so the framework provides the helper.
 *
 * @param fields - The fields displayed by the modal.
 * @returns The modal components.
 */
export function buildModalComponents(
    fields: readonly ModalField[],
): ReturnType<ModalBuilder['toJSON']>['components'] {
    return fields.map((field) =>
        new LabelBuilder()
            .setLabel(field.label)
            .setTextInputComponent(
                new TextInputBuilder()
                    .setCustomId(field.id)
                    .setLabel(field.label)
                    .setRequired(field.required ?? true)
                    .setStyle(field.style ?? TextInputStyles.Short)
                    .setPlaceholder(field.placeholder ?? '')
                    .setMinLength(field.minLength ?? 0)
                    .setMaxLength(field.maxLength ?? 4000),
            )
            .toJSON(),
    );
}

/**
 * A modal is a widget with a different render target.
 *
 * It is opened in response to an interaction and submitted through a
 * `MODAL_SUBMIT` interaction, which is routed back to the widget that opened
 * it using the same custom id scheme as every other component.
 */
export class Modal implements Widget<ModalState> {
    /** The REST facade. */
    public readonly api: API;

    /** Title displayed at the top of the modal. */
    public readonly title: string;

    /** Fields displayed inside the modal. */
    public readonly fields: readonly ModalField[];

    /** Public identity of the modal. */
    public readonly id: string;

    /** Short, framework-generated identity used for routing. */
    public readonly routingId: string;

    /** Custom id of the modal. */
    public readonly customId: string;

    /** Namespace used for the modal's custom id. */
    public readonly namespace: string;

    private values: Record<string, string> = {};

    private submitted = false;

    /**
     * @param options - Modal configuration.
     */
    constructor(options: ModalOptions) {
        if (!options.fields || options.fields.length === 0) {
            throw new TypeError('A modal must define at least one field.');
        }

        this.api = options.api;
        this.title = options.title;
        this.fields = options.fields;
        this.namespace = options.namespace ?? 'ui';
        this.routingId = options.routingId ?? generateRoutingId();
        this.id = options.id ?? this.routingId;
        this.customId =
            options.customId ??
            createCustomId(this.namespace, this.routingId, 'submit');
    }

    /** Current state of the modal. */
    public get state(): ModalState {
        return {
            values: { ...this.values },
            submitted: this.submitted,
        };
    }

    /** Values submitted by the user. */
    public get submittedValues(): Readonly<Record<string, string>> {
        return { ...this.values };
    }

    /**
     * Modals have no message of their own.
     *
     * @returns An empty content object.
     */
    public render(): RenderedContent {
        return {};
    }

    /**
     * Handles the submission of the modal.
     *
     * @param action - The dispatched action.
     * @param context - Context describing the triggering interaction.
     */
    public async onAction(
        action: string,
        context: ActionContext,
    ): Promise<void> {
        if (action !== 'submit') {
            return;
        }

        this.values = extractModalValues(context.interaction);
        this.submitted = true;
    }

    /**
     * Opens the modal in response to an interaction.
     *
     * @param interaction - The interaction that opens the modal.
     * @param router - Router used to register the modal.
     */
    public async open(
        interaction: Interaction,
        router?: WidgetRouter,
    ): Promise<void> {
        const builder = new ModalBuilder()
            .setCustomId(this.customId)
            .setTitle(this.title)
            .addLabelComponents(
                ...this.fields.map((field) =>
                    new LabelBuilder()
                        .setLabel(field.label)
                        .setTextInputComponent(
                            new TextInputBuilder()
                                .setCustomId(field.id)
                                .setLabel(field.label)
                                .setRequired(field.required ?? true)
                                .setStyle(field.style ?? TextInputStyles.Short)
                                .setPlaceholder(field.placeholder ?? '')
                                .setMinLength(field.minLength ?? 0)
                                .setMaxLength(field.maxLength ?? 4000),
                        ),
                ),
            );

        const data = builder.toJSON();

        await interaction.createModal({
            customId: this.customId,
            title: this.title,
            components: data.components,
        });

        await router?.register(this);
    }
}

/**
 * Extracts the submitted values from a modal interaction.
 *
 * @param interaction - The modal submission.
 * @returns The submitted values, keyed by field ID.
 */
export function extractModalValues(
    interaction: Interaction,
): Record<string, string> {
    if (!interaction.isModalSubmit()) {
        return {};
    }

    const raw = interaction.raw as APIModalSubmitInteraction;
    const values: Record<string, string> = {};

    for (const component of raw.data
        .components as APIModalSubmissionComponent[]) {
        if (component.type === ComponentType.ActionRow) {
            for (const child of component.components) {
                if (child.type === ComponentType.TextInput) {
                    values[child.custom_id] = child.value ?? '';
                }
            }

            continue;
        }

        if (component.type === ComponentType.Label) {
            const child = (
                component as Extract<
                    APIModalSubmissionComponent,
                    { type: ComponentType.Label }
                >
            ).component;

            if (child.type === ComponentType.TextInput) {
                values[child.custom_id] = child.value ?? '';
            }
        }
    }

    return values;
}

/**
 * Re-exported emoji type, used by modal builders.
 */
export type { APIMessageComponentEmoji };
