/**
 * The vertical slice: the smallest end-to-end path through the framework.
 *
 * It connects to Discord, registers one slash command, responds to it,
 * edits the response, attaches one button, handles the button click, and
 * edits the message again. Everything else in the framework is an
 * elaboration of this path.
 *
 * Run it with:
 *
 * ```sh
 * DISCORD_TOKEN=... DISCORD_APPLICATION_ID=... npx tsx examples/vertical-slice.ts
 * ```
 *
 * The command it registers is `/ping`. Press the button it renders and watch
 * the message count.
 */
import { SlashCommandBuilder } from '@discordjs/builders';
import { GatewayIntentBits } from 'discord-api-types/v10';

import {
    CommandManager,
    FrameworkClient,
    WidgetRouter,
    button,
    generateRoutingId,
    renderContent,
} from '../src/index';
import type { ActionContext, Widget } from '../src/index';

const token = process.env['DISCORD_TOKEN'];
const applicationId = process.env['DISCORD_APPLICATION_ID'];

if (!token) {
    throw new Error('Set DISCORD_TOKEN to run the vertical slice.');
}

const client = new FrameworkClient({
    token,
    intents: GatewayIntentBits.Guilds,
});

const router = new WidgetRouter(client.api);
const commands = new CommandManager({ api: client.api });

/**
 * The widget the slice renders: a counter with a single button.
 *
 * The widget does not own its state — the framework holds the number and
 * hands it back on every render, so `update` replaces it rather than
 * mutating it.
 */
class Counter implements Widget<number> {
    public readonly id: string;

    public readonly routingId: string;

    public constructor(routingId: string) {
        this.id = routingId;
        this.routingId = routingId;
    }

    public render(state: number) {
        return {
            content: `Pressed ${state} time${state === 1 ? '' : 's'}.`,
            components: [[button('increment', 'Press me')]],
        };
    }

    public async onAction(
        action: string,
        context: ActionContext<number>,
    ): Promise<void> {
        if (action !== 'increment') {
            return;
        }

        // Acknowledge the interaction before doing any work: the token is
        // only valid for three seconds.
        await context.interaction.deferUpdate();

        await context.update(context.state + 1);
    }
}

commands.add({
    name: 'ping',
    description: 'Reply with a button that counts its presses.',
    builder: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Reply with a button that counts its presses.'),
    async execute({ interaction }) {
        const channelId = interaction.channelId;

        if (!channelId) {
            await interaction.reply({
                content: 'This command needs a channel.',
            });

            return;
        }

        // Acknowledge the interaction first: the token is only valid for
        // three seconds.
        await interaction.defer();

        const counter = new Counter(generateRoutingId());
        const content = await counter.render(0);
        const message = renderContent(content, 'ui', counter.routingId);

        const sent = await client.api.channels.createMessage(
            channelId,
            message as never,
        );

        await router.register(
            counter,
            { kind: 'channel', channelId, messageId: sent.id },
            0,
        );

        await interaction.editReply({ content: 'Look below.' });
    },
});

client.handleInteractions(async (interaction) => router.handle(interaction));

client.on('ready', async (info) => {
    console.log(`ready as ${info.applicationId} on shard ${info.shardId}`);

    if (applicationId) {
        await commands.registerGlobal(applicationId);

        console.log('registered /ping');
    }
});

process.on('SIGINT', () => {
    void client.destroy().then(() => process.exit(0));
});

await client.connect();
