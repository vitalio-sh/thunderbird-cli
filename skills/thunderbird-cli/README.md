# thunderbird-cli — Claude Skill

> **Skill file:** [`SKILL.md`](./SKILL.md)
>
> This is a [Claude Skill](https://agentskills.io) that teaches Claude how to drive the [thunderbird-cli-mcp](https://www.npmjs.com/package/thunderbird-cli-mcp) server effectively — handling token-efficient field selection, draft-by-default safety, trust metadata, and common email workflows across all the user's Thunderbird accounts.

Use it alongside the MCP server: the MCP gives Claude the capability (12 email tools), this skill gives Claude the recipes for using them well.

---

## Install

### Claude.ai (GUI)

1. Download this folder:
   ```
   gh repo clone vitalio-sh/thunderbird-cli
   cd thunderbird-cli/skills
   zip -r thunderbird-cli.zip thunderbird-cli
   ```
2. Claude.ai → **Settings → Capabilities → Skills → Upload skill**
3. Pick `thunderbird-cli.zip`
4. Enable it and confirm the `thunderbird` MCP server is also connected.

### Claude Code

Put the `thunderbird-cli/` folder inside `~/.claude/skills/` (user-level) or `.claude/skills/` (project-level):

```bash
mkdir -p ~/.claude/skills
cp -r /path/to/thunderbird-cli/skills/thunderbird-cli ~/.claude/skills/
```

Claude Code auto-discovers it on next launch — no restart required when placed at project level.

### Anthropic API (Agent SDK / Messages API)

Skills are supported on the API via the Code Execution Tool beta. See Anthropic's [Skills API Quickstart](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/quickstart) for details. You can upload this skill via `POST /v1/skills` and reference it in `container.skills` on Messages API requests.

---

## Prerequisites

The skill itself is just instructions — it needs the MCP server to do anything. Before enabling, set up the full stack:

1. **Install Thunderbird 128+** with your email accounts configured (normal Thunderbird install).
2. **Install the signed WebExtension** from [Releases](https://github.com/vitalio-sh/thunderbird-cli/releases/latest) → *Install Add-on From File…* in Thunderbird.
3. **Start the bridge daemon:** `npm install -g thunderbird-cli-bridge && tb-bridge`
4. **Configure the MCP server** in `claude_desktop_config.json` (or equivalent):
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

Full setup: <https://github.com/vitalio-sh/thunderbird-cli/blob/main/docs/SETUP.md>

---

## What it covers

- Token-efficient field selection (`fields=["id","author","subject","date"]` cuts a search response by ~15×)
- Draft-by-default safety on `email_compose` / `email_reply` / `email_forward`
- Explicit `confirm: true` gate for permanent delete, folder delete, and bulk delete
- Trust metadata interpretation (junk score, SPF/DKIM, contact status)
- Prompt-injection defense — treating message bodies as untrusted input
- Recipes for the seven most common email workflows (stats, search, read, reply, compose, attachment download, bulk archive)
- Troubleshooting common errors: `BRIDGE_UNREACHABLE`, `EXTENSION_DISCONNECTED`, `TIMEOUT`, `NOT_FOUND`

## When the skill triggers

The YAML `description` teaches Claude to auto-load the skill on queries like:

- *"How many unread emails do I have?"*
- *"Find invoices from AWS last month"*
- *"Read the latest from alice@example.com"*
- *"Reply to message 118 saying I'll attend"*
- *"Archive everything from newsletter@ older than 30 days"*
- *"Download the PDF from message 245"*

…and does NOT trigger on calendar/contacts-only work.

---

## License

MIT — see the [root LICENSE](https://github.com/vitalio-sh/thunderbird-cli/blob/main/LICENSE).
