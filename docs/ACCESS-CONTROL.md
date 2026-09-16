# Access control

The add-on enforces one installation-wide policy for CLI, optional MCP, and
direct bridge requests. Reading and searching cannot be switched off. This is
an operation policy, not per-user or per-account authentication.

## Configure and install

1. Copy `access.example.json` to `access.local.json` (ignored by Git).
2. Change the boolean values you need.
3. Run `npm run build:xpi -- --access-config access.local.json`.
4. Install the newly built XPI in Thunderbird using Add-ons Manager.
5. Run `tb access` to inspect the policy of the **loaded add-on**, not the local
   file. Restart Thunderbird if the add-on update has not taken effect.

Editing JSON alone does not change a running add-on. The builder embeds a
validated policy in the XPI and derives Thunderbird's native permissions from
it. Enabling a right may require approving new add-on permissions. No build
command updates your Thunderbird profile automatically.

Without `--access-config`, builds use the source defaults. Missing keys use
those defaults; unknown keys, non-booleans, missing explicitly named files and
invalid JSON fail the build. `send=true` with `compose=false` also fails rather
than silently enabling composition.

## Available switches

| Key | Default | What it allows |
|---|---|---|
| `downloadAttachments` | true | Dedicated attachment downloads, including `--all` |
| `compose` | true | Prepare/open/save new messages, replies and forwards without sending |
| `send` | false | Send through compose, reply or forward; also requires `compose` |
| `move` | false | Move existing messages, including bulk move |
| `copy` | false | Copy existing messages into another folder |
| `archive` | false | Archive existing messages |
| `mark` | false | Change read/unread, flagged and junk properties; includes bulk mark-read |
| `tag` | false | Set/remove tags on messages, including bulk tagging |
| `tagCreate` | false | Create tag definitions |
| `folderCreate` | false | Create folders |
| `folderRename` | false | Rename folders |

Message deletion, folder deletion, attachment deletion and emptying Trash are
not implemented. There is no switch to enable them, and builds never request
`messagesDelete`. Old `delete`/`folderDelete` configuration keys are rejected.
To move mail to Trash, enable `move` and use `tb move <ids> <trash-folder-id>`
after identifying the correct account's Trash folder. This calls the move API,
never the delete API; moving messages back out of Trash is also possible.

Always available: health/access checks, account/identity/folder listing, folder
information, statistics, search, listing, ordinary/full/raw/batch/thread reading,
recent messages, tag listing, contacts, attachment metadata, download status,
and explicit message-body fetching (including bulk fetching). There is no
`read` or `search` switch. Manual sync remains unsupported; a permission cannot
implement it.

Internal API steps do not need separate switches. Reply can read its original
quotation without an extra grant. Bulk operations use the same rights as their
single-message counterparts. A request setting both tags and message flags
requires both `tag` and `mark` before doing any work. Unknown routes/methods are
denied until explicitly classified in the add-on.

## Boundaries

- Saving/opening drafts is not strictly read-only: Thunderbird can save or
  autosave them to a server's Drafts folder. Disabling `compose` does not close
  drafts already open.
- Disabling `send` blocks connector sending, not a person pressing Send.
  Enabling a capability is not authorization for an AI to use it; existing
  user-approval and confirmation requirements still apply.
- Disabling `downloadAttachments` blocks the dedicated attachment export route.
  It is **not a data-loss-prevention boundary**: always-available raw MIME reads
  can include attachment bytes, which a caller could extract independently.
- Thunderbird's delete API can be irreversible even without a permanent flag,
  depending on account settings and the source folder. This fork does not use
  that API at all. Account/server retention and automatic Trash cleanup remain
  outside this connector's control; moving mail to Trash does not disable them.
- Native permissions can be broader than operations: Thunderbird uses
  `addressBooks` for contact reading and `messagesMove` for copy/move/archive.
  The add-on router restricts operations further, before side effects.
- This does not protect against a program that can modify the add-on/profile,
  another full-access add-on, or untrusted callers reading always-readable mail.
  Keep bridge authentication and OS protections. Setting TB_AUTH_TOKEN protects
  both HTTP and WebSocket; build the add-on with the matching private auth file.
- Previously signed upstream XPIs and existing installations do not acquire
  this policy automatically. Build and install this fork's add-on.

MCP is optional: CLI users need only the CLI, bridge and add-on.

Native API references: [messages](https://webextension-api.thunderbird.net/en/mv2/messages.html),
[contacts](https://webextension-api.thunderbird.net/en/mv2/contacts.html).
