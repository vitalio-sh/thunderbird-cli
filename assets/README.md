# Assets

Demo GIFs, screenshots, and branding materials for the README and social previews.

## Required files

| File | Used by | Status |
|---|---|---|
| `demo.gif` | Main README (top of fold) | ✅ Done (296 KB, Claude Desktop overview query) |
| `social-preview.png` | GitHub social preview (1280×640) | ✅ Done (source: `social-preview.svg`) — upload via repo Settings → Social preview |
| `architecture.png` | README "How It Works" | ✅ Done (source: `architecture.svg`, rendered via sharp) |

---

## `demo.gif` — the single most important asset

Per the publishing guide, the GIF demo accounts for ~50% of star decisions. Make it count.

### What to show (10-15 seconds total)

**Script idea 1 — Claude Desktop (recommended):**

1. Split screen: Thunderbird on left, Claude Desktop on right
2. Type in Claude: *"How many unread emails do I have, and what are the top 3?"*
3. Show Claude calling `email_stats` → `email_search` (MCP tool calls visible)
4. Show the response: account counts + 3 real subject lines
5. Hold on the final result for 2 seconds

**Script idea 2 — CLI power user:**

1. Terminal with dark theme
2. Run `tb stats` → show 22 accounts, 249K messages
3. Run `tb search "invoice" --since 7d --fields id,author,subject`
4. Run `tb read 11 --headers`
5. Hold on the final result

**Script idea 3 — the wow moment:**

1. Claude Desktop open
2. User types: *"Archive all GitHub notification emails older than 30 days"*
3. Claude calls `email_search` → shows the matching messages
4. Claude calls `email_archive` → shows "archived: 47"
5. Hold on the final result

### Recording tools

- **macOS:** [Kap](https://getkap.co) (free, lightweight) or [CleanShot X](https://cleanshot.com) (paid, best quality)
- **Terminal-only demos:** [VHS by Charmbracelet](https://github.com/charmbracelet/vhs) — generates GIFs from tape files, reproducible
- **Linux:** Peek, Byzanz
- **Windows:** ScreenToGif

### Rules (from docs/GITHUB_PROJECT_PUBLISHING_GUIDE.md)

- **Max 10-15 seconds**
- **15 fps** is enough (smaller file size)
- **Crop tightly** — no desktop wallpaper, no browser chrome unless relevant
- **Terminal font 16-18px** so GitHub renders it readable
- **Dark theme** — looks good on both white and dark GitHub backgrounds
- **Realistic data** — use your real unread count, real subject lines
- **File size under 5MB** (GitHub renders up to 10MB but load time matters)
- **Brief pause on final result** (2 seconds) so viewers can process

### Saving

Save the final GIF as `assets/demo.gif` (this exact path is referenced in `README.md`).

---

## `social-preview.png` — GitHub Open Graph card

Shown when the repo is shared on Twitter/Slack/Discord. Must be **1280×640 PNG**.

### What it should have

- Project name: **thunderbird-cli**
- Tagline: *"Give Claude full access to your email through Thunderbird"*
- Visual: Thunderbird logo + Claude logo + terminal output (or a stylized icon)
- Dark background (looks good on Twitter/Discord previews)
- Logo or signature somewhere small

### Tools

- [Figma](https://figma.com) — free, templates available
- [Canva](https://canva.com) — templates for GitHub social cards
- [socialify.git.ci](https://socialify.git.ci) — generate from repo URL (quick and easy)

### Setting it on GitHub

After creating, upload to repo **Settings → Social preview → Upload an image**.

---

## `architecture.png` — diagram (optional)

Currently the README uses an ASCII diagram. An actual PNG looks more professional.

### What it should show

Same layout as the ASCII diagram in README.md:

```
Thunderbird Desktop
       ↕
   Extension
       ↕ WebSocket
     Bridge
       ↕ HTTP
  ┌──────────┬──────────┐
 CLI      MCP Server   curl
  ↓          ↓          ↓
AI Agent  Claude    any script
           Desktop
```

### Tools

- [Excalidraw](https://excalidraw.com) — hand-drawn feel, exports PNG/SVG
- [draw.io](https://app.diagrams.net) — more precise
- [tldraw](https://tldraw.com) — clean, modern

Save as `assets/architecture.png` and reference from README.md and SPEC.md.
