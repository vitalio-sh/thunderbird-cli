# Release artifacts

Older upstream signed XPIs were removed from this fork because they contain
full-access deletion code and do not implement our access policy.

Build this fork using `npm run build:xpi`, or pass `-- --access-config <file>`.
See [Access control](../../docs/ACCESS-CONTROL.md) and
[Setup](../../docs/SETUP.md). No build installs itself in Thunderbird.

Before distributing a signed build, verify that it matches this fork's current
source, contains no message/folder deletion handlers, and never requests
`messagesDelete`. Never substitute an older upstream binary.
