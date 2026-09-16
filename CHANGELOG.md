# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed
- All message/folder deletion commands, MCP deletion operations, API handlers and deletion permissions. No config can enable them. Use explicit move-to-Trash instead; old deletion configuration keys fail validation.
- Bundled older upstream signed XPIs with full-access deletion code; build this fork rather than installing those stale artifacts.

### Added
- Consolidated authenticated local installation: shared HTTP/WebSocket token, generated user service, private XPI builds with stable output and preserved add-on identity, repeatable compose/reply attachments, reply sender/recipient selection, and composer inspection. Plain reply input retains native HTML/plain quotation format. Native decoding validates attachments up to the 25 MiB limit without a recursive regex.
- Add-on-enforced JSON access policy shared by CLI and optional MCP: always-on reading/searching, switchable attachment downloads (on by default), draft preparation, and separately gated sending/mailbox operations. XPI builds validate settings and derive native permissions; `tb access` reports the installed policy. Existing installed or signed upstream add-ons are unchanged.

### Fixed
- Malformed WebSocket handshake URLs are rejected without crashing the bridge.
- Download checks report actual attachment presence, use Thunderbird's native `headersOnly` flag after retrieval, and propagate native failures instead of misclassifying empty or attachment-only messages.
- Folder listings and statistics skip unsupported count requests for account-root containers while still reporting genuine child-folder count failures.
- CLI `--body-only` output now obeys `--max-body`.
- Attachment downloads reject unsafe filenames and refuse overwrites; XPI builds no longer produce world-writable files.
- MCP validates tool arguments, preserves zero-valued search limits/size bounds, and reports handler errors as tool failures. HTTP clients also reject error payloads returned with status 200.
- Body limits cover HTML, raw messages, and CLI batch results. Native attachment listing includes text/HTML files without appending their contents to the message body.
- Thread lookup consumes all native query pages and surfaces query failures.
- Replies preserve Thunderbird's generated quotation and honor CLI `--html`; new messages use native priority and custom-header fields.
- Bulk move/delete/tag filters run before the limit; already-tagged messages do not consume a tagging batch. Invalid message IDs and operation flags fail explicitly.
- Bridge preserves split UTF-8 input, survives interrupted uploads, prevents replacement of an active extension socket, and fails pending requests on disconnect.
- `sync` no longer reports success without syncing. Folder counts use `getFolderInfo`. Documentation now distinguishes implemented protections from proposed security features; unsupported bridge options fail at startup.
- Bundled skill examples now match real MCP arguments and stop claiming nonexistent sanitization, trust scores, and bulk-archive commands. Bulk move fails closed with older extensions that cannot confirm filtering support.
- Folder listings and recent-message queries sort all matching headers before applying pagination, including across Thunderbird result pages.
- Search tag and size filters are applied by Thunderbird before the result limit, so matching messages beyond the first unfiltered batch are not missed.
- Limited message collection checks for an additional matching message before reporting `hasMore`, including when truncating within the final page, and aborts unfinished message lists. Invalid pagination arguments fail before starting a query.

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
