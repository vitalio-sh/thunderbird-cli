# Authenticated CLI-only installation

One checkout provides the CLI, loopback bridge and Thunderbird add-on. MCP is
optional and is not needed for CLI use. Node 20+ and Thunderbird 128+ are required.
No global npm installation, Python draft helper or Experiment API is needed.

## Prepare

Install workspace dependencies with `npm ci --ignore-scripts`. Run `npm test`,
`npm run test:local`, `npm run test:extension`, `npm run test:mcp`,
`npm run test:bridge-auth` and `npm run test:bridge-security` before deployment.
These tests use synthetic data, not a real mailbox.

Run `node scripts/configure-local.mjs`. It creates a private `local-runtime/bridge.env`
and a user-service template, preserves an existing valid token, and makes `./tb`
executable. The CLI loads this environment; the service uses the same credentials.
For migration, copy the old private environment file before running this command.

Copy `access.example.json` to ignored `access.local.json` and choose capabilities.
Defaults permit reading, searching, attachment downloads and drafts; sending and
mailbox changes are disabled. Deletion and emptying Trash do not exist in this fork.
Configuration changes require a rebuilt/reinstalled XPI, not just a bridge restart.

Build a private installer with a stable filename:

```sh
node scripts/build-xpi.mjs --access-config access.local.json \
  --auth-file local-runtime/bridge.env --output dist/thunderbird-cli.xpi
```

When replacing an existing customized installation, pass its existing `--addon-id`
and a newer internal `--addon-version`. These override package metadata, not source.
Keep the ID unchanged to replace the add-on rather than installing a second one.
Date-based private builds can use `YYYY.M.D.N`, for example
`--addon-version 2026.9.16.1`. Do not pad month/day with zeroes. Increment `N`
for another build on the same date and start at 1 on a new date. Always use a
version greater than the installed one. This private add-on version is independent
of npm package versions; it does not require republishing the CLI or MCP packages.
The XPI contains the private token: mode 600, never publish/share it or upload it
to an add-on store. An ordinary build without `--auth-file` remains public.

Install the generated user service in `~/.config/systemd/user/`, reload systemd,
and enable it. Disable any older bridge service first: exactly one bridge may
own ports 7700/7701. Generated paths follow the checkout and current Node runtime.
Do not put real paths or credentials into public source.
Validate the generated service with `systemd-analyze --user verify` first.
Its explicit empty default token makes a missing environment file fail closed.

## In-place update

Back up the installed XPI, service and skill. Check for unsaved compose windows,
quit Thunderbird normally, and verify all Thunderbird processes exited. Only then
atomically replace its existing profile XPI, retaining private permissions.
Do not edit message databases or extension registry/cache files. On first install,
use Add-ons Manager -> Install Add-on From File and approve the permissions.
Never disable signature verification to make an installation work.

Restart the bridge and Thunderbird, then check `./tb health`, `./tb access`, and
read-only searches. Verify the installed ID, version, policy and source bytes.
If permissions need approval, use Thunderbird's approval UI; do not rewrite its
extension registry. Keep backups until verification succeeds, then use Trash.

## Drafts and replies

```sh
./tb compose --to person@example.org --subject Subject --body-file /path/body.html --html --attach /path/file.pdf --open
./tb reply MESSAGE_ID --from IDENTITY_ID --body-file /path/reply.txt --attach /path/file.pdf --open
./tb inspect-compose TAB_ID
```

Use escaped minimal HTML paragraphs for proportional new-message text; plain text
also works. Replies normally take plain text and keep the original native HTML or
plain quotation. Reply identity comes from `accounts`/`identities`. Explicit `--to`
overrides clear Cc/Bcc. Attachments are limited to 25 MiB total. Check genuine reply
linkage, recipients, body and attachments before handing an open draft to the user.
Thunderbird may autosave drafts, but no message is sent without an enabled send
policy and an explicit send request. A partial failure names the already-open
reply tab: inspect it before retrying rather than opening duplicates.

During shutdown, saving a draft can cancel the application's quit request. Check
again for remaining windows/processes after resolving prompts; never force-close
unsaved user work or trust a sandbox-only process listing as a host-level check.

Searches use Thunderbird's accounts and available data, not direct IMAP.
`total` means returned records; `hasMore` means the result is truncated. Sorted
lists collect all matching headers before selecting the requested page. Large
folders/body searches may take time; a timeout is not an empty result.
