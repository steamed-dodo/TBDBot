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
    ComponentType,
    StringSelectMenuBuilder,
    UserSelectMenuBuilder,
    RoleSelectMenuBuilder,
    MentionableSelectMenuBuilder,
    ChannelSelectMenuBuilder,
} from 'discord.js';
import { EventEmitter } from 'events';
import type {
    MenuPage,
    MenuOptions,
    MenuAccess,
    MenuDeliveryOptions,
    MenuMessageOptions,
    NavigationAction,
    CompatibleMessageOptions,
} from './types';

const NAV_PREFIX = 'menu:navigation';

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
 * Emitted after the page-change callback completes successfully.
 * Receives the active {@link MenuPage} and its zero-based index.
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
    private readonly userId: string;
    private readonly pages: readonly MenuPage[];
    private readonly timeout: number;
    private readonly deleteOnTimeout: boolean;
    private readonly onPageChange: MenuOptions['onPageChange'];

    private readonly access: MenuAccess;

    private pageIndex = 0;
    private pageChangeQueue: Promise<void> = Promise.resolve();

    private message: Message | null = null;
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

        this.userId = options.userId;
        this.pages = options.pages;
        this.timeout = options.timeout ?? 180_000;
        this.deleteOnTimeout = options.deleteOnTimeout ?? false;
        this.onPageChange = options.onPageChange;

        this.access = options.access ?? { type: 'caller-only' };

        if (!Number.isFinite(this.timeout) || this.timeout <= 0) {
            throw new RangeError('timeout must be a positive number.');
        }

        const names = new Set<string>();

        for (const page of this.pages) {
            if (!page.name.trim()) {
                throw new TypeError('Page name must not be empty.');
            }

            if (names.has(page.name)) {
                throw new Error(`Duplicate page name: "${page.name}".`);
            }

            names.add(page.name);

            if ((page.components?.length ?? 0) > 4) {
                throw new RangeError(
                    `Pages can have at most four custom rows, "${page.name}" has ${page.components?.length}`,
                );
            }

            for (const row of page.components ?? []) {
                for (const component of row.components) {
                    if (
                        'customId' in component &&
                        component.customId?.startsWith(NAV_PREFIX)
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
     * is edited instead. Otherwise, a new response is created.
     *
     * @param interaction - The interaction to respond to.
     * @param delivery - Options controlling response visibility.
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
        delivery: MenuDeliveryOptions = {},
        messageOptions: MenuMessageOptions = {},
    ): Promise<Message> {
        const payload = this.buildPayload(messageOptions);

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
                flags:
                    delivery.ephemeral === false
                        ? undefined
                        : MessageFlags.Ephemeral,
            });
        }

        const message = await interaction.fetchReply();
        return await this.initializeMessage(message);
    }

    /**
     * Sends the menu as an additional interaction follow-up.
     *
     * @param interaction - The interaction to follow up on.
     * @param delivery - Options controlling response visibility.
     * @param messageOptions - Additional message options managed by Discord.
     * @returns The resulting Discord message.
     *
     * @throws If Discord rejects the follow-up or this menu cannot be initialized.
     */
    public async followUp(
        interaction: RepliableInteraction,
        delivery: MenuDeliveryOptions = {},
        messageOptions: MenuMessageOptions = {},
    ): Promise<Message> {
        const payload = this.buildPayload(messageOptions);

        const message = await interaction.followUp({
            ...payload,
            flags:
                delivery.ephemeral === false
                    ? undefined
                    : MessageFlags.Ephemeral,
        });

        return await this.initializeMessage(message);
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
        if (!channel.isSendable()) {
            throw new Error('This channel is not sendable.');
        }
        const message = await channel.send(this.buildPayload(messageOptions));

        return await this.initializeMessage(message);
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
        const operation = this.pageChangeQueue.then(() =>
            this.performPageChange(index),
        );

        this.pageChangeQueue = operation.catch(() => undefined);

        return operation;
    }

    /**
     * Stops the menu without deleting its message.
     *
     * Stops collecting interactions and emits the `stop` event.
     * Existing message components are not automatically disabled.
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
     * Clears the stored message reference before attempting deletion.
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
            await message.delete();
        }

        this.message = null;

        this.emit('delete');
    }

    private async performPageChange(index: number): Promise<void> {
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

        const message = this.message;
        const page = this.pages[index]!;

        try {
            await message.edit({
                embeds: [page.embed],
                components: this.buildComponents(index),
            });
        } catch (error) {
            throw new Error(
                'There was an issue updating the message to new page',
                {
                    cause: error,
                },
            );
        }

        this.pageIndex = index;

        await this.notifyPageChange();
    }

    private async handleInteraction(
        interaction: MessageComponentInteraction,
    ): Promise<void> {
        if (!(await this.canInteract(interaction))) {
            await interaction.reply({
                content: 'You cannot control this menu.',
                ephemeral: true,
            });
            return;
        }

        if (this.stopped) {
            await interaction.reply({
                content: 'This menu has ended.',
                ephemeral: true,
            });
            return;
        }

        if (interaction.customId.startsWith(NAV_PREFIX)) {
            if (!interaction.isButton()) {
                await interaction.deferUpdate();
                return;
            }

            await this.handleNavigation(interaction);
            return;
        }

        const handler = this.currentPage.onInteraction;

        if (!handler) {
            await interaction.reply({
                content: 'This component has no action handler.',
                ephemeral: true,
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
                        ephemeral: true,
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

        if (action !== 'previous' && action !== 'next') {
            await interaction.deferUpdate();
            return;
        }

        await interaction.deferUpdate();

        switch (action) {
            case 'previous':
                if (this.pageIndex > 0) {
                    await this.setPage(this.pageIndex - 1);
                }
                break;

            case 'next':
                if (this.pageIndex < this.pages.length - 1) {
                    await this.setPage(this.pageIndex + 1);
                }
                break;
        }
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
        const navigation =
            new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId(`${NAV_PREFIX}previous`)
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(index === 0),
                new ButtonBuilder()
                    .setCustomId(`${NAV_PREFIX}next`)
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(index === this.pages.length - 1),
            );

        const pageRows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = (
            this.pages[index]!.components ?? []
        ).map((row) =>
            ActionRowBuilder.from<MessageActionRowComponentBuilder>(row),
        );

        return [...pageRows, navigation];
    }

    private async notifyPageChange(): Promise<void> {
        await this.onPageChange?.(this.currentPage, this.pageIndex);
        this.emit('pageChange', this.currentPage, this.pageIndex);
    }

    private async disableComponents(): Promise<void> {
        const message = this.message;

        if (!message) return;

        const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];

        for (const componentRow of message.components) {
            if (componentRow.type !== ComponentType.ActionRow) {
                throw new Error(
                    `Unsupported top-level component type: ${componentRow.type}`,
                );
            }

            const components: MessageActionRowComponentBuilder[] =
                componentRow.components.map((component) => {
                    switch (component.type) {
                        case ComponentType.Button:
                            return ButtonBuilder.from(component).setDisabled(
                                true,
                            );

                        case ComponentType.StringSelect:
                            return StringSelectMenuBuilder.from(
                                component,
                            ).setDisabled(true);

                        case ComponentType.UserSelect:
                            return UserSelectMenuBuilder.from(
                                component,
                            ).setDisabled(true);

                        case ComponentType.RoleSelect:
                            return RoleSelectMenuBuilder.from(
                                component,
                            ).setDisabled(true);

                        case ComponentType.MentionableSelect:
                            return MentionableSelectMenuBuilder.from(
                                component,
                            ).setDisabled(true);

                        case ComponentType.ChannelSelect:
                            return ChannelSelectMenuBuilder.from(
                                component,
                            ).setDisabled(true);

                        default:
                            throw new Error(`Unsupported component type`);
                    }
                });

            rows.push(
                new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
                    components,
                ),
            );
        }

        await message.edit({ components: rows });
    }

    private async initializeMessage(message: Message): Promise<Message> {
        if (this.started) {
            throw new Error('This menu has already been started.');
        }

        this.started = true;
        this.message = message;

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

            if (reason !== 'time') return;

            if (this.deleteOnTimeout) {
                const message = this.message;
                this.message = null;

                void message
                    ?.delete()
                    .catch((error: unknown) => this.emit('menuError', error));
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
