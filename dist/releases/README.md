# Signed Release Artifacts

This directory contains **ATN-signed** Thunderbird extension builds. These are the files you should distribute to users — they are the canonical versions that install permanently in standard Thunderbird.

## Files

| File | Version | Signed by | Date |
|---|---|---|---|
| `thunderbird_ai_bridge-2.0.0-tb.xpi` | 2.0.0 | addons.thunderbird.net | 2026-04-08 |

## Why these are in git

ATN-signed XPIs are tracked in git (not gitignored like `dist/thunderbird-cli-*.xpi`) because:

1. Users need the **exact ATN-served bytes** to get trust — hand-built XPIs from source won't install permanently
2. Mozilla's signing is **out-of-band** (hash-registry based), so the file itself is byte-identical to the uploaded source but ATN holds the trust record
3. Making these available on `main` branch lets users install even before GitHub Releases are set up

## How to install

1. Download the latest `.xpi` from this directory (or from GitHub Releases)
2. Open Thunderbird → **Add-ons and Themes**
3. Click the ⚙ gear icon → **Install Add-on From File…**
4. Select the downloaded `.xpi`
5. Restart Thunderbird

The extension will persist across restarts. No "unsigned" warnings.

## How to release a new version

1. Bump version in `extension/manifest.json`
2. Run `npm run build:xpi` to create the unsigned build in `dist/`
3. Upload the unsigned `.xpi` to https://addons.thunderbird.net as a new version
4. Wait for signing (usually minutes to hours for already-reviewed extensions)
5. Download the signed `.xpi` from ATN's "My Submissions" page
6. Save it to this directory with naming: `thunderbird_ai_bridge-<version>-tb.xpi`
7. Commit, tag `v<version>`, push — GitHub Actions will attach it to the Release
