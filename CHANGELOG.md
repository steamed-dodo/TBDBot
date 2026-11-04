# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-11-04

### Added

- `FrameworkClient` built on `@discordjs/core` with ordered connect/destroy lifecycle.
- Typed event routing with tiered dispatch events and cache invalidation integration.
- `Interaction` wrapper with helpers for replies, defers, follow-ups, modals, and autocomplete.
- `PermissionsBitField` backed by `bigint` with guild/channel/member permission resolution.
- Command framework with builder-derived schema validation, middleware (`guildOnly`, `ownerOnly`, `permission`, `cooldown`), and argument parsing.
- Widget engine with `WidgetRouter`, shared `Flow` base, `Menu`, `Wizard`, and persistent `Panel` support via `PanelManager`/`PanelStore`.
- `Modal` widget routed by custom IDs.
- Config loading with schema validation, multiple sources (`envSource`, `fileSource`), and secret redaction.
- Cache with opt-in tiers (`minimal` by default, `inclusive` available), pluggable stores, and gateway-driven invalidation.
- Store implementations: `MemoryStore`, `JsonFileStore`, `RedisStore` (with injected client, `SCAN`-based operations).
- Prometheus-style metrics (`MetricRegistry`, counters/gauges/histograms) with mountable HTTP handler (no port owned by framework).
- Testing utilities: `createMockClient`, mock gateway/transport/rest, interaction/message/component factories.
- UI helpers for buttons/selects, custom ID minting/parsing, rendering pipeline with Discord API shape constraints.
- Ephemeral message lifetime tracking (15-minute interaction token window) with `MessageExpiredError`.

### Changed

- Rebuilt framework foundation on `@discordjs/core` (no `discord.js` dependency).
- Widget state ownership centralized in the framework; widgets receive state via `render(state)`.
- Custom IDs are framework-owned in `<namespace>:<widgetId>:<action>` shape with short routing IDs.
- Redis `clear` uses `SCAN` iterations rather than `KEYS` to avoid blocking.
- Permission checks do not resolve `Object.prototype` members.

### Fixed

- Cache invalidation reaches every entry for a guild and handles eviction correctly.
- Command required-option validation scoped to the invoked branch.
- Widget contract enforced (state required at registration, button style required).
- Ephemeral message edit/delete routed through webhook path with correct route shapes.
- Modal components parsed correctly (Label/TextInput format).
- Permission prototype access rejected safely.
- TTL expiration and sweep behavior corrected with proper boundary handling.

### Security

- Secrets redacted in config logs.
- Permission bitfields use `bigint` to avoid integer overflow.
- Label values escaped in Prometheus exposition.
