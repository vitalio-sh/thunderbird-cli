# Contributing to thunderbird-cli

Thanks for your interest in contributing! This project provides AI agents (and humans) with a low-level interface to Mozilla Thunderbird.

## Project structure

```
thunderbird-cli/
├── extension/          Thunderbird WebExtension (manifest_version 2)
├── bridge/             HTTP↔WebSocket proxy daemon
├── cli/                tb command-line tool
├── mcp/                MCP server for Claude Desktop
├── test/               Integration tests
└── docs/               User and AI agent documentation
```

The four runtime components are intentionally separated:

- **extension** — runs inside Thunderbird, calls `messenger.*` APIs, talks to bridge over WebSocket
- **bridge** — stateless HTTP↔WS proxy, no business logic
- **cli** — thin HTTP client, parses args, formats JSON output
- **mcp** — MCP server, exposes 12 curated tools to Claude Desktop and other MCP clients

## Local development

Prerequisites: Node.js 20+, Thunderbird 128+ for live testing.

```bash
git clone https://github.com/vitalio-sh/thunderbird-cli
cd thunderbird-cli
npm install     # installs all workspace deps (cli, bridge, mcp)
```

### Running the stack

```bash
# Terminal 1: bridge daemon
node bridge/bridge.js

# In Thunderbird: about:debugging → Load Temporary Add-on → extension/manifest.json

# Terminal 2: test the CLI
node cli/src/cli.js health
node cli/src/cli.js stats
```

### Tests

```bash
npm test           # CLI/bridge integration (46 tests, mock bridge)
npm run test:mcp   # MCP server integration (34 tests, spawns server)
```

Both test suites use a mock bridge + mock extension running in-process — no Thunderbird needed.

For live testing against your real Thunderbird:

```bash
TB_BRIDGE_HOST=127.0.0.1 node cli/src/cli.js health
```

## Adding a new CLI command

1. Add the route handler in `extension/src/background.js` (use `messenger.*` APIs)
2. Add the command in `cli/src/cli.js` using commander.js
3. Add a test case in `test/quick-test.mjs` against the mock bridge
4. If the new capability is useful for AI agents, expose it as an MCP tool in `mcp/src/tools.js`

The bridge (`bridge/bridge.js`) is a dumb proxy — you don't need to modify it for new routes.

## Adding a new MCP tool

1. Add the tool definition to `mcp/src/tools.js` with proper JSON Schema for `inputSchema`
2. Add a test case in `test/mcp-test.mjs`
3. Update the tools table in `mcp/README.md`

Keep MCP tools **high-level and AI-friendly**. Bulk admin operations belong in the CLI, not as MCP tools.

## Code style

- ES modules throughout (`"type": "module"`)
- No TypeScript (kept simple for contributor accessibility)
- Pretty-print JSON output by default, accept `--compact` for one-liners
- Always wrap output in `{ok, data}` / `{ok, error, code}` envelope
- No comments unless the logic isn't self-evident

## Security

Email is an open channel. The CLI must:

- Strip technically hidden content (HTML comments, white-on-white, zero-width chars)
- Never auto-send messages — `compose/reply/forward` default to draft
- Require `--confirm` for destructive operations (`delete --permanent`, `bulk delete`, `folder-delete`)
- Exclude junk from search results by default

See [SECURITY.md](SECURITY.md) for the full threat model.

## Reporting bugs

Use the GitHub issue templates. Include:

- OS and Thunderbird version
- Output of `tb health` and `tb bridge-status`
- Bridge daemon logs (stderr from `node bridge/bridge.js`)
- Steps to reproduce

## Pull requests

- Fork, branch, PR against `main`
- Include tests for new functionality
- Update docs (`README.md`, `docs/CLAUDE.md`, `mcp/README.md`) if user-facing
- Run `npm test && npm run test:mcp` before submitting

## License

By contributing, you agree your contributions will be licensed under the MIT License.
