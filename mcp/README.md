# thunderbird-cli MCP Server

[![npm version](https://img.shields.io/npm/v/thunderbird-cli-mcp.svg)](https://www.npmjs.com/package/thunderbird-cli-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**MCP server that gives Claude Desktop full access to your email through Mozilla Thunderbird.**

Read, search, compose, reply, and manage 22+ email accounts and 250K+ messages from any MCP-compatible client. All credentials stay in Thunderbird — nothing leaves your machine.

Part of the [thunderbird-cli](https://github.com/vitalio-sh/thunderbird-cli) project.

## What it does

Exposes 12 email management tools to Claude Desktop:

| Tool | Description |
|---|---|
| `email_stats` | Account/folder overview, unread counts, totals |
| `email_search` | Cross-account search (15 filter options, relative dates) |
| `email_list` | List folder contents with sort/pagination |
| `email_read` | Read message (5 modes: default, headers, full, raw, check-download) |
| `email_thread` | Get full conversation thread |
| `email_compose` | Send/draft new email (default: draft, never auto-sends) |
| `email_reply` | Reply to message (default: draft) |
| `email_forward` | Forward to new recipient (default: draft) |
| `email_mark` | Read/flagged/junk flags (batch supported) |
| `email_archive` | Archive, move, or delete messages |
| `email_attachments` | List + download attachments (base64) |
| `email_folders` | List folders, get info, trigger sync |

**Safe defaults:** compose/reply/forward all default to **draft mode**. Claude must explicitly pass `mode: "send"` to actually send anything. Permanent delete requires `confirm: true`.

## Architecture

```
Claude Desktop ──stdio──> tb-mcp ──HTTP──> bridge daemon ──WS──> Thunderbird Extension
                                                                      ↓
                                                            All your email accounts
```

The MCP server is stateless. It calls the bridge daemon which forwards to the Thunderbird WebExtension. Your email accounts stay configured in Thunderbird where they always were.

## Prerequisites

You need three things running on your machine:

1. **Mozilla Thunderbird 128+** with your email accounts configured
2. **The thunderbird-cli bridge daemon** running on `127.0.0.1:7700`
3. **The thunderbird-cli WebExtension** loaded in Thunderbird

See the [main repo setup guide](https://github.com/vitalio-sh/thunderbird-cli/blob/main/docs/SETUP.md) for installing the bridge and extension.

## Installation

### Option A: npx (recommended, no install)

Add to your Claude Desktop config (no installation step needed — npx fetches it on demand):

```json
{
  "mcpServers": {
    "thunderbird": {
      "command": "npx",
      "args": ["-y", "thunderbird-cli-mcp"]
    }
  }
}
```

### Option B: Global install

```bash
npm install -g thunderbird-cli-mcp
```

Then in Claude Desktop config:

```json
{
  "mcpServers": {
    "thunderbird": {
      "command": "tb-mcp"
    }
  }
}
```

### Option C: From source

```bash
git clone https://github.com/vitalio-sh/thunderbird-cli
cd thunderbird-cli
npm install
```

Then in Claude Desktop config:

```json
{
  "mcpServers": {
    "thunderbird": {
      "command": "node",
      "args": ["/absolute/path/to/thunderbird-cli/mcp/src/server.js"]
    }
  }
}
```

## Claude Desktop Config Location

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

After editing, **restart Claude Desktop**. You should see "thunderbird" in the MCP servers list when you click the tool icon.

## Configuration

The MCP server reads these environment variables (set in your Claude Desktop config under `env`):

| Variable | Default | Purpose |
|---|---|---|
| `TB_BRIDGE_HOST` | `127.0.0.1` | Bridge daemon host |
| `TB_BRIDGE_PORT` | `7700` | Bridge daemon HTTP port |
| `TB_AUTH_TOKEN` | (none) | Optional auth token |

Example with custom bridge host:

```json
{
  "mcpServers": {
    "thunderbird": {
      "command": "npx",
      "args": ["-y", "thunderbird-cli-mcp"],
      "env": {
        "TB_BRIDGE_HOST": "127.0.0.1",
        "TB_BRIDGE_PORT": "7700"
      }
    }
  }
}
```

## Example prompts

Once configured, try these in Claude Desktop:

> "How many unread emails do I have across all accounts?"

> "Search for invoices from AWS in the last 30 days"

> "Show me the thread about the GMI Cloud SCALE program"

> "Reply to message ID 118 saying I'll be there Monday — save as draft so I can review"

> "List all attachments on message 245 and download the PDF"

> "Mark all messages from noreply@github.com in my inbox as read"

## Safety

- **Compose/reply/forward default to draft mode.** Claude cannot send emails without explicitly requesting `mode: "send"`.
- **Permanent delete is gated** behind `confirm: true`.
- **Search excludes junk/spam by default** to prevent prompt injection from adversarial emails.
- **All traffic stays on localhost.** Bridge listens on `127.0.0.1` only.
- **No credentials are exposed.** Thunderbird handles all IMAP/SMTP — your passwords never leave its config.

See [SECURITY.md](https://github.com/vitalio-sh/thunderbird-cli/blob/main/SECURITY.md) for the full threat model and prompt-injection defenses.

## Troubleshooting

### "Bridge unreachable" / connection errors
- Is the bridge daemon running on `127.0.0.1:7700`? Test: `curl http://127.0.0.1:7700/bridge/status`
- Is Thunderbird running with the extension loaded?
- Check Thunderbird's add-on debugging console for WebSocket errors

### Tools don't appear in Claude Desktop
- Did you restart Claude Desktop after editing the config?
- Check the Claude Desktop logs (View → Developer → Open Logs)
- Verify the JSON config is valid

### "Request timed out" on send
- SMTP send can take 30-60s on first connection
- The MCP server uses a 30s default — for sends, use the CLI directly with `--timeout 60000`

## Development

```bash
git clone https://github.com/vitalio-sh/thunderbird-cli
cd thunderbird-cli
npm install
npm run test:mcp    # 34 integration tests against mock bridge
```

## License

MIT — see [LICENSE](https://github.com/vitalio-sh/thunderbird-cli/blob/main/LICENSE)
