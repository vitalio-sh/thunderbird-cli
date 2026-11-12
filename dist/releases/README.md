# Release XPIs

The Thunderbird extension builds users should install. Each file is the XPI returned by
addons.thunderbird.net (ATN) for self-distribution after uploading that version.

**These files carry no embedded Mozilla signature** — there is no `META-INF/` directory. Each is a
plain zip that is byte-identical to `npm run build:xpi` output for `extension/` at the release
tag. Verify what you install:

```bash
unzip -l thunderbird_ai_bridge-2.1.0-tb.xpi        # manifest.json, src/background.js, src/thread-utils.js
git checkout v1.1.0 && npm run build:xpi && cmp dist/thunderbird-cli-2.1.0.xpi dist/releases/thunderbird_ai_bridge-2.1.0-tb.xpi
```

## Files

| File | Extension version | Obtained from | Date | SHA-256 |
|---|---|---|---|---|
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
