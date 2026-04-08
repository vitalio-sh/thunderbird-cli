# thunderbird-cli

> Low-level CLI to manage Mozilla Thunderbird email from the shell. 38 commands designed for AI agents.

[![tests](https://github.com/vitalio-sh/thunderbird-cli/actions/workflows/test.yml/badge.svg)](https://github.com/vitalio-sh/thunderbird-cli/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Part of the [thunderbird-cli](https://github.com/vitalio-sh/thunderbird-cli) project.

## What it does

`tb` is a thin HTTP client that talks to a local Thunderbird WebExtension via a bridge daemon. It exposes 38 commands across all `messenger.*` APIs:

- **Search & read** — full-text search across accounts, batch reads, threads
- **Compose** — draft, open, or send (defaults to draft for safety)
- **Folders** — list, create, rename, delete, info, sync
- **Attachments** — list and download (base64 → file)
- **Bulk ops** — mark-read, move, delete, tag, fetch with filters
- **Token-optimized** — `--fields`, `--compact`, `--max-body` for AI use

All output is JSON wrapped in `{ok, data}` / `{ok, error, code}`.

## Prerequisites

This package alone is **not enough**. You need:

1. **Mozilla Thunderbird 128+** with email accounts configured
2. **`thunderbird-cli-bridge`** daemon running on `127.0.0.1:7700`
3. **The signed Thunderbird WebExtension** loaded in Thunderbird

See the [main repo setup guide](https://github.com/vitalio-sh/thunderbird-cli/blob/main/docs/SETUP.md) for the full installation.

## Install

```bash
npm install -g thunderbird-cli
```

Or use without installing:

```bash
npx thunderbird-cli health
```

## Quick examples

```bash
tb stats                                    # account/folder counts
tb search "invoice" --since 7d              # find recent invoices
tb read 123 --headers                       # cheap headers-only read
tb compose --to "a@b.com" --body "Hi"       # save as draft
tb compose --to "a@b.com" --body "Hi" --send  # send immediately
tb attachment-download 123 1.2 --output invoice.pdf
```

Full reference: [docs/COMMANDS.md](https://github.com/vitalio-sh/thunderbird-cli/blob/main/docs/COMMANDS.md)

## Configuration

| Env var | Default |
|---|---|
| `TB_BRIDGE_HOST` | `127.0.0.1` |
| `TB_BRIDGE_PORT` | `7700` |
| `TB_AUTH_TOKEN` | (none) |

Config file: `~/.config/thunderbird-cli/config.json`

## License

MIT
