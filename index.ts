import {  ActionRow, type MessageActionRowComponent, MessageComponentInteraction, EmbedBuilder, type Message, ComponentType, ActionRowBuilder, ButtonBuilder, ButtonStyle, type MessageActionRowComponentBuilder, type MessageCreateOptions, MessageFlags, type RepliableInteraction, ButtonInteraction, type InteractionEditReplyOptions, type InteractionReplyOptions, type TextBasedChannel } from 'discord.js'
import { EventEmitter } from 'events'

const NAV_PREFIX = 'menu:navigation'

//TODO: implement proper wizards (for now user can handle it)
/* interface MenuChoice {
    label: string;
    targetPageName: string;
    description?: string;
} */

interface MenuPage {
    readonly name: string;
    readonly embed: EmbedBuilder;
    readonly components?: readonly ActionRow<MessageActionRowComponent>[];
    readonly onInteraction?: (
        interaction: MessageComponentInteraction,
        menu: Menu,
    ) => void | Promise<void>
}

//TODO: Add different navigation systems
interface MenuOptions {
    readonly userId: string;
    readonly pages: readonly MenuPage[];
    readonly timeout?: number;
    readonly deleteOnTimeout?: boolean;
    readonly onPageChange?: (
        page: MenuPage,
        index: number,
    ) => void | Promise<void>;
    readonly access?: MenuAccess;
    //readonly navigation?: MenuNavigation;
}


interface MenuDeliveryOptions {
    readonly ephemeral?: boolean;
}

type MenuAccess =
    | { type: "caller-only" }
    | { type: "everyone" }
    | {
          type: "custom";
          filter: (interaction: MessageComponentInteraction) => boolean | Promise<boolean>;
      };

type MenuNavigation =
    | { type: "none" }
    | { type: "previous-next" }
    | { type: "wizard" }
    | { type: "previous-select-next" };

type MenuMessageOptions = Omit<MessageCreateOptions, "embeds" | "components" | "flags">;

type NavigationAction = "previous" | "next" | "stop";

type CompatibleMessageOptions = InteractionReplyOptions & InteractionEditReplyOptions & MessageCreateOptions



class Menu extends EventEmitter {
    private readonly userId: string;
    private readonly pages: readonly MenuPage[];
    private readonly timeout: number;
    private readonly deleteOnTimeout: boolean;
    private readonly onPageChange: MenuOptions["onPageChange"];

    private access: MenuAccess;
    //private navigation: MenuNavigation;

    private pageIndex = 0;
    private message: Message | null = null;
    private collector: ReturnType<Message["createMessageComponentCollector"]> | null = null;
    private started = false;
    private stopped = false;

    constructor(options: MenuOptions) {
        super();

        if (options.pages.length === 0) {
            throw new RangeError("A menu must have at least one page.");
        }

        if (!options.userId.trim()) {
            throw new TypeError("userId must be present.");
        }

        this.userId = options.userId;
        this.pages = options.pages;
        this.timeout = options.timeout ?? 180_000;
        this.deleteOnTimeout = options.deleteOnTimeout ?? false;
        this.onPageChange = options.onPageChange;

        this.access = options.access ?? {type: 'caller-only'};
        //this.navigation = options.navigation ?? {type: 'previous-next'};

        if (!Number.isFinite(this.timeout) || this.timeout <= 0) {
            throw new RangeError("timeout must be a positive number.");
        }

        const names = new Set<string>();

        for (const page of this.pages) {
            if (!page.name.trim()) {
                throw new TypeError("Page name must not be empty.");
            }

            if (names.has(page.name)) {
                throw new Error(`Duplicate page name: "${page.name}".`);
            }

            names.add(page.name);

            if ((page.components?.length ?? 0) > 4) {
                throw new RangeError(`Pages can have at most four custom rows, "${page.name}" has ${page.components?.length}`);
            }

            for (const row of page.components ?? []) {
                for (const component of row.components) {
                    if (
                        component.type === ComponentType.Button &&
                        component.customId?.startsWith(NAV_PREFIX)
                    ) {
                        throw new Error(`Custom component IDs must not use "${NAV_PREFIX}".`);
                    }
                }
            }
        }
    }

    public get currentPage(): MenuPage {
        return this.pages[this.pageIndex]!;
    }

    public get currentPageIndex(): number {
        return this.pageIndex;
    }

    public get menuMessage(): Message | null {
        return this.message;
    }

    public async reply(interaction: RepliableInteraction, delivery: MenuDeliveryOptions = {}, messageOptions: MenuMessageOptions = {}): Promise<Message> {
        const payload = this.buildPayload(messageOptions);
        
        if (interaction.replied) {
            throw new Error(
                "This interaction has already been replied to. Use followUp() instead.",
            );
        }
        
        if (interaction.deferred) {
            await interaction.editReply(payload);
        } else {
            await interaction.reply({
                ...payload,
                flags: delivery.ephemeral === false ? undefined : MessageFlags.Ephemeral,
            });
        }
        
        const message = await interaction.fetchReply();
        return this.initializeMessage(message);
    }

    public async followUp(interaction: RepliableInteraction, delivery: MenuDeliveryOptions = {}, messageOptions: MenuMessageOptions = {}): Promise<Message> {
        const payload = this.buildPayload(messageOptions);
        
        const message = await interaction.followUp({
            ...payload,
            flags: delivery.ephemeral === false ? undefined : MessageFlags.Ephemeral,
        });
        
        return this.initializeMessage(message);
    }

    public async send(channel: TextBasedChannel, messageOptions: MenuMessageOptions = {}): Promise<Message> {
        if (!channel.isSendable()) {
            throw new Error("This channel is not sendable.");
        }
        const message = await channel.send(
            this.buildPayload(messageOptions),
        );
        
        return this.initializeMessage(message);
    }

    public async setPage(index: number): Promise<void> {
        if (!this.message) {
        throw new Error("Start the menu before changing pages.");
        }

        if (this.stopped) {
        throw new Error("This menu has stopped.");
        }

        if (!Number.isInteger(index) || index < 0 || index >= this.pages.length) {
        throw new RangeError(`Invalid page index: ${index}.`);
        }

        this.pageIndex = index;

        await this.message.edit({
        embeds: [this.currentPage.embed],
        components: this.buildComponents(),
        });

        await this.notifyPageChange();
    }

    public async stop(): Promise<void> {
        if (this.stopped) return;

        this.stopped = true;
        this.collector?.stop("menu_stopped");
        //await this.disableComponents();
        this.emit("stop");
    }

    public async delete(): Promise<void> {
        this.stopped = true;
        this.collector?.stop("menu_deleted");

        const message = this.message;
        this.message = null;

        if (message) {
        await message.delete();
        }

        this.emit("delete");
    }

    private async handleInteraction(interaction: MessageComponentInteraction): Promise<void> {
        if (!(await this.canInteract(interaction))) {
            await interaction.reply({
                content: "You cannot control this menu.",
                ephemeral: true,
            });
            return;
        }

        if (this.stopped) {
            await interaction.reply({
                content: "This menu has ended.",
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
            content: "This component has no action handler.",
            ephemeral: true,
        });
        return;
        }

        // Custom handlers own acknowledgement. They may reply, defer,
        // update the message, or open a modal, depending on the action.
        await handler(interaction, this);
    }

    private async canInteract(interaction: MessageComponentInteraction): Promise<boolean> {
        switch (this.access?.type) {
            case "caller-only":
                return interaction.user.id === this.userId;

            case "everyone":
                return true;

            case "custom":
                return this.access.filter(interaction);
        }
    }

    private async handleNavigation(interaction: ButtonInteraction): Promise<void> {
        const action = interaction.customId.slice(NAV_PREFIX.length) as NavigationAction;

        if (
        action !== "previous" &&
        action !== "next" &&
        action !== "stop"
        ) {
            await interaction.deferUpdate();
            return;
        }

        await interaction.deferUpdate();

        switch (action) {
            case "previous":
                if (this.pageIndex > 0) {
                    await this.setPage(this.pageIndex - 1);
                }
                break;

            case "next":
                if (this.pageIndex < this.pages.length - 1) {
                    await this.setPage(this.pageIndex + 1);
                }
                break;

            case "stop":
                await this.stop();
                break;
        }
    }

    private buildPayload(messageOptions: MenuMessageOptions): CompatibleMessageOptions {
        return {
            ...messageOptions,
            embeds: [this.currentPage.embed],
            components: this.buildComponents(),
        };
    }

    private buildComponents(): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
        const navigation = new ActionRowBuilder<MessageActionRowComponentBuilder>()
        .addComponents(
            new ButtonBuilder()
            .setCustomId(`${NAV_PREFIX}previous`)
            .setLabel("Previous")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(this.pageIndex === 0),
            new ButtonBuilder()
            .setCustomId(`${NAV_PREFIX}next`)
            .setLabel("Next")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(this.pageIndex === this.pages.length - 1),
            new ButtonBuilder()
            .setCustomId(`${NAV_PREFIX}stop`)
            .setLabel("Stop")
            .setStyle(ButtonStyle.Danger),
        );

        const pageRows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = (this.currentPage.components ?? []).map(
            (row) => ActionRowBuilder.from<MessageActionRowComponentBuilder>(row),
        );

        return [...pageRows, navigation];
    }

    private async notifyPageChange(): Promise<void> {
        await this.onPageChange?.(this.currentPage, this.pageIndex);
        this.emit("pageChange", this.currentPage, this.pageIndex);
    }

    /* private async disableComponents(): Promise<void> {
        if (!this.message) return;

        const rows = this.message.components.map((componentRow) => {
            const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();

            for (const component of componentRow.components) {
                if (component.type === ComponentType.Button) {
                row.addComponents(
                    ButtonBuilder.from(component).setDisabled(true),
                );
                } else {
                // Non-button components need their own builder type to be
                // disabled safely. Preserve them rather than casting builders.
                return null;
                }
            }

            return row;
        });

        // Avoid silently replacing or dropping select menus and other controls.
        // A production implementation should disable each component using its
        // concrete builder type.
        await this.message.edit({
        components: rows.filter(
            (row): row is ActionRowBuilder<MessageActionRowComponentBuilder> =>
            row !== null,
        ),
        }).catch(() => undefined);
    } */

    private initializeMessage(message: Message): Message {
        if (this.started) {
            throw new Error("This menu has already been started.");
        }
        
        this.started = true;
        this.message = message;
        
        this.collector = message.createMessageComponentCollector({
            time: this.timeout,
            filter: (interaction) => interaction.user.id === this.userId,
        });
        
        this.collector.on("collect", (interaction) => {
            void this.handleInteraction(interaction).catch(
                (error: unknown) => this.emit("error", error),
            );
        });
        
        this.collector.on("end", () => {
            this.stopped = true;
            this.emit("end");
            
            if (this.deleteOnTimeout) {
                void this.message?.delete().catch(() => undefined);
            } else {
                //void this.disableComponents();
            }
        });
        
        void this.notifyPageChange().catch(
            (error: unknown) => this.emit("error", error),
        );
        
        return message;
    }
}
