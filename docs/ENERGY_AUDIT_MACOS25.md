# Energy Efficiency Audit — macOS 25 MacBook Pro

**Project:** `vitalio-sh/thunderbird-cli`  
**Audit context:** `le-dawg/thunderbird-cli` (fork, execution context only)  
**Date:** 2026-07-28  
**Auditor:** Copilot Cloud Agent (automated)  
**Scope:** `tb-bridge` daemon, Thunderbird WebExtension, CLI ↔ bridge ↔ extension request architecture

---

## Executive Summary

`thunderbird-cli` is a well-structured localhost-only bridge between AI agents and Thunderbird. The **bridge daemon itself has near-zero idle cost**: it is purely event-driven, fires no background timers, and writes nothing to disk. This is genuinely strong energy design.

The **two critical energy problems** are:

1. **Fixed 3-second reconnect with no backoff in the extension** (`extension/src/background.js:10,70`). When the bridge is not running — which is the normal state on a developer machine between sessions — the Thunderbird WebExtension schedules a new timer every 3 seconds, indefinitely. This produces ~20 JavaScript-engine wakeups per minute for as long as Thunderbird is open without the bridge. This is a direct violation of Apple's "coalesce timers and avoid aggressive intervals" guidance and measurably impacts battery life in normal use.

2. **Serial sequential `await` chains inside the extension** for multi-record operations (read-batch, thread reconstruction, bulk-tag, bulk-fetch, stats tree traversal). Each awaited call is a round-trip through the WebSocket pipe. A 10-message read-batch is 20 sequential messenger API calls; thread reconstruction scales with thread depth; bulk-tag issues one `update()` per message; stats recursion issues one `getFolderInfo()` per folder. These patterns multiply latency and keep the Node.js event loop (bridge side) and Thunderbird's IPC (extension side) busy longer than necessary.

A byte-by-byte attachment base64 encoding loop (`background.js:398-400`) is a supplementary CPU and GC concern for large attachments.

All other design choices — event-driven HTTP/WS routing, per-request `setTimeout` (not `setInterval`), single-connection WS architecture, localhost-only binding, no polling, no disk logging — are energy-appropriate.

---

## Methodology

### Sources Used

| Source | Role |
|---|---|
| DeepWiki MCP (vitalio-sh/thunderbird-cli) | Architecture overview, component descriptions, reconnect strategy, logging behavior, ws library details, CORS/ping-pong analysis |
| `bridge/bridge.js` (local, full read) | Line-level analysis of HTTP server, pending map, timer lifecycle, WS brokering |
| `extension/src/background.js` (local, full read, 808 lines) | Line-level analysis of reconnect loop, request router, all handler implementations, helper functions |
| `cli/src/client.js` (local, full read) | HTTP client, config loading, output transformation pipeline |
| `mcp/src/server.js` (local, full read) | MCP stdio transport, tool dispatch |
| `bridge/package.json`, `package.json` | Dependency versions (`ws ^8.17.0 / ^8.20.0`) |
| `extension/manifest.json` | Extension permissions scope |

DeepWiki coverage was comprehensive for architecture and lifecycle topics. For implementation detail (loop patterns, attachment encoding, sequential awaits) direct code inspection was authoritative and in a few places more detailed than DeepWiki's index-size-limited analysis. Where DeepWiki and code differed (e.g. DeepWiki described ws ping/pong as "automatically handled" but the bridge code confirms no explicit `pingInterval` option is passed), code is treated as authoritative.

### Timestamp Context

Code examined reflects tag `v1.0.2` / commit state of the fork as of 2026-07-28. DeepWiki index is built from the upstream `vitalio-sh/thunderbird-cli` repository and was accessed on the same date.

---

## Architecture Overview (Energy-Relevant Paths)

```
AI Agent
  └─→ tb CLI (short-lived Node.js process)
        └─→ HTTP POST :7700 (127.0.0.1 only)
              └─→ bridge daemon (long-lived Node.js process)
                    └─→ WebSocket :7701 (127.0.0.1 only)
                          └─→ Thunderbird WebExtension (background.js)
                                └─→ messenger.* Thunderbird internal APIs
```

Energy-significant components:
- **bridge daemon**: long-lived; macOS will keep its Node.js process resident
- **WebExtension background.js**: runs inside Thunderbird's renderer/background context; timers here contribute to Thunderbird's wakeup budget
- **CLI / MCP server**: short-lived (invoked per request); not a persistent energy concern

---

## Detailed Findings

### Finding 1 — Fixed 3-Second Reconnect With No Exponential Backoff

**File:** `extension/src/background.js`  
**Lines:** 10, 68–74, 55–65

```js
const RECONNECT_DELAY = 3000;  // line 10

function scheduleReconnect() {
  if (reconnectTimer) return;   // line 69 — guard against double-schedule
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_DELAY);           // always 3 000 ms, no growth
}
```

`scheduleReconnect()` is called from `ws.onclose` (line 58) and `ws.onerror` (line 63). The reconnect fires after exactly 3 seconds regardless of how long the bridge has been absent, and it continues indefinitely.

**Energy impact:** When the bridge is not running (the default state between AI agent sessions), the extension fires a reconnect attempt every 3 seconds. Each attempt:
1. Wakes Thunderbird's background script host
2. Attempts `new WebSocket("ws://127.0.0.1:7701")` — a loopback TCP connect that immediately ECONNREFUSED
3. Catches the error, calls `scheduleReconnect()` again

On macOS, this is approximately **20 background-script wakeups per minute**. With macOS 15/Sequoia power accounting granularity, each wakeup has a measurable cost even if the work is trivial. In Apple's recommended model (Instruments → Energy Log), this appears as a steady "background activity" entry for Thunderbird even when no email work is happening. For a user who starts Thunderbird at login and never runs `tb-bridge`, this leaks energy for the entire session.

**Risk:** CRITICAL  
**Apple guideline violated:** "Coalesce timers and avoid aggressive intervals"; "Minimize unnecessary wakeups"

---

### Finding 2 — Serial Sequential `await` in `read-batch`

**File:** `extension/src/background.js`  
**Lines:** 239–251

```js
if (path === "/messages/read-batch" && method === "POST") {
  const { messageIds } = body || {};
  const results = [];
  for (const id of messageIds) {
    try {
      const msg = await messenger.messages.get(id);           // sequential
      const full = await messenger.messages.getFull(id);      // sequential
      results.push({ ...formatMessage(msg), parts: extractParts(full) });
    } catch (e) {
      results.push({ id, error: e.message });
    }
  }
  return results;
}
```

For N message IDs: **2N sequential IPC round-trips** to Thunderbird. Each `get()` + `getFull()` pair blocks the next iteration. Messenger APIs are async but the extension serializes them.

**Impact:** For a 10-message batch: 20 sequential messenger calls. Each call crosses the extension ↔ bridge ↔ client chain. Total latency is additive. CPU and IPC bus stay active for the entire duration instead of bursting and going idle.

**Risk:** HIGH  
**Apple guideline:** "Scale work with demand" — prefer burst-then-idle over sustained drip

---

### Finding 3 — Serial Sequential `await` in Thread Reconstruction

**File:** `extension/src/background.js`  
**Lines:** 405–426

```js
const ids = new Set([...refs, inReply, msgHdrId].filter(Boolean));
const thread = [];
for (const hdrId of ids) {
  try {
    const r = await messenger.messages.query({ headerMessageId: hdrId }); // sequential
    if (r.messages) {
      for (const m of r.messages) {
        if (!thread.find((t) => t.id === m.id)) thread.push(formatMessage(m));
      }
    }
  } catch (e) {}
}
```

For a thread with M reference IDs (Re: Re: Re: chains can have 10–30): **M sequential `messenger.messages.query()` calls**. Each query is a full search request propagated to Thunderbird's message store. In a busy mailbox this is a non-trivial I/O chain serialized unnecessarily.

**Risk:** HIGH  
**Apple guideline:** Burst operations and return to idle promptly

---

### Finding 4 — Per-Message Sequential Loop in `bulk/tag`

**File:** `extension/src/background.js`  
**Lines:** 669–682

```js
for (const msg of filtered) {
  const tags = [...(msg.tags || [])];
  if (!tags.includes(body.tagKey)) {
    tags.push(body.tagKey);
    await messenger.messages.update(msg.id, { tags });  // sequential, one per msg
    tagged++;
  }
}
```

`messenger.messages.update()` is called once per matching message with no concurrency. For 100-message bulk-tag, this is 100 sequential IPC round-trips. `messenger.messages.update()` does not expose a batch form, so this pattern is constrained by the API, but parallelism via `Promise.all()` is available.

**Risk:** HIGH  
**Apple guideline:** Reduce sustained background activity duration

---

### Finding 5 — Per-Message Sequential Loop in `bulk/fetch` and `messages/fetch`

**File:** `extension/src/background.js`  
**Lines:** 685–692 and 265–267

```js
for (const msg of result.messages) {
  try { await messenger.messages.getRaw(msg.id); fetched++; } catch {}  // sequential
}
```

Same pattern: N sequential getRaw calls. `getRaw()` forces a network round-trip to IMAP server for each message. Serializing these prevents parallel download scheduling inside Thunderbird's IMAP subsystem.

**Risk:** HIGH  
**Apple guideline:** Prefer burst-and-idle; avoid serialized long-duration I/O chains

---

### Finding 6 — Recursive `getFolderInfo` in Stats / Folder Listing

**File:** `extension/src/background.js`  
**Lines:** 526–565 (`/stats`), 740–756 (`flattenFolders`), 758–767 (`countFolder`)

```js
async function countFolder(folder, stats) {
  stats.folders++;
  let info = {};
  try { info = await messenger.folders.getFolderInfo(folder); } catch {}  // sequential per folder
  stats.unreadTotal += info.unreadMessageCount || 0;
  stats.messageTotal += info.totalMessageCount || 0;
  if (folder.subFolders) {
    for (const sub of folder.subFolders) await countFolder(sub, stats);  // depth-first serial
  }
}
```

For a Thunderbird account with a deep folder hierarchy (common: INBOX/Sent/Drafts/Trash + subfolders + IMAP server-side folders = 20–50+ folders), this generates O(folders) sequential `getFolderInfo()` IPC calls, and no parallelism. The response is uncached — every `/stats` call re-traverses the entire tree.

**Risk:** MEDIUM  
**Apple guideline:** Avoid repeated identical work; prefer caching where correctness allows

---

### Finding 7 — Byte-by-Byte Attachment Base64 Encoding

**File:** `extension/src/background.js`  
**Lines:** 395–401

```js
const file = await messenger.messages.getAttachmentFile(msgId, partName);
const buffer = await file.arrayBuffer();
const bytes = new Uint8Array(buffer);
let binary = "";
for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);  // O(n) string growth
const base64 = btoa(binary);
return { name: file.name, size: file.size, contentType: file.type, data: base64 };
```

The `binary += String.fromCharCode(bytes[i])` loop creates a string that grows by one character per iteration. In V8, string concatenation in a tight loop is not always optimized to a rope — for strings beyond ~100KB this can trigger repeated memory copies and significant GC pressure. A 5 MB PDF attachment means 5 million iterations of this inner loop.

A more efficient approach uses `String.fromCharCode(...chunk)` with chunked application or `btoa(String.fromCharCode(...new Uint8Array(buffer)))` (which has its own stack limit for very large buffers), or ideally `Buffer.from(buffer).toString('base64')` if the context allows it. Since this is a WebExtension context (not Node.js), `Buffer` is unavailable, but chunked `String.fromCharCode` with `Array.from` or typed array spread is feasible up to the spread limit, and `TextDecoder` + chunked approach avoids GC pressure entirely.

**Risk:** MEDIUM (scales with attachment size; problematic for attachments > 1 MB)  
**Apple guideline:** Reduce unnecessary CPU work; avoid GC pressure bursts

---

### Finding 8 — No macOS Sleep/Wake Awareness

**Files:** `bridge/bridge.js`, `extension/src/background.js`

Neither the bridge daemon nor the extension handles macOS sleep/wake lifecycle. On macOS, when the system returns from sleep:
- The bridge daemon's open TCP listen sockets are re-registered with the kernel (transparent)
- The extension's WebSocket connection to the bridge will be dead (OS closed TCP state)
- The extension will detect the close event and schedule a reconnect (correct behavior, 3s delay)

The issue is not a crash — it is that the reconnect delay is still 3 seconds regardless of how many times the machine has woken from sleep that session, and that the bridge itself has no way to signal "I am ready" to the extension after waking. This is a secondary concern but contributes to the wakeup pressure described in Finding 1.

Node.js daemons on macOS can use `process.on('SIGCONT', ...)` (after SIGSTOP/SIGCONT) or listen for network reachability signals, though the primary mechanism for macOS sleep/wake in a Node daemon is to subscribe to `com.apple.system.config.network_change` via `power_management` utilities. This is advanced and not practically required at current maturity, but is worth noting.

**Risk:** LOW  
**Apple guideline:** "Graceful behavior during sleep/wake and transient disconnections"

---

### Finding 9 — Bridge `pending` Map: No Upper Bound on Concurrent In-Flight Requests

**File:** `bridge/bridge.js`  
**Lines:** 27, 64–77

```js
const pending = new Map(); // id → { resolve, reject, timer }
```

There is no maximum size enforcement on `pending`. Each in-flight HTTP request adds one entry to the map and one 120-second `setTimeout`. Under adversarial or misconfigured conditions (e.g., a runaway AI agent looping search calls), the map can grow unboundedly. Each pending entry holds a `timer` reference, keeping the Node.js event loop alive and preventing GC of the closure. The 120-second timeout means up to 120s × (request rate) entries could accumulate. At 10 req/s for 120s: 1200 live timers.

**Risk:** LOW (normal use is sequential or low-concurrency; adversarial use is the concern)  
**Apple guideline:** Memory growth / cleanup

---

### Finding 10 — CORS Wildcard on Localhost-Bound Server

**File:** `bridge/bridge.js`  
**Lines:** 83–86

```js
res.setHeader("Access-Control-Allow-Origin", "*");
res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-TB-Timeout");
```

Set on every response, including `/bridge/status`. Since the server is bound to `127.0.0.1` and there is an auth token mechanism, the wildcard CORS is largely mitigated. There is no direct energy implication; the header bytes are negligible. This is a minor defense-in-depth gap (a malicious page loaded in a browser could still make requests to 127.0.0.1:7700 from localhost), but outside the scope of energy auditing.

**Risk:** LOW (security note only; no energy impact)

---

### Finding 11 — ws Library `clientTracking` Default Behavior

**File:** `bridge/bridge.js`  
**Lines:** 31

```js
const wss = new WebSocketServer({ host: "127.0.0.1", port: WS_PORT });
```

`ws@8.x` defaults to `clientTracking: true`, which maintains an internal `Set<WebSocket>` of all connected clients. For the bridge's single-extension design, this Set will contain 0 or 1 entries. The overhead is trivial (a Set lookup on each connect/disconnect) and has no meaningful energy impact.

**Risk:** LOW  
**Note:** No action required

---

## Apple Energy-Guidance Compliance Matrix

| Guideline | Component | Verdict | Evidence |
|---|---|---|---|
| Minimize unnecessary wakeups | Bridge daemon | **Compliant** | No background timers, purely event-driven. Zero wakeups at idle. |
| Minimize unnecessary wakeups | WebExtension | **Non-compliant** | Fixed 3s reconnect fires continuously when bridge absent. ~20 wakeups/min. `background.js:10,70` |
| Prefer event-driven over polling | Bridge daemon | **Compliant** | HTTP server and WS server use Node.js event callbacks only. `bridge.js:33,81` |
| Prefer event-driven over polling | WebExtension | **Partially compliant** | Connection detection is event-driven (onclose/onerror); however, the 3s retry period effectively acts as aggressive polling when bridge is absent. `background.js:55-73` |
| Coalesce timers / avoid aggressive intervals | Bridge daemon | **Compliant** | Only per-request setTimeout (on-demand). No periodic timers. |
| Coalesce timers / avoid aggressive intervals | WebExtension | **Non-compliant** | `RECONNECT_DELAY = 3000` hardcoded, no growth, no cap. No backoff strategy. `background.js:10` |
| Reduce unnecessary network I/O | All | **Partially compliant** | No redundant requests at idle. Under load: serial request chains create sustained IPC traffic longer than needed. `background.js:239-250,405-426` |
| Reduce unnecessary disk I/O | All | **Compliant** | No log files. Config read once at startup. No periodic writes. `client.js:28-34` |
| Keep idle cost low | Bridge daemon | **Compliant** | Near-zero idle cost: 2 open TCP sockets, event loop blocked waiting for I/O. |
| Keep idle cost low | WebExtension | **Non-compliant** | Idle cost when bridge absent: recurring 3s timer in Thunderbird JS host. `background.js:68-74` |
| Scale work with demand | Bridge daemon | **Compliant** | Stateless proxy; all work tied to incoming requests. |
| Scale work with demand | WebExtension | **Partially compliant** | Work scales with requests but serializes multi-record operations instead of bursting. `background.js:239-251,405-426,669-682` |
| Graceful sleep/wake behavior | Bridge daemon | **Not applicable** | TCP sockets re-bind transparently post-wake; bridge has no long-lived connections to external hosts. |
| Graceful sleep/wake behavior | WebExtension | **Partially compliant** | WS close event triggered on wake, reconnect starts. But 3s interval unmodified; no jitter to spread wakeup load. `background.js:55-74` |
| Avoid redundant computation | WebExtension | **Non-compliant** | Byte-by-byte base64 loop for attachments. Folder tree re-traversed on every `/stats`. `background.js:398-400,758-767` |

---

## Risk-Ranked Issue List

### CRITICAL

| # | Issue | Energy Impact | Code Location |
|---|---|---|---|
| C1 | Fixed 3s reconnect with no backoff or cap in extension | ~20 Thunderbird JS-host wakeups/min indefinitely when bridge not running | `background.js:10,68-74` |

### HIGH

| # | Issue | Energy Impact | Code Location |
|---|---|---|---|
| H1 | Serial `get()` + `getFull()` in `/messages/read-batch` | 2N sequential IPC round-trips; CPU + Thunderbird IPC held open N× longer than necessary | `background.js:239-251` |
| H2 | Serial `query()` loop in thread reconstruction | M sequential messenger queries; amplified by deep threads | `background.js:405-426` |
| H3 | Serial `update()` per message in `/bulk/tag` | N sequential messenger IPC calls; Thunderbird I/O stays active for duration of bulk | `background.js:669-682` |
| H4 | Serial `getRaw()` per message in `bulk/fetch` and `messages/fetch` | N sequential network-fetches; prevents parallel IMAP scheduling inside Thunderbird | `background.js:265-267,685-692` |

### MEDIUM

| # | Issue | Energy Impact | Code Location |
|---|---|---|---|
| M1 | Recursive serial `getFolderInfo()` in `/stats` and `flattenFolders` | O(folders) IPC calls per invocation; no cache; re-traverses entire tree every call | `background.js:525-565,740-756,758-767` |
| M2 | Byte-by-byte `String.fromCharCode` in attachment download | High CPU + GC pressure for attachments > 1 MB | `background.js:395-401` |
| M3 | No sleep/wake awareness | Minor: reconnect delay persists at 3s after wake; no jitter | `background.js:68-74`, `bridge.js` |

### LOW

| # | Issue | Energy Impact | Code Location |
|---|---|---|---|
| L1 | No upper bound on `pending` Map | Memory growth and timer count unbounded under adversarial load | `bridge.js:27,64-77` |
| L2 | CORS wildcard | Security concern only; no energy impact | `bridge.js:83-86` |
| L3 | ws clientTracking default | Negligible for single-client design | `bridge.js:31` |

---

## Prioritized Remediation Roadmap

### Quick Wins (Low Effort / High Impact)

#### QW-1: Add Exponential Backoff to Extension Reconnect
**Effort:** ~20 lines | **Impact:** Eliminates C1 entirely

Replace the fixed `RECONNECT_DELAY` with a capped exponential backoff:

```js
const RECONNECT_BASE_MS = 3000;
const RECONNECT_MAX_MS = 60000;
let reconnectDelay = RECONNECT_BASE_MS;

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
}

// Reset delay on successful connection:
ws.onopen = () => {
  reconnectDelay = RECONNECT_BASE_MS;  // add this line
  // ... existing onopen code ...
};
```

This reduces wakeup frequency from 20/min to: 1 at 3s, 1 at 6s, 1 at 12s, 1 at 24s, 1 at 48s, then 1/min indefinitely. Wakeup rate drops ~95% within 2 minutes of bridge absence.

**Optional jitter** to avoid thundering-herd if multiple extensions are open:
```js
const jitter = Math.random() * 1000;
reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS) + jitter;
```

#### QW-2: Parallelize `read-batch` with `Promise.all`
**Effort:** ~10 lines | **Impact:** Eliminates H1; reduces read-batch latency by N×

```js
if (path === "/messages/read-batch" && method === "POST") {
  const { messageIds } = body || {};
  const results = await Promise.all(
    messageIds.map(async (id) => {
      try {
        const [msg, full] = await Promise.all([
          messenger.messages.get(id),
          messenger.messages.getFull(id),
        ]);
        return { ...formatMessage(msg), parts: extractParts(full) };
      } catch (e) {
        return { id, error: e.message };
      }
    })
  );
  return results;
}
```

Note: `messenger.*` API is async-safe; parallel calls are safe for read operations.

#### QW-3: Parallelize Thread Reconstruction Queries
**Effort:** ~10 lines | **Impact:** Eliminates H2

```js
const ids = new Set([...refs, inReply, msgHdrId].filter(Boolean));
const results = await Promise.all(
  [...ids].map(async (hdrId) => {
    try {
      const r = await messenger.messages.query({ headerMessageId: hdrId });
      return r.messages || [];
    } catch { return []; }
  })
);
const seen = new Set();
const thread = results.flat().filter((m) => {
  if (seen.has(m.id)) return false;
  seen.add(m.id);
  return true;
}).map(formatMessage);
thread.sort((a, b) => new Date(a.date) - new Date(b.date));
return { thread, count: thread.length };
```

#### QW-4: Fix Attachment Base64 Encoding
**Effort:** 5 lines | **Impact:** Eliminates M2; large attachments become ~10× faster

```js
// Replace the byte-by-byte loop:
const buffer = await file.arrayBuffer();
const bytes = new Uint8Array(buffer);

// Chunked approach to avoid stack overflow for large files:
const CHUNK = 8192;
let binary = "";
for (let i = 0; i < bytes.length; i += CHUNK) {
  binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
}
const base64 = btoa(binary);
```

This avoids per-character string growth; chunked spread is V8-optimized and avoids GC pressure.

---

### Medium-Term Improvements

#### MT-1: Parallelize `bulk/tag` and `bulk/fetch` with Bounded Concurrency
**Effort:** ~30 lines | **Impact:** Reduces H3, H4

Sequential per-message updates are safe to parallelize. A concurrency limit (e.g., 8) prevents overwhelming the Thunderbird IPC channel:

```js
async function concurrentMap(items, fn, concurrency = 8) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    results.push(...await Promise.all(batch.map(fn)));
  }
  return results;
}
```

Apply to `bulk/tag`, `bulk/fetch`, `messages/fetch`, and `read-batch` (supersedes QW-2).

#### MT-2: Add TTL Cache for Folder Info in Stats
**Effort:** ~40 lines | **Impact:** Reduces M1 substantially for repeated `/stats` calls

Folder counts are relatively stable (changes only on mail arrival/deletion). A 30-second in-memory TTL cache on the extension side would eliminate repeat traversal:

```js
const folderInfoCache = new Map(); // folderId → { info, expiresAt }
const FOLDER_CACHE_TTL = 30_000;

async function getCachedFolderInfo(folder) {
  const now = Date.now();
  const cached = folderInfoCache.get(folder.id);
  if (cached && cached.expiresAt > now) return cached.info;
  const info = await messenger.folders.getFolderInfo(folder);
  folderInfoCache.set(folder.id, { info, expiresAt: now + FOLDER_CACHE_TTL });
  return info;
}
```

This is safe: the cache is per-extension-session, bounded in size by number of folders, and auto-expires. It does not violate the project's "no caching email data" principle because folder counts (unread/total) are metadata, not message content.

#### MT-3: Add Max Pending Requests Limit to Bridge
**Effort:** ~15 lines | **Impact:** Addresses L1; prevents runaway timer accumulation

```js
const MAX_PENDING = 50;  // configurable via env

// In forwardToExtension():
if (pending.size >= MAX_PENDING) {
  reject({ message: "Too many pending requests" });
  return;
}
```

#### MT-4: Reduce CORS Surface
**Effort:** ~5 lines | **Impact:** Minor security improvement

Since the bridge is localhost-only with an auth token, CORS headers could be restricted to `Origin: null` (loopback requests) or removed entirely if no browser-based clients are expected:

```js
// Replace wildcard with restrictive policy or only emit CORS headers if auth token is configured
res.setHeader("Access-Control-Allow-Origin", "null");
```

---

### Advanced / Optional Optimizations

#### AO-1: macOS Sleep/Wake Jitter in Reconnect
**Effort:** ~10 lines | **Impact:** Reduces post-wake wakeup burst

After macOS wake, all extension instances will attempt reconnect simultaneously. Add jitter:

```js
reconnectTimer = setTimeout(() => {
  reconnectTimer = null;
  connect();
}, reconnectDelay + Math.random() * 500);
```

This spreads reconnect attempts across a 500ms window if multiple Thunderbird windows/profiles have the extension loaded.

#### AO-2: Bridge Status Polling Cap in CLI / MCP
**Effort:** ~20 lines | **Impact:** Prevents tight CLI retry loops

If a CLI command fails with `EXTENSION_DISCONNECTED`, some agent patterns retry in a loop. The CLI could add a retry-with-backoff wrapper that stops after N attempts rather than being used in an unbounded loop by the calling agent. The CLI SKILL.md guidance already recommends against loops, but a hard cap in `client.js` would enforce it.

#### AO-3: WebSocket Ping/Pong Configuration
**Effort:** ~5 lines | **Impact:** Low; explicit is better than relying on ws defaults

The `ws` library does not send automatic pings unless configured with `pingInterval`. On macOS, the kernel's TCP keep-alive (default: 7200s) maintains the loopback connection. Explicitly configuring a longer application-level ping interval (e.g., 30s) would allow faster dead-connection detection without adding to wakeup count:

```js
const wss = new WebSocketServer({
  host: "127.0.0.1",
  port: WS_PORT,
  // Uncomment to enable application-level keep-alive:
  // clientTracking: true,
  // pingInterval: 30000,
  // pingTimeout: 5000,
});
```

For a localhost connection that virtually never goes stale without being noticed via close/error events, this is optional.

#### AO-4: Streaming / Chunked Transfer for Large Message Bodies
**Effort:** High | **Impact:** Medium for large-mailbox, attachment-heavy workflows

Currently, full message bodies are serialized to JSON and transferred as a single HTTP response. For messages with multi-MB bodies or base64-encoded attachments, the bridge receives the entire payload in one WebSocket message and writes it to one HTTP response. Streaming via HTTP chunked transfer encoding would allow clients to begin processing earlier and reduce peak memory usage in the bridge, but would require significant architectural changes to the WS framing layer and is an advanced optimization.

---

## Measurement and Validation Plan (macOS 25 MacBook Pro)

### Tools

| Tool | What It Measures | Use Case |
|---|---|---|
| **Instruments → Energy Log** | Process-level energy impact (CPU bursts, GPU, networking, I/O) over time | Baseline idle and load scenarios |
| **Instruments → Time Profiler** | CPU stack samples; identifies hot paths | Attachment encoding, stats traversal |
| **powermetrics** (`sudo powermetrics -n 5 -i 1000 --samplers cpu_power,gpu_power,network,disk`) | System-wide power, per-process wakeups/sec, CPU package power | Idle bridge comparison pre/post fix |
| **Activity Monitor → Energy** | App-level energy impact score; quick sanity check | Thunderbird energy score with/without bridge |
| **Node.js `--inspect` + `clinic.js flame`** | Node.js event loop utilization, async flame graph | Bridge under load |
| **Console.app / `log stream`** | Extension `console.log` output; reconnect frequency | Reconnect rate measurement |

### Metrics to Capture

| Metric | Idle Target | Under Load |
|---|---|---|
| Bridge CPU % (Activity Monitor) | < 0.1% | < 5% during request |
| Thunderbird CPU % (Activity Monitor) | < 0.5% with bridge present | < 10% during search/read |
| Wakeups/sec (powermetrics, Thunderbird process) | < 1/sec with bridge connected | < 5/sec during load |
| Timer count (Node.js `process._getActiveHandles()`) | 2 (HTTP + WS server) | 2 + N in-flight requests |
| Reconnect frequency (Console.app) | 0/min when connected | N/A |
| Bridge → extension round-trip latency (p95) | < 50ms | < 500ms for complex ops |
| Peak RSS (bridge, `ps aux`) | < 60 MB | < 80 MB |

### Reproducible Scenarios

**Scenario 1: Idle Baseline (No Bridge Running)**
1. Start Thunderbird with extension installed
2. Do NOT start `tb-bridge`
3. Wait 5 minutes
4. Capture: `sudo powermetrics -n 30 -i 10000 --samplers cpu_power` → record Thunderbird wakeups/sec
5. Open Console.app → filter `[tb-ai]` → count reconnect log entries per minute
6. Expected (current): ~20 `[tb-ai] WebSocket create failed` per minute
7. Expected (post-QW-1): ~1/min decreasing to 1/60s after ~1 min

**Scenario 2: Idle Baseline (Bridge Running, No Requests)**
1. Start `tb-bridge`
2. Start Thunderbird + extension
3. Wait 2 minutes for stable connection
4. Capture Activity Monitor → Energy tab → both `node` (bridge) and `Thunderbird` processes
5. Expected: Thunderbird energy impact "Low", bridge node process < 0.1% CPU, 0 reconnect entries in Console

**Scenario 3: Burst Search / Read**
1. Run `tb search inbox --limit 50 --fields id,subject,date`
2. Capture Instruments Energy Log during command
3. Follow with `tb read-batch <50 IDs>`
4. Compare pre/post QW-2: read-batch duration and CPU burst duration should drop ~50× for 50 messages

**Scenario 4: Large Mailbox Stats**
1. Run `tb stats` on account with > 30 folders
2. Capture Time Profiler during invocation
3. Identify `countFolder` and `getFolderInfo` in flame graph
4. Compare pre/post MT-2: re-run within 30s → second call should return cached data instantly

**Scenario 5: Extension Disconnect / Reconnect (Sleep/Wake Simulation)**
1. With bridge running and extension connected, run `killall -STOP tb-bridge` (SIGSTOP)
2. Monitor Console.app for disconnect and first reconnect attempt
3. Note delay (should be ~3s)
4. Run `killall -CONT tb-bridge`
5. Note reconnect delay (should be < 3s for first post-CONT attempt)
6. With QW-1 applied: verify first retry is 3s, second 6s, etc., then resets to 3s on successful reconnect

**Scenario 6: Attachment-Heavy Flow**
1. Send a test email with a 5 MB PDF attachment to self
2. Run `tb attachment <id> --part-name 1`
3. Capture Instruments → Time Profiler
4. Pre-QW-4: should see `String.fromCharCode` loop dominating the extension JS profile
5. Post-QW-4: should be dominated by `arrayBuffer()` (network I/O), not string ops

**Scenario 7: Large Bulk Operation**
1. Create a test folder with 100 messages
2. Run `tb bulk tag <folderId> --tag key --limit 100`
3. Capture total wall-clock time and bridge CPU during operation
4. Pre-MT-1: 100+ sequential round-trips, ~2-5s wall time
5. Post-MT-1 (concurrency=8): ~13 batches, ~300ms-1s wall time

---

## Assumptions, Uncertainties, and Confidence Levels

| Claim | Confidence | Basis | Uncertainty |
|---|---|---|---|
| Extension fires ~20 wakeups/min when bridge absent | **High** | Direct code: `RECONNECT_DELAY = 3000`, `setTimeout`, event-driven trigger on failure | Actual wakeup cost depends on macOS scheduler; wakeup count is deterministic but energy per wakeup is hardware-dependent |
| Bridge has near-zero idle cost | **High** | Bridge code: no setInterval, no background tasks, 2 TCP server sockets + event loop | ws library `clientTracking` has negligible overhead confirmed by DeepWiki and code analysis |
| `Promise.all` is safe for parallel messenger.* calls | **Medium-High** | Thunderbird's messenger.* APIs are async and designed for concurrent use; parallel reads are universally safe. Parallel writes (update, archive) may have ordering guarantees not documented in Thunderbird API docs | Official messenger.* concurrency docs are thin; recommend testing with `Promise.all` on update calls |
| Byte-by-byte base64 is a significant CPU cost for large attachments | **High** | V8 string concatenation behavior well-documented; 5M iteration loop on 5MB attachment is clearly measurable | Exact threshold where this matters depends on V8 version shipped with Thunderbird 128+ |
| Folder info cache is safe at 30s TTL | **Medium** | Folder counts change only on mail events (new mail, delete, move) | If a mail arrives during the 30s window, the cached count will be stale. This is a display-only concern and not a correctness issue for most workflows |
| ws library default ping behavior | **High** | ws@8.x source: `pingInterval` not enabled unless explicitly set; confirmed by DeepWiki and direct inspection of bridge instantiation | DeepWiki stated ping/pong "automatically handled" — this refers to responding to pings received from peers, not initiating them. Code is authoritative here. |
| macOS sleep/wake impact is LOW | **Medium** | The extension's reconnect is event-driven on close events; the bridge daemon's listen sockets survive sleep. Practically, post-wake behavior is correct | Not tested on physical macOS 25 hardware; behavior of `ws.readyState` and close events after macOS network interface reset during sleep is assumed to follow standard TCP behavior |

---

## Summary Score Card

| Area | Rating | Key Driver |
|---|---|---|
| Bridge daemon idle energy | ⭐⭐⭐⭐⭐ Excellent | Truly idle, no background wakeups |
| Bridge daemon under load | ⭐⭐⭐⭐ Good | Correct event-driven design; serial forwarding is acceptable |
| Extension reconnect strategy | ⭐⭐ Poor | Fixed 3s with no backoff — single highest-priority fix |
| Extension read path efficiency | ⭐⭐⭐ Fair | Correct behavior; serial awaits waste CPU and time |
| Extension write path efficiency | ⭐⭐⭐ Fair | Per-message loops; parallelizable |
| Attachment handling | ⭐⭐ Poor | Byte-loop base64; easy fix |
| Memory management | ⭐⭐⭐⭐ Good | Pending map cleaned up correctly; no leak in normal use |
| macOS platform integration | ⭐⭐ Poor | No sleep/wake awareness; no backoff |
| Overall | ⭐⭐⭐ Fair | Strong foundation; two targeted fixes eliminate most energy risk |

The most impactful change — implementing exponential backoff in the extension reconnect (QW-1) — is approximately 20 lines of code and eliminates the single highest-energy issue. Combined with parallel read-batch (QW-2) and the attachment encoding fix (QW-4), the majority of measurable energy waste can be addressed in under 60 lines of changes.
