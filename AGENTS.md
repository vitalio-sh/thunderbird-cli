# AGENTS.md — thunderbird-cli

> Repo guide for AI coding agents working **in this codebase** (Cursor, Cline, Codex CLI, Claude Code, Windsurf, Aider, etc.).
>
> Looking for the **end-user** skill that teaches Claude how to *use* this tool? That's in [`skills/thunderbird-cli/`](./skills/thunderbird-cli/). This file is about working *on* the code.

## What this repo ships

Four published artifacts, one architecture:

| Artifact | What | Where |
|---|---|---|
| `thunderbird-cli` | `tb` CLI (38 commands) | `cli/` → npm: `thunderbird-cli` |
| `thunderbird-cli-bridge` | Stateless HTTP↔WS proxy daemon | `bridge/` → npm: `thunderbird-cli-bridge` |
| `thunderbird-cli-mcp` | MCP server (12 tools for Claude Desktop) | `mcp/` → npm: `thunderbird-cli-mcp` |
| Thunderbird WebExtension | WS client inside Thunderbird | `extension/` → signed XPI on addons.thunderbird.net |

```
AI Agent ─→ tb CLI      ─┐
                          ├─→ bridge daemon ─→ Thunderbird WebExtension ─→ messenger.* APIs → your accounts
Claude   ─→ tb-mcp MCP   ─┘      HTTP :7700          WebSocket :7701
```

Everything localhost-only. Thunderbird holds credentials; no creds pass through the agent.

## Setup (before editing)

### Fork workflow

This fork (`reinhardullrich/thunderbird-cli`) uses only `main`. Keep reviewed,
tested changes on `main` and push to `origin/main` when authorized. Do not create
feature branches on this fork. The `upstream` remote is reference-only unless
an upstream contribution is explicitly requested. Never commit local credentials,
access configuration, runtime files, or the private token-bearing XPI.

```bash
npm install                # installs workspace deps for cli/, bridge/, mcp/
npm test                   # CLI/mock integration and review regression tests
npm run test:mcp           # MCP server integration and argument validation
npm run bridge             # start bridge (needed for live tests; not for unit tests)
```

Node 20+ required. All three packages are ES modules (`"type": "module"`).

## Conventions you need to follow

### Code style

- **ES modules** throughout, `"type": "module"` in every `package.json`.
- **CLI framework:** `commander.js`. Command definitions in `cli/src/cli.js`; HTTP client + formatters in `cli/src/client.js`.
- **Bridge:** vanilla Node `http` + `ws`. Zero business logic — it's a UUID-correlated proxy. Don't add state.
- **MCP server:** `@modelcontextprotocol/sdk`. Stdio transport. The separately published package has its own `mcp/src/client.js`; keep HTTP behavior consistent with `cli/src/client.js`.
- **Extension:** pure WebExtension (`manifest_version: 2`). No Experiment APIs. Compatible with Thunderbird 128+.

### Output format

Every command outputs atomic JSON:

```json
{ "ok": true,  "data": { ... } }
{ "ok": false, "error": "message", "code": "ERROR_CODE" }
```

Error codes: `BRIDGE_UNREACHABLE`, `EXTENSION_DISCONNECTED`, `AUTH_REQUIRED`, `FORBIDDEN`, `TIMEOUT`, `NOT_FOUND`, `INVALID_ARGS`, `THUNDERBIRD_ERROR`. Don't invent new ones — pick an existing one or extend the union intentionally.

### Safety defaults (NEVER weaken)

These are defaults the end-user agent relies on. Don't flip them:

- `email_search` excludes junk unless `includeJunk: true` is explicit
- `email_compose` / `email_reply` / `email_forward` default to `mode: "draft"`
- Never implement message/folder/attachment deletion or emptying Trash. Never
  request `messagesDelete`. No configuration may enable these capabilities.
- Use the existing move operation for placing mail in Trash; never emulate it
  with a delete API, even with a non-permanent flag.

See `SECURITY.md` for the full threat model.

### Token efficiency

The CLI supports `--fields`, `--compact`, and `--max-body`. MCP `email_read`
supports `maxBody`; there are no global MCP `fields` or `compact` arguments.
Consult the actual tool input schemas; do not document planned options as
implemented. Preserve available output caps when changing response handling.

### Commit style

Conventional commits. Short form:

- `feat(scope): ...` — new capability
- `fix(scope): ...` — bug fix
- `docs: ...` — docs-only
- `chore: ...` — metadata / tooling
- `test(scope): ...` — test-only

Scopes: `cli`, `bridge`, `mcp`, `extension`, `docker`, `meta`, `release`.

### Version bumps

All four `package.json` files (`package.json`, `cli/package.json`, `bridge/package.json`, `mcp/package.json`) move together. `server.json` (for the MCP Registry) must match the package version. Update `CHANGELOG.md` in the same commit.

## Tests before pushing

Access checks belong in `extension/src/access-control.js`, before any native
API calls. Classify new routes there and add a regression to
`test/access-control.test.mjs`. Reading and searching are always available;
never add switches for them. Attachment exports are separately configurable.
The default policy allows downloads and drafts, but not sending or mailbox
changes. Policy documentation is in `docs/ACCESS-CONTROL.md`.

```bash
npm test && npm run test:mcp
```

`prepublishOnly` enforces this at publish time, but run it locally first — it'll save you a failed CI cycle. CI runs on Node 20 + 22.

## Before opening a PR

- [ ] All four `package.json` files match versions if you bumped
- [ ] `server.json` version matches (when bumping)
- [ ] `CHANGELOG.md` has an entry
- [ ] New CLI command? → add a test in `test/quick-test.mjs`
- [ ] New MCP tool? → add a test in `test/mcp-test.mjs` and register it in `mcp/src/tools.js`
- [ ] New error code? → document it in `SPEC.md`
- [ ] New destructive op? → gate it behind `--confirm` / `confirm: true`
- [ ] Did you change the MCP tool surface? → update [`skills/thunderbird-cli/SKILL.md`](./skills/thunderbird-cli/SKILL.md) so the end-user skill stays accurate

## Release

Tagging `vX.Y.Z` fires `.github/workflows/release.yml`:

1. Runs all 80 tests
2. Builds the unsigned XPI
3. Finds the signed XPI in `dist/releases/` (must be checked in)
4. Creates the GitHub Release with both XPIs attached

npm publish is manual (`cd cli && npm publish`) — intentionally, so a release tag without publish is a no-op you can recover from.

## Key files to know

| File | What's in it |
|---|---|
| `SPEC.md` | Full technical specification — source of truth for tool surface |
| `SECURITY.md` | Threat model, CLI defenses, agent patterns |
| `docs/SETUP.md` | User install guide |
| `docs/COMMANDS.md` | All 38 CLI commands reference |
| `docs/CLAUDE.md` | Claude Code–focused CLI quick-ref (end-user oriented) |
| `docs/distribution-log.md` | Launch venue submission tracker |
| `skills/thunderbird-cli/SKILL.md` | End-user Claude skill (separate from this file) |
| `CONTRIBUTING.md` | Local dev setup, PR process |

## Non-goals

Don't propose these without discussing first:

- **Server-side filtering logic.** Thunderbird is source of truth; we don't reimplement IMAP filter semantics.
- **Cloud deployment.** Bridge is localhost-only by design. No remote auth, no TLS, no tunnels.
- **New credential flow.** We never touch user email credentials. If a feature needs OAuth, it doesn't belong here.
- **Breaking the CLI ↔ MCP symmetry.** CLI is the superset (38 cmds); MCP is the curated 12-tool subset. When adding a bulk op, CLI-only is the correct choice — don't expose it as an MCP tool unless it's individually-scoped.

## Questions / weirdness

Check `SPEC.md` first. If it's not there, open an issue — don't guess at behavior from the WebExtension side. Thunderbird's `messenger.*` API has sharp edges (async races, provider-specific IMAP quirks, Gmail's label-not-folder model) that are documented in `SPEC.md` as we discover them.
