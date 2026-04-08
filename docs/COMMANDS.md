# CLI Command Reference

All 38 commands in the `tb` CLI. For the quick tour, see the [main README](../README.md). For AI-agent-focused usage, see [CLAUDE.md](CLAUDE.md).

## Global Options

```bash
tb [command] [options]
  -f, --format <type>      # json (default) | compact | table
  --fields <csv>           # comma-separated fields to include
  --compact                # strip null values
  --max-body <chars>       # truncate message bodies
  --timeout <ms>           # request timeout (default: 30000)
```

## Connection & Status

```bash
tb health                  # check bridge + extension status
tb bridge-status           # bridge-only status (works without extension)
```

## Accounts & Identities

```bash
tb accounts                # list all email accounts
tb account <accountId>     # get account details
tb identities              # list all identities (for --from)
```

## Folders

```bash
tb folders <accountId>                    # list folders for account
tb folders --all                          # list all folders across all accounts
tb folder-info <folderId>                 # folder details with message counts
tb folder-create <parentFolderId> <name>  # create subfolder
tb folder-rename <folderId> <newName>     # rename folder
tb folder-delete <folderId> --confirm     # delete folder (requires --confirm)
```

## Stats & Overview

```bash
tb stats                   # global overview (accounts, unread, totals)
tb stats <accountId>       # per-account stats
tb stats --folders         # include per-folder breakdown
```

## Search

```bash
tb search <query> [options]
  -a, --account <id>       # limit to account
  --folder <id>            # limit to folder
  --from <address>         # filter by sender
  --to <address>           # filter by recipient
  --subject <text>         # filter by subject
  --unread                 # unread only
  --flagged                # flagged/starred only
  --tag <tag>              # filter by tag
  --since <date>           # from date (ISO or relative: 7d, 2w, 3m, today, yesterday)
  --until <date>           # to date
  --has-attachment         # only messages with attachments
  --size-min <bytes>       # minimum message size
  --size-max <bytes>       # maximum message size
  --include-junk           # include junk (excluded by default)
  -l, --limit <n>          # max results (default: 25)
```

## List Messages

```bash
tb list <folderId> [options]
  --unread                 # unread only
  --flagged                # flagged only
  --offset <n>             # skip first N (pagination)
  --sort <field>           # date | from | subject | size
  --sort-order <dir>       # asc | desc
  -l, --limit <n>          # max results (default: 25)
```

## Read Messages

```bash
tb read <messageId>                   # default: headers + text body + attachments
tb read <messageId> --headers         # headers only (cheapest)
tb read <messageId> --full            # include HTML body
tb read <messageId> --raw             # raw RFC822
tb read <messageId> --body-only       # just text, no JSON wrapper
tb read <messageId> --check-download  # check download state

tb read-batch <id1,id2,id3>           # read multiple messages at once
tb thread <messageId>                 # full conversation thread
```

## Recent / Timeline

```bash
tb recent [options]
  --hours <n>              # lookback period (default: 24)
  --unread                 # unread only
  --account <id>           # filter by account
  -l, --limit <n>          # max results (default: 50)
```

## Move, Copy, Delete, Archive

```bash
tb move <messageIds> <folderId>               # move (comma-separated IDs)
tb copy <messageIds> <folderId>               # copy
tb delete <messageIds>                        # delete (to trash)
tb delete <messageIds> --permanent --confirm  # permanent delete
tb archive <messageIds>                       # archive
```

## Mark & Tags

```bash
tb mark <messageIds> --read           # mark read (supports batch)
tb mark <messageIds> --unread         # mark unread
tb mark <messageIds> --flagged        # flag/star
tb mark <messageIds> --unflagged      # unflag
tb mark <messageIds> --junk           # mark junk
tb mark <messageIds> --not-junk       # mark not junk

tb tags                               # list available tags
tb tag <messageId> <tagKey>           # add tag
tb tag <messageId> <tagKey> --remove  # remove tag
tb tag-create <key> <label> <color>   # create new tag
```

## Compose, Reply, Forward

Default mode is **draft** (saves to Drafts folder without opening UI).

```bash
tb compose [options]
  --to <address>           # required, comma-separated for multiple
  --cc <address>           # CC
  --bcc <address>          # BCC
  --subject <text>         # subject line
  --body <text>            # message body (inline)
  --body-file <path>       # read body from file
  --html                   # treat body as HTML
  --from <identityId>      # send from specific identity (see: tb identities)
  --priority <level>       # highest | high | normal | low | lowest
  --draft                  # save as draft (default)
  --open                   # open in Thunderbird compose window
  --send                   # send immediately

tb reply <messageId> [options]
  --body <text>            # reply text
  --body-file <path>       # read from file
  --all                    # reply to all
  --draft / --open / --send

tb forward <messageId> [options]
  --to <address>           # required
  --body <text>            # additional text
  --draft / --open / --send
```

## Attachments

```bash
tb attachments <messageId>                                     # list attachments
tb attachment-download <messageId> <partName> --output <path>  # download one
tb attachment-download <messageId> --all --output-dir <dir>    # download all
```

## Fetch & Sync

```bash
tb fetch <messageId>                      # force download from IMAP
tb fetch --folder <folderId> --limit <n>  # batch fetch
tb download-status <messageId>            # check: full | headers_only

tb sync <folderId>                        # trigger folder sync
tb sync --all                             # sync all accounts
tb sync-status <folderId>                 # check sync status
```

## Contacts

```bash
tb contacts                               # list all contacts
tb contacts --book <bookId> --limit <n>   # filter by address book
tb contacts-search <query>                # search contacts
tb contact <contactId>                    # contact details
```

## Bulk Operations

```bash
tb bulk mark-read <folderId> [-l <n>]                             # mark all read
tb bulk move <from> <to> [--older-than <days>] [--from <addr>] [--subject <pat>]
tb bulk delete <folderId> --confirm [--older-than <days>] [--from <addr>]
tb bulk tag <folderId> <tagKey> [--older-than <days>] [--from <addr>]
tb bulk fetch <folderId> [-l <n>]                                 # force IMAP download
```

## Output Format

All commands output JSON wrapped in a standard envelope:

```json
// Success
{ "ok": true, "data": { ... } }

// Error
{ "ok": false, "error": "Message not found", "code": "NOT_FOUND" }
```

### Token Optimization

```bash
# Field selection — only return what you need
tb search "invoice" --fields id,from,subject,date

# Body truncation — limit body size
tb read 123 --max-body 2000

# Compact mode — strip nulls and whitespace
tb stats --compact
```

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `TB_BRIDGE_HOST` | `127.0.0.1` | Bridge host (`host.docker.internal` in Docker) |
| `TB_BRIDGE_PORT` | `7700` | Bridge HTTP port |
| `TB_AUTH_TOKEN` | (none) | Auth token for bridge |

Config file: `~/.config/thunderbird-cli/config.json`

## Error Codes

| Code | Meaning |
|------|---------|
| `BRIDGE_UNREACHABLE` | Bridge is not running |
| `EXTENSION_DISCONNECTED` | Thunderbird extension not connected |
| `TIMEOUT` | Request timed out (30s default) |
| `NOT_FOUND` | Message/folder/account not found |
| `INVALID_ARGS` | Bad arguments or missing `--confirm` |
| `THUNDERBIRD_ERROR` | Error from Thunderbird messenger API |
