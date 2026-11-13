# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Optional inline forwarding: CLI `tb forward --inline` and MCP `email_forward` with `inline: true`. Uses Thunderbird's native inline quotation and attachments, with an optional plain-text note. Forwarding as an attached message and saving as a draft remain the defaults.

## [1.2.0] — 2026-11-12

npm packages 1.2.0; Thunderbird extension 2.2.0. **Direct sending is now off by default** (see Changed).

### Changed
- **Direct sending is off by default.** Compose/reply/forward with `send` fail with `SEND_DISABLED` (HTTP 403) before anything is created, unless the user ticks "Allow agents to send email directly" in the add-on's options. Drafts and `open` mode are unaffected. Agents cannot change the setting; a malformed value keeps sending off. Users who rely on `--send` / `mode: "send"` must enable it once.
- Bridge answers `NOT_FOUND` errors with HTTP 404 (was 500).

### Added
- Per-account allowlist (#18): the add-on's options page in Thunderbird lets the user choose "All accounts" (default) or "Only selected". Unselected accounts are invisible on every route (accounts, identities, stats, folders, messages by ID, move destinations, search/recent/thread results, sender identity); a malformed setting fails closed. Agents cannot change it. `tb account-access` shows the setting. New `storage` permission.
- Outgoing attachments for compose, reply and forward (#23), with a safe folder flow: files are attached **by name** from one folder (`TB_ATTACH_DIR`, default `~/thunderbird-cli-attachments`). Paths, `..`, dotfiles, symlinks and subfolders are refused (O_NOFOLLOW + realpath check), max 20 files / 25 MiB. CLI `--attach <name>` and `tb attachable`; MCP `attachments: [names]` and `email_attachments` operation `available`. Forwards keep the forwarded message attached.

### Fixed
- MCP `email_compose` `from` / `tb compose --from` accept the sender's email address as well as an identity ID; `email_stats` lists each account's identities (`id`, `email`, `name`) (#30).
- Bridge default `TB_BRIDGE_MAX_BODY` is 40 MiB (was 10 MiB) to fit 25 MiB of base64-encoded attachments.
- Messages carry `dateLocal` (Thunderbird's local time with UTC offset, e.g. `2026-11-12T12:32:05+02:00`) next to `date` (UTC), so agents stop reporting UTC as local time (#28).

## [1.1.1] — 2026-11-12

npm packages 1.1.1; Thunderbird extension 2.1.1.

### Fixed
- `email_list` / `POST /messages/list` with `sort` sorted only the first `limit` messages in Thunderbird's storage order, so "newest first" could return months-old mail. The whole filtered folder is now sorted before `offset`/`limit` (#24, #15).
- Full-text search uses Thunderbird's search index (`messages.query({ fullText })`, subject/body/author) instead of scanning bodies, which timed out on large folders. `searchMode: "body"` / `tb search --body-only` keeps the scan; responses report which mode ran (#12).
- Timeouts are never ambiguous: the bridge answers 504 + `TIMEOUT` (was 500 without a code, surfaced as `THUNDERBIRD_ERROR`), 503 + `EXTENSION_DISCONNECTED`, 500 + `THUNDERBIRD_ERROR`; MCP `email_search` says results are unknown, not empty (#12).
- Docs no longer claim the extension XPI is Mozilla-signed — it has no embedded signature; it is distributed via addons.thunderbird.net and is byte-identical to `extension/` (#11).

### Security
- A new WebSocket connection can no longer take over the extension slot while the connected extension answers pings (`TB_BRIDGE_WS_TAKEOVER_MS`, default 2000); it is closed with 1008 (#22).
- Private vulnerability reporting enabled; see SECURITY.md.

### Added
- MCP `email_mark` can add, remove or replace tags (`addTags`, `removeTags`, `tags`) (#10).

### Fixed (correctness fixes from #27, ported by maintainers)
- Search: `tag`, `sizeMin` and `sizeMax` are passed to Thunderbird's query instead of filtering the already-limited page, which missed matches; `sizeMin`/`sizeMax` of 0 are honoured.
- Pagination: `hasMore` is exact (one look-ahead match, including inside the last native page); unfinished native lists are aborted; invalid `limit`/`offset` are rejected. `tb recent` picks the newest messages across all pages.
- Bulk: `bulk tag`, `bulk delete` and `bulk move` apply their filters before the batch limit (already-tagged messages no longer use up the batch). `bulk move` now filters in the extension and refuses to run against an older extension that ignores the filters.
- Threads follow continuation pages and report lookup failures instead of returning a partial thread.
- Reply keeps Thunderbird's native quotation (the body used to be replaced) and honours `tb reply --html`. Compose `--priority` uses the native priority field.
- Text attachments are no longer merged into the body; attachment lists and `check-download`/`download-status` use Thunderbird's own metadata (`listAttachments`, `headersOnly`), and `hasAttachments` is real.
- Folder counts come from `getFolderInfo` and failures are reported, not shown as 0.
- `tb sync` / MCP `email_folders sync` return an explicit error: the WebExtension API cannot trigger IMAP sync (it used to report success without syncing).
- CLI: message IDs and counts are validated before any request; an HTTP-200 `{ error }` payload exits non-zero (`NOT_FOUND` where applicable); `--max-body` also truncates HTML, raw source and arrays.
- MCP: arguments are validated against each tool's schema (integers, minimums); handler errors are flagged `isError`; `limit: 0` and size 0 are preserved; `maxBody` also truncates HTML and raw.
- Bridge: request bodies are decoded once after all chunks arrive (a UTF-8 character split across chunks was corrupted); aborted uploads get a 400; unknown command-line flags are rejected. `npm run build:xpi` no longer writes a world-writable file.

### Changed
- HTML replies are inserted by importing parsed DOM nodes instead of assigning `innerHTML` (flagged by the ATN validator).
- `npm run build:xpi` is reproducible (fixed entry order and timestamps): rebuilding a release tag gives a byte-identical XPI, so the published file can be checked with `cmp`.

### Security (#38)
- `tb attachment-download --all` keeps only the last path segment of sender-supplied filenames, writes files `0600`, and never overwrites an existing file.
- CLI and MCP reject message/account IDs that would escape their URL path segment (e.g. `1/../../compose`).
- Bridge caps request bodies (`TB_BRIDGE_MAX_BODY`, default 10 MiB → 413) and the `X-TB-Timeout` override (`TB_BRIDGE_MAX_TIMEOUT`, default 10 min); in-flight requests fail immediately with `EXTENSION_DISCONNECTED` when the extension disconnects or is replaced.
- SECURITY.md and the skill no longer describe sanitization, trust metadata or other defenses that are not implemented.

## [1.1.0] — 2026-09-14

npm packages `thunderbird-cli`, `thunderbird-cli-bridge`, `thunderbird-cli-mcp` 1.1.0; Thunderbird extension 2.1.0.

### Security
- Bridge rejects requests from web pages in the user's browser: HTTP `Origin` outside `TB_BRIDGE_CORS_ORIGINS`, non-local `Host` headers (DNS rebinding; extend with `TB_BRIDGE_ALLOWED_HOSTS`), and WebSocket handshakes from web origins that could take over the extension slot. Previously a page could blindly `POST /compose` with `send: true`.
- Optional `TB_AUTH_TOKEN` enforcement on the bridge HTTP listener (#21).
- Dependencies patched for all open Dependabot alerts: ws 8.21.3, adm-zip 0.6.1, hono 4.13.7, @hono/node-server 1.19.17, fast-uri 3.1.7, qs 6.16.0, body-parser 2.3.0, ip-address 10.7.0, express-rate-limit 8.7.0.

### Fixed
- `tb thread` returned an empty thread: headers are now parsed from the raw message and Message-IDs queried without angle brackets (#4). Replies matched only by subject are labelled `threadMatch: "subject"`.
- `tb recent --account` and `--unread` were ignored by the extension (#4).

### Changed
- Extension reconnects with backoff (3s → 15s cap) and immediately on return from idle; bridge drops unresponsive extension sockets via ping/pong (#20). Extension now requests the `idle` permission.
- `read-batch`, bulk tag/fetch, folder fetch and thread lookups run with bounded parallelism; attachment base64 encoding is chunked (#20).
- MCP `email_search` accepts filters without a text query (#20).
- `tb health` / `GET /health` reports the loaded extension's real version instead of a fixed "2.0.0".
- Bridge explains a port already in use at startup instead of crashing.

## [1.0.2] — 2026-04-18

### Added
- `server.json` at repo root, enabling submission to the Official MCP Registry (`io.github.vitalio-sh/thunderbird-cli`).
- `mcpName` field in `mcp/package.json` — required by the MCP Registry to match an npm package to a server entry.

### Changed
- npm `keywords` expanded from 6–7 per package to the full 18-item discovery set per DISTRIBUTION-PLAN §2.2 (adds `mcp-server`, `anthropic`, `email-client`, `smtp`, `ai-agent`, `ai-tools`, `agentic`, `automation`, `localhost`, `privacy`).

### No runtime changes
Metadata-only release. No code changes since 1.0.1.

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
