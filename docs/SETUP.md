# Setup Guide

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

### Option A: Signed XPI (recommended for normal use)

The extension is signed by Mozilla through addons.thunderbird.net for self-distribution. It installs permanently and survives Thunderbird restarts.

1. Download the latest signed XPI from one of these locations:
   - **GitHub Releases:** https://github.com/vitalio-sh/thunderbird-cli/releases/latest
   - **Directly from `main`:** [`dist/releases/thunderbird_ai_bridge-2.0.0-tb.xpi`](../dist/releases/thunderbird_ai_bridge-2.0.0-tb.xpi)
2. Open Thunderbird → **Add-ons and Themes**
3. Click the ⚙ gear icon → **Install Add-on From File…**
4. Select the downloaded `.xpi`
5. Confirm when Thunderbird asks to install
6. Check the bridge terminal — you should see: `[bridge] Extension connected`

> The signed XPI is byte-identical to the source in `extension/`, but Mozilla's trust registry marks it as verified. You **must** use the XPI downloaded from ATN (or our GitHub Releases) — a locally-built XPI won't install permanently.

### Option B: Temporary add-on (for developers making changes)

Use this while editing `extension/src/background.js` during development. Temporary add-ons are removed on Thunderbird restart — but they're the only way to test uncommitted changes.

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
- In Docker, use `host.docker.internal` instead of `127.0.0.1`

### "Extension not connected"
- Is Thunderbird running?
- Is the extension loaded? Check `about:debugging` in Thunderbird
- Look at Thunderbird error console (Ctrl+Shift+J / Cmd+Shift+J) for WebSocket errors
- Bridge must be running BEFORE loading the extension
- The extension auto-reconnects every 3 seconds

### "Request timed out"
- SMTP send operations can take 30-60 seconds. Use `--timeout 60000`
- Large search queries on many accounts may be slow
- Check Thunderbird isn't stuck on a sync operation

### Extension loads but doesn't connect
- Verify port 7701 is not blocked or in use
- Check bridge is running: `curl http://127.0.0.1:7700/bridge/status`
- Try restarting the bridge, then reload the extension

### Folder counts show 0
- Run `tb sync --all` to trigger IMAP refresh
- Some folders need to be opened in Thunderbird at least once
- Counts update after sync completes
