import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    Message,
    MessageActionRowComponentBuilder,
    MessageComponentInteraction,
    MessageFlags,
    RepliableInteraction,
    StringSelectMenuBuilder,
    TextBasedChannel,
} from 'discord.js';
import { EventEmitter } from 'events';

import { Wizard } from '../../src/wizard/Wizard';
import type {
    WizardContent,
    WizardOptions,
    WizardStep,
} from '../../src/wizard/types';

const stepOne: WizardStep = {
    id: 'one',
    render: () => ({
        content: 'first step',
        choices: [
            { value: 'a', label: 'Choose A', next: 'two' },
            { value: 'b', label: 'Choose B', next: 'two' },
        ],
    }),
};

const stepTwo: WizardStep = {
    id: 'two',
    render: () => ({
        content: 'second step',
        choices: [
            { value: 'x', label: 'Choose X' },
            { value: 'y', label: 'Choose Y' },
        ],
    }),
};

function makeStep(
    id: string,
    content: WizardContent = {},
    next?: string | null,
): WizardStep {
    return {
        id,
        ...(next === undefined ? {} : { next }),
        render: () => content,
    };
}

function makeOptions(overrides: Partial<WizardOptions> = {}): WizardOptions {
    return {
        userId: 'user-123',
        steps: [stepOne, stepTwo],
        ...overrides,
    };
}

type MessagePayload = {
    content?: string;
    embeds?: EmbedBuilder[];
    components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
    flags?: MessageFlags;
};

function makeMessage() {
    const collector = new EventEmitter() as EventEmitter & {
        stop: ReturnType<typeof vi.fn>;
    };

    collector.stop = vi.fn((reason?: string) => {
        collector.emit('end', new Map(), reason ?? 'user');
    });

    const message = {
        id: 'message-123',
        edit: vi.fn(),
        delete: vi.fn().mockResolvedValue(undefined),
        createMessageComponentCollector: vi.fn(() => collector),
        components: [],
    };

    message.edit.mockImplementation(async () => message);

    return {
        message: message as unknown as Message,
        collector,
        mocks: message,
    };
}

function makeInteraction(
    message: Message,
    overrides: {
        replied?: boolean;
        deferred?: boolean;
    } = {},
) {
    return {
        replied: overrides.replied ?? false,
        deferred: overrides.deferred ?? false,
        reply: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(message),
        followUp: vi.fn().mockResolvedValue(message),
        fetchReply: vi.fn().mockResolvedValue(message),
        webhook: {
            editMessage: vi.fn().mockResolvedValue(message),
            deleteMessage: vi.fn().mockResolvedValue(undefined),
        },
    } as unknown as RepliableInteraction & {
        reply: ReturnType<typeof vi.fn>;
        editReply: ReturnType<typeof vi.fn>;
        followUp: ReturnType<typeof vi.fn>;
        fetchReply: ReturnType<typeof vi.fn>;
        webhook: {
            editMessage: ReturnType<typeof vi.fn>;
            deleteMessage: ReturnType<typeof vi.fn>;
        };
    };
}

function makeChannel(message: Message, sendable = true) {
    return {
        isSendable: () => sendable,
        send: vi.fn().mockResolvedValue(message),
    } as unknown as TextBasedChannel & {
        send: ReturnType<typeof vi.fn>;
    };
}

type ComponentInteractionMock = MessageComponentInteraction & {
    reply: ReturnType<typeof vi.fn>;
    deferUpdate: ReturnType<typeof vi.fn>;
};

function makeComponentInteraction(
    overrides: {
        customId?: string;
        userId?: string;
        isButton?: boolean;
        isStringSelectMenu?: boolean;
        values?: string[];
        replied?: boolean;
        deferred?: boolean;
    } = {},
): ComponentInteractionMock {
    return {
        customId: overrides.customId ?? 'test-button',
        user: { id: overrides.userId ?? 'user-123' },
        replied: overrides.replied ?? false,
        deferred: overrides.deferred ?? false,
        isButton: () => overrides.isButton ?? false,
        isStringSelectMenu: () => overrides.isStringSelectMenu ?? false,
        values: overrides.values ?? [],
        reply: vi.fn().mockResolvedValue(undefined),
        deferUpdate: vi.fn().mockResolvedValue(undefined),
    } as unknown as ComponentInteractionMock;
}

async function settle(): Promise<void> {
    for (let index = 0; index < 10; index += 1) {
        await Promise.resolve();
    }
}

function findButton(payload: MessagePayload, label: string): ButtonBuilder {
    for (const row of payload.components) {
        for (const component of row.components) {
            if (
                component instanceof ButtonBuilder &&
                component.data.label === label
            ) {
                return component;
            }
        }
    }

    throw new Error(`Button "${label}" was not rendered.`);
}

function findSelect(payload: MessagePayload): StringSelectMenuBuilder {
    for (const row of payload.components) {
        for (const component of row.components) {
            if (component instanceof StringSelectMenuBuilder) {
                return component;
            }
        }
    }

    throw new Error('Select menu was not rendered.');
}

function sendPayload(
    channel: TextBasedChannel & { send: ReturnType<typeof vi.fn> },
): MessagePayload {
    return channel.send.mock.calls[0]![0] as MessagePayload;
}

function lastEditPayload(
    messageMocks: ReturnType<typeof makeMessage>['mocks'],
): MessagePayload {
    return messageMocks.edit.mock.calls.at(-1)![0] as MessagePayload;
}

function lastWebhookPayload(
    interaction: ReturnType<typeof makeInteraction>,
): MessagePayload {
    return interaction.webhook.editMessage.mock.calls.at(
        -1,
    )![1] as MessagePayload;
}

describe('Wizard constructor', () => {
    it('creates a wizard with a default name', () => {
        const wizard = new Wizard(makeOptions());

        expect(wizard.name).toBe('wizard');
    });

    it('creates a wizard with a custom name', () => {
        const wizard = new Wizard(makeOptions({ name: 'setup' }));

        expect(wizard.name).toBe('setup');
    });

    it('uses the first step as the initial step', () => {
        const wizard = new Wizard(makeOptions());

        expect(wizard.currentStep).toBe(stepOne);
        expect(wizard.currentStepId).toBe('one');
    });

    it('uses a configured first step', () => {
        const wizard = new Wizard(makeOptions({ firstStep: 'two' }));

        expect(wizard.currentStep).toBe(stepTwo);
        expect(wizard.currentStepId).toBe('two');
    });

    it('starts without answers or a message', () => {
        const wizard = new Wizard(makeOptions());

        expect(wizard.answers).toEqual({});
        expect(wizard.wizardMessage).toBeNull();
    });

    it('rejects an empty steps array', () => {
        expect(() => new Wizard(makeOptions({ steps: [] }))).toThrow(
            'A wizard must have at least one step.',
        );
    });

    it('rejects a blank user ID', () => {
        expect(() => new Wizard(makeOptions({ userId: '   ' }))).toThrow(
            'userId must be present.',
        );
    });

    it('rejects a zero timeout', () => {
        expect(() => new Wizard(makeOptions({ timeout: 0 }))).toThrow(
            'timeout must be a positive number.',
        );
    });

    it('rejects a negative timeout', () => {
        expect(() => new Wizard(makeOptions({ timeout: -1 }))).toThrow(
            RangeError,
        );
    });

    it('rejects an infinite timeout', () => {
        expect(() => new Wizard(makeOptions({ timeout: Infinity }))).toThrow(
            RangeError,
        );
    });

    it('rejects a NaN timeout', () => {
        expect(() => new Wizard(makeOptions({ timeout: NaN }))).toThrow(
            RangeError,
        );
    });

    it('rejects a blank step ID', () => {
        expect(
            () => new Wizard(makeOptions({ steps: [makeStep('   ')] })),
        ).toThrow('Step ID must not be empty.');
    });

    it('rejects duplicate step IDs', () => {
        expect(
            () =>
                new Wizard(
                    makeOptions({
                        steps: [makeStep('one'), makeStep('one')],
                    }),
                ),
        ).toThrow('Duplicate step ID: "one".');
    });

    it('rejects an unknown first step', () => {
        expect(() => new Wizard(makeOptions({ firstStep: 'missing' }))).toThrow(
            'Unknown first step: "missing".',
        );
    });

    it('rejects a step pointing to an unknown next step', () => {
        expect(
            () =>
                new Wizard(
                    makeOptions({
                        steps: [makeStep('one', {}, 'missing')],
                    }),
                ),
        ).toThrow('Step "one" points to unknown next step "missing".');
    });
});

describe('Wizard delivery', () => {
    let wizard: Wizard;
    let message: Message;
    let collector: EventEmitter & {
        stop: ReturnType<typeof vi.fn>;
    };
    let messageMocks: ReturnType<typeof makeMessage>['mocks'];

    beforeEach(() => {
        const mock = makeMessage();

        message = mock.message;
        collector = mock.collector;
        messageMocks = mock.mocks;

        wizard = new Wizard(makeOptions());
    });

    describe('reply', () => {
        it('replies with the first step and initializes the wizard', async () => {
            const interaction = makeInteraction(message);

            const result = await wizard.reply(interaction);

            expect(result).toBe(message);
            expect(interaction.reply).toHaveBeenCalledOnce();
            expect(interaction.fetchReply).toHaveBeenCalledOnce();

            const payload = interaction.reply.mock
                .calls[0]![0] as MessagePayload;

            expect(payload.content).toBe('first step');
            expect(payload.components).toHaveLength(2);
            expect(payload.flags).toBe(MessageFlags.Ephemeral);

            expect(wizard.wizardMessage).toBe(message);
            expect(
                messageMocks.createMessageComponentCollector,
            ).toHaveBeenCalledWith({ time: 60_000 });
        });

        it('creates a public reply when ephemeral is false', async () => {
            const interaction = makeInteraction(message);

            await wizard.reply(interaction, { ephemeral: false });

            const payload = interaction.reply.mock
                .calls[0]![0] as MessagePayload;

            expect(payload.flags).toBeUndefined();
        });

        it('edits a deferred response instead of replying again', async () => {
            const interaction = makeInteraction(message, {
                deferred: true,
            });

            await wizard.reply(interaction);

            expect(interaction.editReply).toHaveBeenCalledOnce();
            expect(interaction.reply).not.toHaveBeenCalled();

            const payload = interaction.editReply.mock
                .calls[0]![0] as MessagePayload;

            expect(payload.content).toBe('first step');
        });

        it('uses the webhook controller for an ephemeral reply', async () => {
            const interaction = makeInteraction(message);

            await wizard.reply(interaction);

            const payload = interaction.reply.mock
                .calls[0]![0] as MessagePayload;
            const chooseA = findButton(payload, 'Choose A');

            collector.emit(
                'collect',
                makeComponentInteraction({
                    customId: chooseA.data.custom_id!,
                    isButton: true,
                }),
            );
            await settle();

            expect(interaction.webhook.editMessage).toHaveBeenCalledWith(
                '@original',
                expect.objectContaining({
                    content: 'second step',
                }),
            );
            expect(messageMocks.edit).not.toHaveBeenCalled();
        });

        it('rejects an interaction that has already been replied to', async () => {
            const interaction = makeInteraction(message, {
                replied: true,
            });

            await expect(wizard.reply(interaction)).rejects.toThrow(
                'This interaction has already been replied to. Use followUp() instead.',
            );

            expect(interaction.reply).not.toHaveBeenCalled();
            expect(
                messageMocks.createMessageComponentCollector,
            ).not.toHaveBeenCalled();
        });

        it('emits wizardSent', async () => {
            const listener = vi.fn();
            const interaction = makeInteraction(message);

            wizard.on('wizardSent', listener);

            await wizard.reply(interaction);

            expect(listener).toHaveBeenCalledOnce();
        });

        it('rejects starting the same wizard twice', async () => {
            await wizard.reply(makeInteraction(message));

            await expect(
                wizard.reply(makeInteraction(message)),
            ).rejects.toThrow('This wizard has already been started.');
        });

        it('preserves additional message options', async () => {
            const interaction = makeInteraction(message);

            await wizard.reply(
                interaction,
                { ephemeral: false },
                {
                    allowedMentions: { parse: [] },
                },
            );

            const payload = interaction.reply.mock
                .calls[0]![0] as MessagePayload;

            expect(payload.allowedMentions).toEqual({ parse: [] });
            expect(payload.content).toBe('first step');
        });
    });

    describe('followUp', () => {
        it('sends a follow-up with the first step', async () => {
            const interaction = makeInteraction(message);

            const result = await wizard.followUp(interaction);

            expect(result).toBe(message);

            const payload = interaction.followUp.mock
                .calls[0]![0] as MessagePayload;

            expect(payload.content).toBe('first step');
            expect(payload.flags).toBe(MessageFlags.Ephemeral);
            expect(wizard.wizardMessage).toBe(message);
        });

        it('creates a public follow-up when ephemeral is false', async () => {
            const interaction = makeInteraction(message);

            await wizard.followUp(interaction, { ephemeral: false });

            const payload = interaction.followUp.mock
                .calls[0]![0] as MessagePayload;

            expect(payload.flags).toBeUndefined();
        });

        it('edits an ephemeral follow-up through the webhook controller', async () => {
            const interaction = makeInteraction(message);

            await wizard.followUp(interaction);

            const payload = interaction.followUp.mock
                .calls[0]![0] as MessagePayload;
            const chooseA = findButton(payload, 'Choose A');

            collector.emit(
                'collect',
                makeComponentInteraction({
                    customId: chooseA.data.custom_id!,
                    isButton: true,
                }),
            );
            await settle();

            expect(interaction.webhook.editMessage).toHaveBeenCalledWith(
                message.id,
                expect.objectContaining({
                    content: 'second step',
                }),
            );
        });

        it('propagates follow-up errors without emitting wizardSent', async () => {
            const interaction = makeInteraction(message);
            const listener = vi.fn();

            interaction.followUp.mockRejectedValueOnce(
                new Error('Discord API failure'),
            );

            wizard.on('wizardSent', listener);

            await expect(wizard.followUp(interaction)).rejects.toThrow(
                'Discord API failure',
            );

            expect(listener).not.toHaveBeenCalled();
            expect(wizard.wizardMessage).toBeNull();
        });
    });

    describe('send', () => {
        it('sends the first step and initializes the wizard', async () => {
            const channel = makeChannel(message);

            const result = await wizard.send(channel);

            expect(result).toBe(message);

            const payload = sendPayload(channel);

            expect(payload.content).toBe('first step');
            expect(payload.components).toHaveLength(2);
            expect(wizard.wizardMessage).toBe(message);
        });

        it('uses a custom timeout', async () => {
            wizard = new Wizard(makeOptions({ timeout: 30_000 }));

            await wizard.send(makeChannel(message));

            expect(
                messageMocks.createMessageComponentCollector,
            ).toHaveBeenCalledWith({ time: 30_000 });
        });

        it('rejects an unsendable channel', async () => {
            const channel = makeChannel(message, false);

            await expect(wizard.send(channel)).rejects.toThrow(
                'This channel is not sendable.',
            );

            expect(channel.send).not.toHaveBeenCalled();
        });

        it('rejects sending the same wizard twice', async () => {
            const channel = makeChannel(message);

            await wizard.send(channel);

            await expect(wizard.send(channel)).rejects.toThrow(
                'This wizard has already been started.',
            );

            expect(channel.send).toHaveBeenCalledOnce();
        });

        it('propagates send errors without initializing', async () => {
            const channel = makeChannel(message);

            channel.send.mockRejectedValueOnce(
                new Error('Discord API failure'),
            );

            await expect(wizard.send(channel)).rejects.toThrow(
                'Discord API failure',
            );

            expect(wizard.wizardMessage).toBeNull();
        });
    });

    describe('interactions', () => {
        async function startWizard(): Promise<MessagePayload> {
            const channel = makeChannel(message);

            await wizard.send(channel);

            return sendPayload(channel);
        }

        async function dispatch(
            interaction: MessageComponentInteraction,
        ): Promise<void> {
            collector.emit('collect', interaction);
            await settle();
        }

        it('records the answer and moves to the next step', async () => {
            const payload = await startWizard();
            const chooseA = findButton(payload, 'Choose A');

            const interaction = makeComponentInteraction({
                customId: chooseA.data.custom_id!,
                isButton: true,
            });

            await dispatch(interaction);

            expect(interaction.deferUpdate).toHaveBeenCalledOnce();
            expect(wizard.currentStepId).toBe('two');
            expect(wizard.answers.one).toBe('a');

            const edited = lastEditPayload(messageMocks);

            expect(edited.content).toBe('second step');
        });

        it('emits stepChange when moving to a new step', async () => {
            const listener = vi.fn();
            const payload = await startWizard();
            const chooseA = findButton(payload, 'Choose A');

            wizard.on('stepChange', listener);

            await dispatch(
                makeComponentInteraction({
                    customId: chooseA.data.custom_id!,
                    isButton: true,
                }),
            );

            expect(listener).toHaveBeenCalledWith(stepTwo, 'two');
        });

        it('uses the choice next before the step next', async () => {
            const branch = makeStep('branch', { content: 'branch' });

            wizard = new Wizard(
                makeOptions({
                    steps: [
                        makeStep(
                            'one',
                            {
                                choices: [
                                    {
                                        value: 'go',
                                        label: 'Go',
                                        next: 'branch',
                                    },
                                ],
                            },
                            'two',
                        ),
                        stepTwo,
                        branch,
                    ],
                }),
            );

            const payload = await startWizard();
            const go = findButton(payload, 'Go');

            await dispatch(
                makeComponentInteraction({
                    customId: go.data.custom_id!,
                    isButton: true,
                }),
            );

            expect(wizard.currentStepId).toBe('branch');
        });

        it('uses the step next when a choice does not define one', async () => {
            wizard = new Wizard(
                makeOptions({
                    steps: [
                        makeStep(
                            'one',
                            {
                                choices: [{ value: 'go', label: 'Go' }],
                            },
                            'two',
                        ),
                        stepTwo,
                    ],
                }),
            );

            const payload = await startWizard();
            const go = findButton(payload, 'Go');

            await dispatch(
                makeComponentInteraction({
                    customId: go.data.custom_id!,
                    isButton: true,
                }),
            );

            expect(wizard.currentStepId).toBe('two');
        });

        it('completes when the selected choice has no next step', async () => {
            const completeListener = vi.fn();
            const payload = await startWizard();
            const chooseA = findButton(payload, 'Choose A');

            await dispatch(
                makeComponentInteraction({
                    customId: chooseA.data.custom_id!,
                    isButton: true,
                }),
            );

            wizard.on('complete', completeListener);

            const secondPayload = lastEditPayload(messageMocks);
            const chooseX = findButton(secondPayload, 'Choose X');

            await dispatch(
                makeComponentInteraction({
                    customId: chooseX.data.custom_id!,
                    isButton: true,
                }),
            );

            expect(completeListener).toHaveBeenCalledWith(
                { one: 'a', two: 'x' },
                expect.anything(),
            );
        });

        it('calls onComplete with the collected answers', async () => {
            const onComplete = vi.fn().mockResolvedValue(undefined);

            wizard = new Wizard(makeOptions({ onComplete }));

            const payload = await startWizard();
            const chooseB = findButton(payload, 'Choose B');

            await dispatch(
                makeComponentInteraction({
                    customId: chooseB.data.custom_id!,
                    isButton: true,
                }),
            );

            const secondPayload = lastEditPayload(messageMocks);
            const chooseY = findButton(secondPayload, 'Choose Y');

            await dispatch(
                makeComponentInteraction({
                    customId: chooseY.data.custom_id!,
                    isButton: true,
                }),
            );

            expect(onComplete).toHaveBeenCalledWith({
                wizard,
                stepId: 'two',
                answers: { one: 'b', two: 'y' },
                interaction: expect.anything(),
            });
        });

        it('disables components after completion when no handler is set', async () => {
            const payload = await startWizard();
            const chooseA = findButton(payload, 'Choose A');

            await dispatch(
                makeComponentInteraction({
                    customId: chooseA.data.custom_id!,
                    isButton: true,
                }),
            );

            const secondPayload = lastEditPayload(messageMocks);
            const chooseX = findButton(secondPayload, 'Choose X');

            await dispatch(
                makeComponentInteraction({
                    customId: chooseX.data.custom_id!,
                    isButton: true,
                }),
            );

            const finalPayload = lastEditPayload(messageMocks);

            expect(
                finalPayload.components.every((row) =>
                    row.components.every(
                        (component) => component.data.disabled,
                    ),
                ),
            ).toBe(true);
        });

        it('returns to the previous step and clears the abandoned answer', async () => {
            const three = makeStep('three', { content: 'third step' });

            wizard = new Wizard(
                makeOptions({
                    steps: [
                        makeStep('one', {
                            choices: [
                                { value: 'a', label: 'Choose A', next: 'two' },
                            ],
                        }),
                        makeStep('two', {
                            choices: [
                                {
                                    value: 'x',
                                    label: 'Choose X',
                                    next: 'three',
                                },
                            ],
                        }),
                        three,
                    ],
                }),
            );

            const payload = await startWizard();

            await dispatch(
                makeComponentInteraction({
                    customId: findButton(payload, 'Choose A').data.custom_id!,
                    isButton: true,
                }),
            );

            const secondPayload = lastEditPayload(messageMocks);

            await dispatch(
                makeComponentInteraction({
                    customId: findButton(secondPayload, 'Choose X').data
                        .custom_id!,
                    isButton: true,
                }),
            );

            expect(wizard.answers).toEqual({ one: 'a', two: 'x' });

            const thirdPayload = lastEditPayload(messageMocks);
            const back = findButton(thirdPayload, 'Back');

            expect(back.data.disabled).toBe(false);

            await dispatch(
                makeComponentInteraction({
                    customId: back.data.custom_id!,
                    isButton: true,
                }),
            );

            expect(wizard.currentStepId).toBe('two');
            expect(wizard.answers).toEqual({ one: 'a', two: 'x' });

            const fourthPayload = lastEditPayload(messageMocks);

            const secondBack = findButton(fourthPayload, 'Back');

            await dispatch(
                makeComponentInteraction({
                    customId: secondBack.data.custom_id!,
                    isButton: true,
                }),
            );

            expect(wizard.currentStepId).toBe('one');
            expect(wizard.answers).toEqual({ one: 'a' });
        });

        it('does nothing when Back is used on the first step', async () => {
            const payload = await startWizard();
            const back = findButton(payload, 'Back');

            expect(back.data.disabled).toBe(true);

            messageMocks.edit.mockClear();

            await dispatch(
                makeComponentInteraction({
                    customId: back.data.custom_id!,
                    isButton: true,
                }),
            );

            expect(wizard.currentStepId).toBe('one');
            expect(messageMocks.edit).not.toHaveBeenCalled();
        });

        it('renders select choices and records the selected value', async () => {
            wizard = new Wizard(
                makeOptions({
                    steps: [
                        makeStep(
                            'one',
                            {
                                navigation: 'select',
                                selectPlaceholder: 'Pick one',
                                choices: [
                                    {
                                        value: 'a',
                                        label: 'Option A',
                                        description: 'First option',
                                    },
                                    { value: 'b', label: 'Option B' },
                                ],
                            },
                            'two',
                        ),
                        stepTwo,
                    ],
                }),
            );

            const payload = await startWizard();
            const select = findSelect(payload);
            const options = select.toJSON().options;

            expect(select.data.custom_id).toContain(':select');
            expect(select.data.placeholder).toBe('Pick one');
            expect(options.map((option) => option.label)).toEqual([
                'Option A',
                'Option B',
            ]);

            const interaction = makeComponentInteraction({
                customId: select.data.custom_id!,
                isStringSelectMenu: true,
                values: ['1'],
            });

            await dispatch(interaction);

            expect(wizard.answers.one).toBe('b');
            expect(wizard.currentStepId).toBe('two');
        });

        it('rejects interactions from another user', async () => {
            const payload = await startWizard();
            const chooseA = findButton(payload, 'Choose A');

            const interaction = makeComponentInteraction({
                customId: chooseA.data.custom_id!,
                userId: 'other-user',
                isButton: true,
            });

            await dispatch(interaction);

            expect(interaction.reply).toHaveBeenCalledWith({
                content: 'You cannot control this wizard.',
                flags: MessageFlags.Ephemeral,
            });
            expect(interaction.deferUpdate).not.toHaveBeenCalled();
            expect(wizard.currentStepId).toBe('one');
        });

        it('rejects interactions after the wizard has stopped', async () => {
            const payload = await startWizard();

            await wizard.stop();

            const interaction = makeComponentInteraction({
                customId: findButton(payload, 'Choose A').data.custom_id!,
                isButton: true,
            });

            await dispatch(interaction);

            expect(interaction.reply).toHaveBeenCalledWith({
                content: 'This wizard has ended.',
                flags: MessageFlags.Ephemeral,
            });
        });

        it('rejects stale interactions from a previous render', async () => {
            const payload = await startWizard();
            const chooseA = findButton(payload, 'Choose A');

            await dispatch(
                makeComponentInteraction({
                    customId: chooseA.data.custom_id!,
                    isButton: true,
                }),
            );

            const interaction = makeComponentInteraction({
                customId: chooseA.data.custom_id!,
                isButton: true,
            });

            await dispatch(interaction);

            expect(interaction.reply).toHaveBeenCalledWith({
                content: 'This step is no longer active.',
                flags: MessageFlags.Ephemeral,
            });
            expect(wizard.currentStepId).toBe('two');
        });

        it('ignores an out-of-range choice index', async () => {
            const payload = await startWizard();
            const chooseA = findButton(payload, 'Choose A');
            const customId = chooseA.data.custom_id!.replace(
                /choice:\d+$/,
                'choice:99',
            );

            const interaction = makeComponentInteraction({
                customId,
                isButton: true,
            });

            await dispatch(interaction);

            expect(interaction.deferUpdate).toHaveBeenCalledOnce();
            expect(wizard.currentStepId).toBe('one');
            expect(wizard.answers).toEqual({});
        });
    });

    describe('lifecycle', () => {
        async function startWizard(): Promise<void> {
            await wizard.send(makeChannel(message));
        }

        it('disables components when the collector times out', async () => {
            await startWizard();

            messageMocks.edit.mockClear();
            collector.emit('end', new Map(), 'time');
            await settle();

            const payload = lastEditPayload(messageMocks);

            expect(
                payload.components.every((row) =>
                    row.components.every(
                        (component) => component.data.disabled,
                    ),
                ),
            ).toBe(true);
            expect(messageMocks.delete).not.toHaveBeenCalled();
            expect(wizard.wizardMessage).toBe(message);
        });

        it('deletes the message on timeout when deleteOnTimeout is true', async () => {
            const deleteListener = vi.fn();

            wizard = new Wizard(makeOptions({ deleteOnTimeout: true }));
            wizard.on('delete', deleteListener);

            await startWizard();

            collector.emit('end', new Map(), 'time');
            await settle();

            expect(messageMocks.delete).toHaveBeenCalledOnce();
            expect(deleteListener).toHaveBeenCalledOnce();
            expect(wizard.wizardMessage).toBeNull();
        });

        it.each([
            'messageDelete',
            'channelDelete',
            'threadDelete',
            'guildDelete',
        ])('clears the message after a %s event', async (reason) => {
            await startWizard();

            collector.emit('end', new Map(), reason);
            await settle();

            expect(wizard.wizardMessage).toBeNull();
        });

        it('stops the collector and disables components', async () => {
            await startWizard();

            const stopListener = vi.fn();
            wizard.on('stop', stopListener);

            await wizard.stop();

            expect(collector.stop).toHaveBeenCalledWith('wizard_stopped');
            expect(messageMocks.edit).toHaveBeenCalled();
            expect(stopListener).toHaveBeenCalledOnce();
        });

        it('does nothing when stopping before the wizard starts', async () => {
            await wizard.stop();

            expect(messageMocks.edit).not.toHaveBeenCalled();
        });

        it('deletes the message, clears it and emits delete', async () => {
            await startWizard();

            const deleteListener = vi.fn();
            wizard.on('delete', deleteListener);

            await wizard.delete();

            expect(messageMocks.delete).toHaveBeenCalledOnce();
            expect(wizard.wizardMessage).toBeNull();
            expect(deleteListener).toHaveBeenCalledOnce();
        });

        it('emits delete even when no message exists', async () => {
            const deleteListener = vi.fn();

            wizard.on('delete', deleteListener);

            await wizard.delete();

            expect(deleteListener).toHaveBeenCalledOnce();
        });

        it('propagates deletion errors', async () => {
            await startWizard();

            messageMocks.delete.mockRejectedValueOnce(
                new Error('Deletion failed'),
            );

            await expect(wizard.delete()).rejects.toThrow('Deletion failed');

            expect(wizard.wizardMessage).toBe(message);
        });
    });

    describe('validation', () => {
        it('rejects duplicate choice values', async () => {
            wizard = new Wizard(
                makeOptions({
                    steps: [
                        makeStep('one', {
                            choices: [
                                { value: 'same', label: 'First' },
                                { value: 'same', label: 'Second' },
                            ],
                        }),
                    ],
                }),
            );

            const channel = makeChannel(message);

            await expect(wizard.send(channel)).rejects.toThrow(
                'Duplicate choice value "same" on step "one".',
            );
            expect(channel.send).not.toHaveBeenCalled();
        });

        it('rejects a choice pointing to an unknown step', async () => {
            wizard = new Wizard(
                makeOptions({
                    steps: [
                        makeStep('one', {
                            choices: [
                                {
                                    value: 'a',
                                    label: 'A',
                                    next: 'missing',
                                },
                            ],
                        }),
                    ],
                }),
            );

            await expect(wizard.send(makeChannel(message))).rejects.toThrow(
                'Step "one" points to unknown next step "missing".',
            );
        });

        it('rejects more than 20 button choices', async () => {
            wizard = new Wizard(
                makeOptions({
                    steps: [
                        makeStep('one', {
                            choices: Array.from({ length: 21 }, (_, index) => ({
                                value: String(index),
                                label: `Choice ${index}`,
                            })),
                        }),
                    ],
                }),
            );

            await expect(wizard.send(makeChannel(message))).rejects.toThrow(
                'Button steps can have at most 20 choices because one row is reserved for Back.',
            );
        });

        it('rejects more than 25 select choices', async () => {
            wizard = new Wizard(
                makeOptions({
                    steps: [
                        makeStep('one', {
                            navigation: 'select',
                            choices: Array.from({ length: 26 }, (_, index) => ({
                                value: String(index),
                                label: `Choice ${index}`,
                            })),
                        }),
                    ],
                }),
            );

            await expect(wizard.send(makeChannel(message))).rejects.toThrow(
                'Select steps can have at most 25 choices.',
            );
        });

        it('renders only the Back row when a step has no choices', async () => {
            wizard = new Wizard(
                makeOptions({ steps: [makeStep('one', { content: 'empty' })] }),
            );

            const channel = makeChannel(message);

            await wizard.send(channel);

            const payload = sendPayload(channel);

            expect(payload.components).toHaveLength(1);
            expect(findButton(payload, 'Back').data.disabled).toBe(true);
        });
    });
});
