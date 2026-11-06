# TBDBot

A Discord bot framework built on `@discordjs/core`, published to npm as an ESM TypeScript library. It deliberately does **not** depend on `discord.js`: no cache manager, no sweepers, no `Collection`. Modules cover client/gateway lifecycle, typed events, commands and middleware, config, cache, stores, metrics, and interactive UI widgets.

## Commands

```sh
npm run typecheck        # tsc over src, tests, and examples
npm test                 # typecheck + vitest run
npm run build            # clean, esbuild bundle, declarations, specifier rewrite
npm run format           # prettier --write (src and tests only)
npm run format:check     # prettier --check (src and tests only)
npm run docs             # typedoc -> docs/ (generated)
npm run example:vertical-slice   # requires DISCORD_TOKEN and DISCORD_APPLICATION_ID
```

- Single test file: `npx vitest run tests/ui/router.test.ts`; watch mode: `npm run test:watch`.
- CI (`.github/workflows/ci.yml`) runs `npm ci`, `npm test`, `npm run build` on Node 20.x and 22.x. The runtime target is Node 20.
- Use npm for everything. `package-lock.json` is committed; don't switch package managers or hand-edit the lockfile.

## Layout

- `src/index.ts` and each module's `index.ts` are barrels. Add every new public export to them; the package entrypoint is `src/index.ts` only.
- Modules: `api/`, `cache/`, `commands/`, `config/`, `core/`, `interaction/`, `metrics/`, `permissions/`, `store/`, `testing/`, `ui/` (with `ui/menu`, `ui/modal`, `ui/panel`).
- `tests/` mirrors the source module structure (`tests/<module>/*.test.ts`), plus `tests/type-safety.test.ts` for compile-time regressions. Fixtures live next to their tests (e.g. `tests/config/fixtures/`).
- `docs/` is generated Typedoc output and is committed for GitHub Pages. Never edit it by hand; change the JSDoc and run `npm run docs`.
- `scripts/rewrite-declarations.mjs` appends `.js` to relative specifiers in emitted `.d.ts` files. Source imports stay extensionless; don't add extensions to source specifiers to work around it.
- `dist/` is build output and is not committed.

## Conventions

- Strict TypeScript with `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noUnusedLocals`, and `noUnusedParameters`. Options and public data shapes are `readonly`.
- ESM with `moduleResolution: bundler` and `verbatimModuleSyntax`: use `import type` for type-only imports and keep relative imports extensionless.
- Prettier config: 4-space indent, single quotes, semicolons, trailing commas. Run `npm run format` after editing `src/` or `tests/`.
- Public API is documented with JSDoc, because Typedoc publishes it. Document exported types and functions you add, and use `@defaultValue` for defaults.
- Throw dedicated error classes for framework failures (see `ConfigError`, `MessageExpiredError`) rather than bare `Error`.
- Interactions stay plain data plus helpers — no wrapper class hierarchy and no hidden cache. Permission bitfields are `bigint`.
- Custom ids are framework-owned strings in the shape `<namespace>:<widgetId>:<action>`. Mint them with `button()`, `select()`, and `createCustomId()` instead of writing raw values.
- Widgets never own state: the framework holds it and passes it back through `render(state)`.
- Tests run with Vitest in a Node environment and never touch the network. Use `createMockClient`, `MockTransport`, the mock gateway/REST, and the factories in `src/testing/`; assert real behavior and request shapes rather than mere presence.
- Don't add runtime dependencies without asking. Discord access already comes through `@discordjs/core`, `@discordjs/builders`, `@discordjs/rest`, `@discordjs/ws`, and `discord-api-types`.

## Releases

- `CHANGELOG.md` follows Keep a Changelog; record user-facing changes under `[Unreleased]`.
- Publishing happens from a GitHub release (`.github/workflows/publish.yml` runs `npm publish --provenance`). Don't bump the version or publish unless asked.

## Git

- History uses Conventional Commits with module scopes: `fix(cache): ...`, `feat(ui): ...`, plus `docs:`, `test:`, `refactor:`, and `chore:`.
- `main` is the only long-lived branch; ask before creating a branch.
- Keep commits focused: one behavior change or fix per commit, with its tests, and keep documentation/refactor commits separate.
