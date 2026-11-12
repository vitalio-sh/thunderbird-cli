# Release XPIs

The Thunderbird extension builds users should install. Each file is the XPI returned by
addons.thunderbird.net (ATN) for self-distribution after uploading that version.

**These files carry no embedded Mozilla signature** — there is no `META-INF/` directory. Each is a
plain zip of `extension/` at the release tag. Verify what you install by comparing contents, which
works with any Node.js version:

```bash
git checkout v1.2.0 && npm ci && npm run build:xpi
mkdir -p /tmp/a /tmp/b && unzip -oq dist/thunderbird-cli-2.2.0.xpi -d /tmp/a \
  && unzip -oq dist/releases/thunderbird_ai_bridge-2.2.0-tb.xpi -d /tmp/b && diff -r /tmp/a /tmp/b
```

From 2.1.1 on, `npm run build:xpi` uses fixed file order and timestamps, so a rebuild is also
byte-identical (`cmp`) when it runs on the same Node.js major version as the release: zlib's
compressed output differs between Node versions. 2.1.1 and later are built with Node.js 24 (the release workflow too). Releases up to
2.1.0 embed build timestamps, so only their contents match.

## Files

| File | Extension version | Obtained from | Date | SHA-256 |
|---|---|---|---|---|
| `thunderbird_ai_bridge-2.2.0-tb.xpi` | 2.2.0 | addons.thunderbird.net (self-distribution) | 2026-11-12 | `5aaef054b11f370e5a677b452aded8566509e9d35afc97667aa3fde35bc11631` |
| `thunderbird_ai_bridge-2.1.1-tb.xpi` | 2.1.1 | addons.thunderbird.net (self-distribution) | 2026-11-12 | `cc3eddeebb592801734cc5e1dd6f220643459e15eba63dfe5be559615cba3f29` |
| `thunderbird_ai_bridge-2.1.0-tb.xpi` | 2.1.0 | addons.thunderbird.net (self-distribution) | 2026-09-14 | `999a3ef550153d49946007375109379d3c69d01701e5ee2f5df2a3ab43f3bdc9` |
| `thunderbird_ai_bridge-2.0.0-tb.xpi` | 2.0.0 | addons.thunderbird.net (self-distribution) | 2026-04-08 | |

## How to install

1. Download the latest `.xpi` from this directory (or from GitHub Releases)
2. Open Thunderbird → **Add-ons and Themes**
3. Click the ⚙ gear icon → **Install Add-on From File…**
4. Select the downloaded `.xpi` and confirm

## How to release a new version

1. Bump version in `extension/manifest.json`
2. Run `npm run build:xpi` to create the build in `dist/`
3. Upload it to https://addons.thunderbird.net as a new version (self-distribution; no build tools, so no source submission)
4. Download the file ATN returns, check it with `cmp` against the build, and save it here as `thunderbird_ai_bridge-<version>-tb.xpi` with its SHA-256 in the table
5. Commit, tag `v<npm version>`, push — GitHub Actions attaches it to the Release
