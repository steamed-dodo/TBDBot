# TBDBot

**TBDBot** — a Discord bot framework built on [`@discordjs/core`](https://github.com/discordjs/discord.js/tree/main/packages/core).

The framework covers the whole bot lifecycle: client and gateway wiring, typed
events, commands and middleware, configuration, caching, persistence, metrics,
and interactive UI primitives. It deliberately does **not** depend on
`discord.js`: there is no cache manager, no sweepers, and no `Collection`, so a
long-running bot no longer accumulates a guild/member graph.

## Installation

```sh
npm install tbdbot
```

## At a glance

```ts
import {
    FrameworkClient,
    Menu,
    WidgetRouter,
    Wizard,
    button,
} from 'tbdbot';

const client = new FrameworkClient({ token: process.env.BOT_TOKEN! });
const router = new WidgetRouter(client.api);

client.on('interactionCreate', async (interaction) => {
    if (await router.handle(interaction)) {
        return;
    }
});

const wizard = new Wizard({
    api: client.api,
    userId: interaction.userId,
    steps: [
        {
            id: 'language',
            render: () => ({ content: 'Pick a language' }),
            choices: [
                { value: 'ts', label: 'TypeScript' },
                { value: 'js', label: 'JavaScript' },
            ],
            next: 'done',
        },
        {
            id: 'done',
            render: ({ answers }) => ({
                components: [[button('restart', 'Start over', { style: 2 })]],
                content: `You picked ${answers['language']}`,
            }),
        },
    ],
    onComplete: ({ answers }) => console.log(answers),
});

await wizard.reply(interaction, { ephemeral: true }, router);
```

## Modules

### Core

`FrameworkClient` owns the `REST` instance, the gateway, and the connect and
destroy lifecycle. It translates the raw gateway dispatches into friendly,
typed events:

```ts
client.on('ready', (info) => console.log(info.applicationId));
client.on('messageCreate', (message) => console.log(message.raw));
client.on('guildRoleUpdate', (event) => console.log(event.roleId));
```

Shutdown is ordered deliberately: interactions stop being accepted, the
registered shutdown tasks run (flush metrics, close stores), and only then is
the gateway destroyed.

### Interactions

An interaction is plain data plus a thin set of helpers. There is no class
hierarchy and no cache: the payload Discord sent stays exactly as it was.

```ts
interaction.reply({ content: 'Hello' });
interaction.defer();
interaction.deferUpdate();
interaction.editReply({ content: 'Edited' });
interaction.followUp({ content: 'Follow-up' });
interaction.createModal({ customId, title, components });
```

Permission bitfields are `bigint`, because Discord's values exceed
`Number.MAX_SAFE_INTEGER`.

### Permissions

`PermissionsBitField` is `bigint`-backed, and `resolvePermissions` applies the
guild roles, the channel overwrites, and the member overwrite in Discord's
documented order.

```ts
const { channel } = resolvePermissions({ guild, roles, member, channel });

channel.has(PermissionsBitField.Flags.ManageGuild);
```

### UI

The UI layer is a widget engine: a widget is a unit of state plus the way it
is displayed, and the router resolves an incoming `custom_id` to a widget and
an action.

A widget does **not** own its state. The framework holds the one true value
and hands it back to `render(state)` on every repaint, so replacing the state
is always safe:

```ts
await router.update(routingId, nextState);
```

- **`Menu`** — a linear, paginated menu with previous/next chrome.
- **`Wizard`** — a branching, choice-driven flow that captures answers and
  can go back.
- **`Panel`** — a persistent widget, restored at boot from a store.
- **`Modal`** — a widget with a different render target, routed by its
  `custom_id`.
- **`WidgetRouter`** — resolves custom ids, dispatches actions, and queues
  interactions that arrive before a persistent widget has been restored.

`Menu` and `Wizard` are separate classes over a shared `Flow` base rather
than one class with a mode flag: what makes a menu a menu and a wizard a
wizard is how their steps are traversed, and that is a difference in the
state transitions.

Custom ids are framework-owned strings in the shape
`<namespace>:<widgetId>:<action>`. Use the `button()` and `select()` helpers
rather than raw builders: the framework mints the `custom_id`, and the
routing id is short so that the 100-character budget is mostly left for your
actions.

```ts
button('confirm', 'Confirm', { style: ButtonStyle.Success });
select('pick', [{ label: 'One', value: 'one' }]);
```

> **An ephemeral message can only be edited for 15 minutes.** An interaction
> token is valid for that long, and an ephemeral message lives on the
> interaction webhook. Updating one past that point throws
> `MessageExpiredError` rather than making a doomed request. A widget that
> needs long-lived updates should be delivered to a channel instead.

### Commands

The builder stays the source of truth. At registration time the framework
derives the option schema from it, validates the schema, and at invocation
time validates the incoming options against it and produces a plain `args`
record.

```ts
manager.add({
    name: 'ban',
    description: 'Ban a member',
    builder: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban a member')
        .addUserOption((option) => option.setName('target').setDescription('The member')),
    permissions: PermissionsBitField.Flags.BanMembers,
    cooldown: 5000,
    execute: ({ args }) => console.log(args.target),
});
```

Middleware wraps the handler and replaces the hand-rolled `if` ladders:
`guildOnlyMiddleware`, `ownerOnlyMiddleware`, `permissionMiddleware` and
`cooldownMiddleware`.

### Config

Schema-based, environment-aware, and validated once at startup. Secrets are
redacted when the configuration is logged.

```ts
const { values } = await loadConfig(
    {
        token: { type: 'string', required: true, secret: true, env: 'BOT_TOKEN' },
        prefix: { type: 'string', default: '!' },
    },
    [envSource(), fileSource('./config.json')],
);
```

### Cache

Caching is opt-in and deliberate. The minimal tier is on by default and holds
only the two lookups permission checks need: the guild roles and the channel
overwrites. The inclusive tier adds the caches `discord.js` keeps, with the
same limits, and is never enabled implicitly.

```ts
const cache = new Cache({ tier: 'inclusive' });
attachCacheInvalidation(client, cache);
```

### Stores

`MemoryStore`, `JsonFileStore` and `RedisStore` implement the same plain
key-value contract. The Redis client is injected, so the framework does not
depend on a particular driver.

### Metrics

The Prometheus text exposition is hand-rolled, so the label sets are exactly
what the framework controls. The framework never owns a port: it exposes a
mountable handler instead.

```ts
const metrics = new FrameworkMetrics();

http.createServer(metrics.handler().listener).listen(9090);
```

### Testing

Every layer that touches Discord is exercised through raw payloads and an
injectable transport, so the whole framework is testable without a network.

```ts
const mock = createMockClient();

mock.dispatch('READY', { application: { id: 'app-1' } });
```

## Development

```sh
npm run typecheck
npm test
npm run build
```

## License

[MIT](LICENSE)
