# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.1] — 2026-04-08

### Fixed
- **Bridge timeout was hardcoded at 30s**, causing SMTP send operations to fail silently when delivery took longer (typical for Migadu, Protonmail, and other providers with strict outbound checks).
- Bridge now defaults to **120 seconds** and is fully configurable.

### Added
- `TB_BRIDGE_TIMEOUT` environment variable on the bridge daemon (default: 120000 ms)
- `X-TB-Timeout` HTTP header for per-request override
- CLI and MCP HTTP clients now propagate their `--timeout` value to the bridge via the new header
- `defaultTimeoutMs` field in `/bridge/status` response (so clients can introspect)
- Automated GitHub Release workflow (attaches signed XPI to version tags) — added in 1.0.0 dev cycle
- `npm run build:xpi` build script for cross-platform XPI packaging — added in 1.0.0 dev cycle
- Demo GIF recording instructions in `assets/README.md` — added in 1.0.0 dev cycle

## [1.0.0] — 2026-04-08

Initial public release. First stable version after live-testing against 22 real Thunderbird accounts with 249,000+ messages.

### Added

**Thunderbird WebExtension**
- Pure WebExtension 2.0, no Experiment APIs
- Compatible with Thunderbird 128+ (ESR through latest)
- 43 route handlers using `messenger.*` APIs
- Auto-reconnect WebSocket client (3s retry)
- Signed and approved on addons.thunderbird.net for self-distribution

**Bridge daemon (`bridge/`)**
- Stateless HTTP↔WebSocket proxy
- HTTP server on `127.0.0.1:7700`
- WebSocket server on `127.0.0.1:7701`
- Request/response correlation via UUIDs
- 30-second default timeout, configurable

**CLI (`cli/`) — 38 commands**
- **Connection:** `health`, `bridge-status`
- **Accounts:** `accounts`, `account`, `identities`
- **Folders:** `folders` (with `--all`), `folder-info`, `folder-create`, `folder-rename`, `folder-delete`
- **Stats:** `stats` (with `--folders`)
- **Search:** `search` with 15 filter options (`--from`, `--to`, `--subject`, `--unread`, `--flagged`, `--tag`, `--since`/`--until` with relative dates, `--has-attachment`, `--size-min`/`--size-max`, `--include-junk`)
- **List:** `list` with `--sort`, `--sort-order`, `--offset`, `--unread`, `--flagged`
- **Read:** `read` with 5 modes (default, `--headers`, `--full`, `--raw`, `--body-only`, `--check-download`), `read-batch`, `thread`
- **Recent:** `recent` with `--hours`, `--account`, `--unread`
- **Actions:** `move`, `copy`, `delete` (with `--permanent --confirm`), `archive`, `mark` (batch)
- **Tags:** `tags`, `tag` (add/remove), `tag-create`
- **Compose:** `compose`, `reply`, `forward` — all with `--draft`/`--open`/`--send` modes, `--body-file`, `--html`, `--from`, `--priority`
- **Attachments:** `attachments` (list), `attachment-download` (single + `--all`)
- **Fetch/sync:** `fetch`, `download-status`, `sync`, `sync-status`
- **Contacts:** `contacts`, `contacts-search`, `contact`
- **Bulk:** `mark-read`, `move`, `delete`, `tag`, `fetch` — all with filters (`--older-than`, `--from`, `--subject`)

**Output system**
- Standard JSON envelope: `{ok: true, data: ...}` / `{ok: false, error: ..., code: ...}`
- Global `--fields <csv>` for field selection (token optimization)
- Global `--compact` to strip null values
- Global `--max-body <chars>` for body truncation
- Global `--timeout <ms>` for request timeout
- Formats: `json` (default, pretty), `compact`, `table`

**MCP server (`mcp/`) — 12 tools for Claude Desktop**
- `email_stats`, `email_search`, `email_list`, `email_read`, `email_thread`
- `email_compose`, `email_reply`, `email_forward` (all default to draft)
- `email_mark`, `email_archive`, `email_attachments`, `email_folders`
- Stdio transport via `@modelcontextprotocol/sdk`
- Safe defaults — destructive operations gated behind explicit flags
- Reuses CLI HTTP client, no code duplication

**Security**
- All traffic localhost-only (`127.0.0.1`)
- No credentials leave the machine — Thunderbird handles all IMAP/SMTP
- `--confirm` required for permanent delete, folder delete, bulk delete
- Search excludes junk by default
- Prompt injection defenses documented in `SECURITY.md`

**Testing**
- 46 CLI/bridge integration tests (mock bridge + extension, in-process)
- 34 MCP server integration tests (spawns server, sends JSON-RPC over stdio)
- 80 total tests, all passing
- Live-tested against 22 accounts, 249,203 messages, 86,825 unread
- GitHub Actions CI on Node 20 and 22

**Documentation**
- `README.md` — project overview, quick start, full command reference
- `docs/SETUP.md` — installation guide (signed XPI + temporary add-on paths)
- `docs/CLAUDE.md` — AI agent usage guide with security rules
- `mcp/README.md` — Claude Desktop integration guide
- `SPEC.md` — full technical specification
- `SECURITY.md` — threat model, 8 CLI defenses, 7 agent patterns
- `CONTRIBUTING.md` — dev guide, code style, PR process
- `ROADMAP.md` — release roadmap and decision log *(in `/workspace/docs/`)*
- Issue templates (bug report, feature request)
