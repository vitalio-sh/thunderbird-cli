# thunderbird-cli-bridge

> Stateless HTTP↔WebSocket bridge daemon between thunderbird-cli (or any HTTP client) and the Thunderbird WebExtension.

[![tests](https://github.com/vitalio-sh/thunderbird-cli/actions/workflows/test.yml/badge.svg)](https://github.com/vitalio-sh/thunderbird-cli/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Part of the [thunderbird-cli](https://github.com/vitalio-sh/thunderbird-cli) project.

## What it does

A small Node.js daemon (`tb-bridge`) that runs on your machine and forwards HTTP requests to the Thunderbird WebExtension over WebSocket. No business logic — pure proxy.

```
HTTP client (CLI / MCP / curl) ──HTTP→ tb-bridge ──WS→ Thunderbird Extension
                                       :7700           :7701
```

- **Stateless** — each request gets a UUID, response correlated, then forgotten
- **Localhost-only** — listens on `127.0.0.1` (no external exposure)
- **Auto-reconnect on the extension side** — if Thunderbird restarts, the extension reconnects within 3s
- **Zero config** — works out of the box with default ports

## Install

```bash
npm install -g thunderbird-cli-bridge
```

## Run

```bash
tb-bridge
```

You should see:
```
[bridge] HTTP server on http://127.0.0.1:7700
[bridge] WebSocket server on ws://127.0.0.1:7701
[bridge] Waiting for Thunderbird extension to connect...
```

Keep it running. For background operation:

```bash
# pm2
pm2 start tb-bridge --name tb-bridge
pm2 save

# or simple background
nohup tb-bridge > ~/.tb-bridge.log 2>&1 &
```

## Endpoints

### `GET /bridge/status`

Returns bridge state without requiring the extension. Use this to check the daemon is up.

```bash
curl http://127.0.0.1:7700/bridge/status
# {"bridge":"running","extension":"connected","httpPort":7700,"wsPort":7701}
```

### Everything else

All other paths get forwarded to the Thunderbird extension via WebSocket and the response is returned as JSON. See [SPEC.md](https://github.com/vitalio-sh/thunderbird-cli/blob/main/SPEC.md) for the full route list (43 routes).

## Prerequisites

The bridge alone does nothing useful — you need:

1. **Mozilla Thunderbird 128+** with the [thunderbird-ai-bridge extension](https://github.com/vitalio-sh/thunderbird-cli/releases) installed
2. **Optional:** [`thunderbird-cli`](https://www.npmjs.com/package/thunderbird-cli) or [`thunderbird-cli-mcp`](https://www.npmjs.com/package/thunderbird-cli-mcp) as the HTTP client

See the [main repo setup guide](https://github.com/vitalio-sh/thunderbird-cli/blob/main/docs/SETUP.md).

## License

MIT
