# thunderbird-cli — Distribution log

> Append-only record of every external submission. Policy from [MASTER-PLAN §6.5](../../docs/MASTER-PLAN.md).
>
> Columns: **Venue** · **Submitted** · **URL** · **Status** · **Notes / follow-up**.

## Tier 1 — MCP registries

| Venue | Submitted | URL | Status | Notes |
|---|---|---|---|---|
| **Official MCP Registry** | 2026-04-18 | https://registry.modelcontextprotocol.io/servers/io.github.vitalio-sh/thunderbird-cli | ✅ live | v1.0.2. Canonical record; downstream registries pull from here. |
| **PulseMCP** | n/a | https://www.pulsemcp.com | ⏳ auto-ingest | Form replaced with automatic ingestion from Official Registry. ~weekly cadence. |
| **Smithery** | 2026-04-18 | https://smithery.ai/servers/psnukcool/thunderbird-cli | ✅ published (pending build) | Qualified name `psnukcool/thunderbird-cli`. Published via `SMITHERY_API_KEY=<key> smithery mcp publish "https://github.com/vitalio-sh/thunderbird-cli" -n psnukcool/thunderbird-cli`. Note: Smithery assigns namespaces by primary-email handle (`psnukcool`), not GitHub handle. Follow-up: once build is green, add `--config-schema` describing `TB_BRIDGE_HOST` / `TB_BRIDGE_PORT` for better UX. |
| **Glama** | n/a | https://glama.ai/mcp/servers | ⏳ auto-index | Auto-indexes from GitHub/npm within 24–48h of publish. Dockerfile added 2026-04-18 to unblock score check. Human action: after listing appears, sign in as vitalio-sh and click "Claim". |
| **mcp.so** | 2026-04-18 | https://github.com/chatmcp/mcpso/issues/2107 | ⏳ queued | Submitted via GitHub issue. |
| **LobeHub MCP** | — | https://lobehub.com/mcp | ⏳ pending | Auto-indexes from GitHub. |

## Tier 2 — Awesome-list PRs

| Venue | Submitted | URL | Status | Notes |
|---|---|---|---|---|
| **patriksimek/awesome-mcp-servers-2** | 2026-04-18 | https://github.com/patriksimek/awesome-mcp-servers-2/pull/7 | 📬 open | 1-line add to Communication. |
| **punkpeye/awesome-mcp-servers** (84.8k ⭐) | 2026-04-18 | https://github.com/punkpeye/awesome-mcp-servers/pull/5080 | ⏸ awaiting Glama | Bot requires Glama score badge. Dockerfile added; waiting on Glama auto-index. Re-push branch with badge once Glama listing is live. |
| **appcypher/awesome-mcp-servers** | — | — | ✖ blocked | Owner disabled PR creation on repo settings. Branch ready at vitalio-sh/awesome-mcp-servers#add-thunderbird-cli if re-enabled. |
| **wong2/awesome-mcp-servers** | — | https://mcpservers.org/submit | pending | Form submission, not a PR. |

## Tier 3–4 — Launch channels (human-only)

None submitted yet. See [MASTER-PLAN §3.3](../../docs/MASTER-PLAN.md) for sequence and copy.

| Venue | Planned | URL template | Owner |
|---|---|---|---|
| r/selfhosted | Day 2 | `https://reddit.com/r/selfhosted/submit` | human ⚠️ |
| r/LocalLLaMA | Day 3 | | human ⚠️ |
| r/ClaudeAI | Day 3 | | human ⚠️ |
| r/mcp | Day 4 | | human ⚠️ |
| r/commandline | Day 4 | | human ⚠️ |
| **Show HN** | Day 5, Tue 8–10am PT | https://news.ycombinator.com/submit | human ❌ |
| Mozilla Discourse — Thunderbird Add-ons | Day 6 | https://discourse.mozilla.org/c/thunderbird/addons/255 | human ⚠️ |
| MCP Discord `#new-servers` | Day 6 | via modelcontextprotocol/servers | human ⚠️ |

## Tier 5 — Newsletters (post-Week-1 traction)

None submitted yet.

## Tier 6 — Long-tail directories

| Venue | Submitted | URL | Status | Notes |
|---|---|---|---|---|
| Awesome-CLI (`agarrharr/awesome-cli-apps`) | — | — | — | |
| Awesome-selfhosted | — | — | — | Strict license review (MIT qualifies). |
| AlternativeTo | — | https://alternativeto.net | — | Web form. |
| Slant | — | https://www.slant.co | — | |
| There's An AI For That | — | https://theresanaiforthat.com/submit/ | — | |
| Homebrew tap | — | https://github.com/vitalio-sh/homebrew-thunderbird-cli | — | Create custom tap first. |
| AUR | — | https://aur.archlinux.org/packages/thunderbird-cli | — | PKGBUILD. |
| nixpkgs | — | https://github.com/NixOS/nixpkgs | — | Derivation PR. |

## Owned-channel drafts

| Channel | Draft | Status |
|---|---|---|
| vitalio.sh blog | [docs/drafts/blog-thunderbird-cli-launch.md](../../docs/drafts/blog-thunderbird-cli-launch.md) | Draft ready, awaiting human polish |
| X/Twitter thread | [docs/drafts/x-thread-launch.md](../../docs/drafts/x-thread-launch.md) | Draft ready, 12 posts |
| LinkedIn article | — | Not drafted |

## Repository health (already done)

| Item | Status |
|---|---|
| GitHub Discussions | ✅ enabled |
| Dependabot alerts + security updates | ✅ enabled |
| Branch protection on `main` | ✅ classic rule — no force-push, no deletion |
| Repo topics | ✅ 9 topics set |
| Social preview PNG | 📦 built at `assets/social-preview.png` — **human action: upload at Settings → Social preview** |
