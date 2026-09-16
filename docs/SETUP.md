# Setup Guide

## Fork access policy

Build this fork's add-on to use its configurable access rights. See
[Access control](ACCESS-CONTROL.md) for the JSON settings and installation steps.
Reading/searching are always available; attachment downloads and draft
preparation default to enabled; sending and mailbox changes default to disabled.
Previously signed upstream XPIs linked below do not include this policy.
MCP is optional; CLI users need only the CLI, bridge, and add-on.

## Architecture

```
Host (macOS):
  Thunderbird Desktop → Extension (background.js)
       ↕ WebSocket ws://127.0.0.1:7701
  Bridge Server (bridge.js) — stateless HTTP↔WS proxy
       ↕ HTTP http://127.0.0.1:7700

Docker/Devcontainer:
  AI Agent → tb CLI (HTTP client)
       ↕ http://host.docker.internal:7700
```

Pure WebExtension. No Experiment APIs. Requires Thunderbird 128+.

## Step 1: Install & Start the Bridge

```bash
cd bridge
npm install
node bridge.js
```

You should see:
```
[bridge] HTTP server on http://127.0.0.1:7700
[bridge] WebSocket server on ws://127.0.0.1:7701
[bridge] Waiting for Thunderbird extension to connect...
```

Keep this running. For background operation:
```bash
# pm2
npm install -g pm2
pm2 start bridge/bridge.js --name tb-bridge
pm2 save

# or simple background
nohup node bridge/bridge.js > ~/.tb-bridge.log 2>&1 &
```

## Step 2: Install the Thunderbird Extension

### Option A: Build this fork

Follow [Access control](ACCESS-CONTROL.md) to configure and build the XPI. Install
that build through Thunderbird's Add-ons Manager, **Install Add-on From File**.
Do not substitute upstream signed binaries: they still include deletion code
and do not have this fork's restrictions. Older bundled binaries were removed.
If your Thunderbird distribution requires signing, sign this fork's build.

### Option B: Temporary add-on (for developers making changes)

Use this while editing during development. Temporary add-ons are removed on
Thunderbird restart and use the source-default policy rather than a custom XPI policy.

1. Open Thunderbird
2. Navigate to `about:debugging` in the address bar
3. Click **This Thunderbird** in the left sidebar
4. Click **Load Temporary Add-on…**
5. Select `extension/manifest.json`
6. Check the bridge terminal: `[bridge] Extension connected`

When you reload after editing, just click **Reload** next to the add-on in `about:debugging`.

## Step 3: Install the CLI

```bash
cd cli
npm install
npm link   # makes `tb` available globally
```

Or without `npm link`:
```bash
alias tb="node /path/to/cli/src/cli.js"
```

## Step 4: Verify

```bash
# Bridge only (works without extension)
tb bridge-status

# Full stack (needs extension connected)
tb health

# List accounts
tb accounts

# Stats overview
tb stats

# Search
tb search "test" --limit 3
```

## Docker / Devcontainer Usage

Set the bridge host to reach the host machine:

```bash
export TB_BRIDGE_HOST=host.docker.internal
tb health
```

Or add to `~/.config/thunderbird-cli/config.json`:
```json
{
  "host": "host.docker.internal",
  "port": 7700
}
```

Or in `.env`:
```
TB_BRIDGE_HOST=host.docker.internal
TB_BRIDGE_PORT=7700
```

## Configuration

Config file location: `~/.config/thunderbird-cli/config.json`

```json
{
  "bridge": {
    "host": "127.0.0.1",
    "httpPort": 7700,
    "authToken": null
  },
  "defaults": {
    "limit": 25,
    "fields": null,
    "compact": false,
    "maxBody": null
  }
}
```

Environment variables override config file values:
- `TB_BRIDGE_HOST` — bridge hostname
- `TB_BRIDGE_PORT` — bridge HTTP port
- `TB_AUTH_TOKEN` — auth token

## Troubleshooting

### "Bridge unreachable"
- Is the bridge running? Check: `curl http://127.0.0.1:7700/bridge/status`
  (if the bridge was started with `TB_AUTH_TOKEN`, add `-H "Authorization: Bearer $TB_AUTH_TOKEN"`, or the call returns 401)
- In Docker, use `host.docker.internal` instead of `127.0.0.1`

### "Extension not connected"
- Is Thunderbird running?
- Is the extension loaded? Check `about:debugging` in Thunderbird
- Look at Thunderbird error console (Ctrl+Shift+J / Cmd+Shift+J) for WebSocket errors
- Bridge must be running BEFORE loading the extension
- The extension auto-reconnects after 3s, backing off to every 15s while the bridge is down (and immediately when you return from idle)

### "Request timed out"
- SMTP send operations can take 30-60 seconds. Use `--timeout 60000`
- Large search queries on many accounts may be slow
- Check Thunderbird isn't stuck on a sync operation

### Extension loads but doesn't connect
- Verify port 7701 is not blocked or in use
- Check bridge is running: `curl http://127.0.0.1:7700/bridge/status` (add `-H "Authorization: Bearer $TB_AUTH_TOKEN"` if auth is enabled)
- Try restarting the bridge, then reload the extension

### Folder counts show 0
- Use Thunderbird's **Get Messages** command; `tb sync` cannot trigger IMAP refresh
- Some folders need to be opened in Thunderbird at least once
- Counts update after sync completes
