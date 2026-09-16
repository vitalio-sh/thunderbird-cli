# CLI Command Reference

CLI commands in `tb`. For the quick tour, see the [main README](../README.md). For AI-agent-focused usage, see [CLAUDE.md](CLAUDE.md).

## Access policy

`tb access` reports the policy enforced by the installed add-on (`GET /access`).
Reading/searching are always available. Attachment downloads and drafts default
to enabled; sending and changes to existing mail default to disabled. See
[Access control](ACCESS-CONTROL.md) for every switch and build/install steps.
These restrictions also apply to MCP and direct bridge calls. The commands below
describe capabilities, not a promise that every capability is enabled.

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

`--max-body N` also limits `--body-only` output; truncated text ends with
`...[truncated]`. Folder information, folder listings and statistics report
native count failures as errors, not as zero messages.
Recursive lists and statistics skip native count requests for account-root
containers (which hold no messages) and still visit their real child folders.
A direct `folder-info` request for a root reports Thunderbird's unsupported error.

Each thread entry carries `threadMatch`: `"references"` when it was found through the
`References` / `In-Reply-To` headers, or `"subject"` when it was only matched by identical
normalized subject (later replies that don't reference the message yet). Subject matches are a
heuristic — treat them with more suspicion.

## Recent / Timeline

```bash
tb recent [options]
  --hours <n>              # lookback period (default: 24)
  --unread                 # unread only
  --account <id>           # filter by account
  -l, --limit <n>          # max results (default: 50)
```

## Move, Copy, Archive

```bash
tb move <messageIds> <folderId>               # move (comma-separated IDs)
tb copy <messageIds> <folderId>               # copy
tb move <messageIds> <trashFolderId>           # move to the account's Trash folder
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
  --header <name:value>    # custom header supported by Thunderbird (e.g. X-Project: demo)
  --draft                  # save as draft (default)
  --open                   # open in Thunderbird compose window
  --send                   # send immediately

tb reply <messageId> [options]
  --body <text>            # reply text
  --body-file <path>       # read from file
  --all                    # reply to all
  --html                   # supplied reply body is HTML
  --draft / --open / --send

tb forward <messageId> [options]
  --to <address>           # required
  --body <text>            # additional text
  --draft / --open / --send
```

Replies prepend the supplied text to Thunderbird's generated reply body, keeping
its quotation and reply metadata. If preparation fails after opening a window,
the error identifies that window; inspect it before retrying.

## Attachments

```bash
tb attachments <messageId>                                     # list attachments
tb attachment-download <messageId> <partName> --output <path>  # download one
tb attachment-download <messageId> --all --output-dir <dir>    # download all
```

Downloads never overwrite an existing path. Bulk downloads reject filenames
containing path separators or control characters. New files have mode `0600`.
Text and HTML attachments are listed as attachments, not merged into the body.

## Fetch & Sync

```bash
tb fetch <messageId>                      # force download from IMAP
tb fetch --folder <folderId> --limit <n>  # batch fetch
tb download-status <messageId>            # check: full | headers_only

tb sync <folderId>                        # unsupported: returns an explicit error
tb sync --all                             # unsupported: use Thunderbird's Get Messages
tb sync-status <folderId>                 # current folder counts, not IMAP sync progress
```

`download-status` and `read --check-download` verify retrieval with `getFull`
without decrypting, then use Thunderbird's native `headersOnly` flag. Empty or
attachment-only messages are not classified by text length. Retrieval failures
are errors. `full` (and `hasBody=true`) means not headers-only, not necessarily
nonempty or decrypted text. The check may fetch mail; it does not prove that a
permanent offline copy is cached. Attachment listing failures also remain errors.

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
tb bulk tag <folderId> <tagKey> [--older-than <days>] [--from <addr>]
tb bulk fetch <folderId> [-l <n>]                                 # force IMAP download
```

Bulk move/tag apply filters before the batch limit. Bulk move refuses to
run against an older extension that does not confirm this behavior. Upgrade the
CLI and extension together. The default batch remains 100 matching messages,
not the whole folder. A subject filter is a regular expression for bulk move
and a case-insensitive substring for bulk tag, as in earlier versions.

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
