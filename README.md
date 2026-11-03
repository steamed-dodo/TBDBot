# @my-lib/utils

Reusable Discord.js utilities for building interactive bots: paginated menus, persistent panels, and session-only wizards.

## Scope

This package currently targets `discord.js@^14.27.0`. It is intended to grow into a broader Discord bot framework; future versions may introduce an adapter layer for `@discordjs/core`.

## Exports

### Menu

Paginated message menus with built-in navigation.

- Navigation modes: `prev-next`, `prev-select-next`, `select`, `wizard`.
- Per-page custom component rows, access control, timeouts, and page-change callbacks.
- History-backed `back()` for wizard-style flows.

### Panel

Persistent messages that survive bot restarts when paired with a `PanelManager`.

- No timeout or collector; interactions are routed by message ID.
- Serializable state via `serialize()` and factory-based restoration.
- `MemoryPanelStore` and `JsonFilePanelStore` included.

### Wizard

Session-only, choice-driven flows.

- Steps render choices as buttons or a string select menu.
- Records answers by step ID, supports branching, and clears abandoned answers on Back.
- Ephemeral or public delivery via `reply`, `followUp`, and `send`.

## Installation

```sh
npm install @my-lib/utils discord.js
```

## Development

```sh
npm run typecheck
npm test
npm run build
```

## License

ISC
