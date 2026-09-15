#!/usr/bin/env node
/**
 * Extension background-script tests.
 *
 * Loads the real extension/src/thread-utils.js + background.js (in manifest order) into a vm
 * with a mocked `messenger` API, WebSocket and timers, then drives handleRequest() and the
 * reconnect logic directly. Complements test/quick-test.mjs, which mocks the extension away.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { randomBytes } from "crypto";
import vm from "vm";

const EXT = join(dirname(fileURLToPath(import.meta.url)), "..", "extension");
const manifest = JSON.parse(readFileSync(join(EXT, "manifest.json"), "utf-8"));

let passed = 0, failed = 0;
function test(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`); }
}

// ─── Mock environment ───────────────────────────────────────────────

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.sent = [];
    MockWebSocket.instances.push(this);
  }
  send(data) { this.sent.push(JSON.parse(data)); }
  // test helpers
  open() { this.readyState = MockWebSocket.OPEN; this.onopen?.(); }
  fail() { this.readyState = MockWebSocket.CLOSED; this.onerror?.(new Error("refused")); this.onclose?.(); }
}

const timers = [];
const idleListeners = [];
const date = (s) => new Date(s);
const folder = (accountId) => ({ accountId, path: "/INBOX", name: "Inbox" });

function header(id, extra = {}) {
  return {
    id, subject: `Message ${id}`, author: "a@example.org", date: date("2026-01-01T00:00:00Z"),
    read: false, flagged: false, junk: false, size: 10, tags: [], folder: folder("acct1"),
    headerMessageId: `m${id}@example.org`, ...extra,
  };
}

const calls = { query: [], getRaw: [], update: [] };
let inFlight = 0, maxInFlight = 0;
const track = async (fn) => {
  inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
  await new Promise((r) => setImmediate(r));
  try { return await fn(); } finally { inFlight--; }
};

const store = new Map();
const pages = new Map();
const PAGE_SIZE = 7;
function pageOf(all, start) {
  const messages = all.slice(start, start + PAGE_SIZE);
  if (start + PAGE_SIZE >= all.length) return { messages };
  const id = `page-${start + PAGE_SIZE}`;
  pages.set(id, async () => pageOf(all, start + PAGE_SIZE));
  return { id, messages };
}
const queryHandlers = [];

const messenger = {
  runtime: { getManifest: () => manifest },
  idle: { onStateChanged: { addListener: (fn) => idleListeners.push(fn) } },
  folders: { get: async (id) => ({ id, accountId: "acct1" }) },
  messages: {
    get: (id) => track(async () => {
      if (!store.has(id)) throw new Error(`Message ${id} not found`);
      return store.get(id).header;
    }),
    getFull: (id) => track(async () => {
      if (!store.has(id)) throw new Error(`Message ${id} not found`);
      return store.get(id).full || { contentType: "text/plain", body: `body ${id}`, headers: {} };
    }),
    getRaw: (id) => track(async () => {
      calls.getRaw.push(id);
      const raw = store.get(id)?.raw;
      if (raw === undefined) throw new Error("no raw");
      return raw;
    }),
    query: async (q) => {
      calls.query.push(q);
      for (const h of queryHandlers) {
        const r = h(q);
        if (r) return r;
      }
      return { messages: [] };
    },
    // Paginated like Thunderbird (small pages to exercise continueList)
    list: async () => pageOf([...store.values()].map((s) => s.header), 0),
    continueList: async (id) => pages.get(id)?.() ?? null,
    update: (id, props) => track(async () => { calls.update.push({ id, props }); }),
    getAttachmentFile: async () => {
      const bytes = randomBytes(100_000);
      attachmentBytes = bytes;
      return { name: "big.bin", size: bytes.length, type: "application/octet-stream", arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) };
    },
  },
};
let attachmentBytes = null;

const ctx = vm.createContext({
  console: { log() {}, error() {} },
  WebSocket: MockWebSocket,
  messenger,
  btoa,
  setTimeout: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
  clearTimeout: (t) => { if (t) t.cleared = true; },
});
for (const script of manifest.background.scripts) {
  const file = join(EXT, script);
  vm.runInContext(readFileSync(file, "utf-8"), ctx, { filename: file });
}
const handle = (method, path, body) => ctx.handleRequest({ method, path, body });
const pendingTimers = () => timers.filter((t) => !t.cleared && !t.fired);
const fireTimer = () => { const t = pendingTimers()[0]; t.fired = true; t.fn(); return t.ms; };
const lastSocket = () => MockWebSocket.instances.at(-1);

console.log("\n\x1b[1m=== extension background tests ===\x1b[0m");

// ─── Manifest ───────────────────────────────────────────────────────

console.log("\n\x1b[1mManifest\x1b[0m");
test("thread-utils.js loads before background.js",
  manifest.background.scripts.indexOf("src/thread-utils.js") < manifest.background.scripts.indexOf("src/background.js"));
test("idle permission declared for wake-up reconnect", manifest.permissions.includes("idle"));

// ─── Reconnect ──────────────────────────────────────────────────────

console.log("\n\x1b[1mReconnect\x1b[0m");
test("connects on load", MockWebSocket.instances.length === 1 && lastSocket().url === "ws://127.0.0.1:7701");
const delays = [];
for (let i = 0; i < 6; i++) {
  lastSocket().fail();
  test(`failure ${i + 1} schedules exactly one retry`, pendingTimers().length === 1, `pending=${pendingTimers().length}`);
  delays.push(fireTimer());
}
test("backoff is 3s → 6s → 12s → capped at 15s", JSON.stringify(delays) === JSON.stringify([3000, 6000, 12000, 15000, 15000, 15000]), JSON.stringify(delays));

lastSocket().open();
lastSocket().fail();
test("successful connection resets backoff to 3s", pendingTimers()[0]?.ms === 3000, `got ${pendingTimers()[0]?.ms}`);
fireTimer();
lastSocket().fail();
fireTimer();
lastSocket().fail();
const beforeIdle = MockWebSocket.instances.length;
idleListeners.forEach((fn) => fn("idle"));
test("idle state does not reconnect", MockWebSocket.instances.length === beforeIdle);
idleListeners.forEach((fn) => fn("active"));
test("returning to active reconnects immediately", MockWebSocket.instances.length === beforeIdle + 1);
test("pending backoff timer is cancelled on wake", pendingTimers().length === 0);

const current = lastSocket();
current.open();
const stale = new MockWebSocket("stale");
stale.onclose = null;
idleListeners.forEach((fn) => fn("active"));
test("active while connected does not open a second socket", lastSocket() === stale);
current.onmessage({ data: JSON.stringify({ id: "r1", method: "GET", path: "/health" }) });
await new Promise((r) => setImmediate(r));
test("requests are answered on the socket they arrived on", current.sent[0]?.id === "r1" && current.sent[0]?.result?.status === "ok");
test("health reports the manifest version", current.sent[0]?.result?.version === manifest.version);

// ─── Thread ─────────────────────────────────────────────────────────

console.log("\n\x1b[1mThread\x1b[0m");
store.clear();
store.set(1, { header: header(1, { subject: "Budget", date: date("2026-01-01T00:00:00Z"), headerMessageId: "root@example.org" }) });
store.set(2, { header: header(2, { subject: "Re: Budget", date: date("2026-01-02T00:00:00Z"), headerMessageId: "mid@example.org" }) });
store.set(3, {
  header: header(3, { subject: "Re: [fin] Budget", date: date("2026-01-03T00:00:00Z"), headerMessageId: "leaf@example.org" }),
  raw: "Message-ID: <leaf@example.org>\r\nReferences: <root@example.org>\r\n <mid@example.org>\r\nIn-Reply-To: <mid@example.org>\r\nSubject: Re: [fin] Budget\r\n\r\nbody",
});
store.set(4, { header: header(4, { subject: "AW: Budget", date: date("2026-01-04T00:00:00Z"), headerMessageId: "late@example.org" }) });
store.set(5, { header: header(5, { subject: "Budget review Q3", date: date("2026-01-05T00:00:00Z"), headerMessageId: "other@example.org" }) });
const byHdrId = new Map([...store.values()].map((s) => [s.header.headerMessageId, s.header]));
queryHandlers.length = 0;
queryHandlers.push((q) => q.headerMessageId && { messages: byHdrId.has(q.headerMessageId) ? [byHdrId.get(q.headerMessageId)] : [] });
queryHandlers.push((q) => q.subject && { messages: [...store.values()].map((s) => s.header).filter((h) => h.subject.includes(q.subject)) });

calls.query.length = 0;
const t = await handle("GET", "/messages/3/thread");
const ids = t.thread.map((m) => m.id);
test("header ids are queried without angle brackets", calls.query.filter((q) => q.headerMessageId).every((q) => !/[<>]/.test(q.headerMessageId)));
test("upstream messages found via folded References", ids.includes(1) && ids.includes(2));
test("downstream reply found by exact normalized subject", ids.includes(4));
test("substring subject match is excluded", !ids.includes(5));
test("thread sorted by date", JSON.stringify(ids) === JSON.stringify([1, 2, 3, 4]), JSON.stringify(ids));
test("count matches", t.count === 4);
test("matches labelled by source",
  t.thread.find((m) => m.id === 2)?.threadMatch === "references" && t.thread.find((m) => m.id === 4)?.threadMatch === "subject");
test("subject search excludes junk", calls.query.some((q) => q.subject === "Budget" && q.junk === false));

// getRaw unavailable → getFull headers, still bracket-stripped
store.set(6, {
  header: header(6, { subject: "Re: Budget", headerMessageId: "six@example.org" }),
  full: { headers: { references: ["<root@example.org> <mid@example.org>"], "in-reply-to": ["<mid@example.org>"], "message-id": ["<six@example.org>"] } },
});
const t6 = await handle("GET", "/messages/6/thread");
test("falls back to getFull headers when getRaw fails", t6.thread.some((m) => m.id === 1 && m.threadMatch === "references"));

let missingErr = null;
try { await handle("GET", "/messages/999/thread"); } catch (e) { missingErr = e; }
test("unknown message still reports an error", missingErr?.message.includes("not found"));

// ─── Recent ─────────────────────────────────────────────────────────

console.log("\n\x1b[1mRecent\x1b[0m");
queryHandlers.length = 0;
queryHandlers.push((q) => q.fromDate && {
  messages: [
    header(10, { folder: folder("acct1"), read: false }),
    header(11, { folder: folder("acct2"), read: false }),
    header(12, { folder: folder("acct1"), read: true }),
  ],
});
const all = await handle("POST", "/recent", { hours: 24, limit: 50 });
test("no filters returns every account", all.messages.length === 3);
const acct = await handle("POST", "/recent", { hours: 24, limit: 50, accountId: "acct2" });
test("--account filters by account", acct.messages.length === 1 && acct.messages[0].id === 11);
const unread = await handle("POST", "/recent", { hours: 24, limit: 50, unreadOnly: true });
test("--unread filters read messages", unread.messages.length === 2 && unread.messages.every((m) => !m.read));

// ─── Search ─────────────────────────────────────────────────────────

console.log("\n\x1b[1mSearch\x1b[0m");
calls.query.length = 0;
await handle("POST", "/messages/search", { headerMessageId: "<abc@host>" });
test("headerMessageId forwarded to query without brackets", calls.query[0]?.headerMessageId === "abc@host");
test("junk still excluded by default", calls.query[0]?.junk === false);

calls.query.length = 0;
const ft = await handle("POST", "/messages/search", { query: "invoice" });
test("text query uses the fullText index by default", calls.query[0]?.fullText === "invoice" && calls.query[0]?.body === undefined && ft.searchMode === "fulltext");
calls.query.length = 0;
const bodyScan = await handle("POST", "/messages/search", { query: "invoice", searchMode: "body" });
test("searchMode body scans bodies", calls.query[0]?.body === "invoice" && calls.query[0]?.fullText === undefined && bodyScan.searchMode === "body");
calls.query.length = 0;
queryHandlers.unshift((q) => { if (q.fullText) throw new Error("fullText unsupported"); });
const fallback = await handle("POST", "/messages/search", { query: "invoice" });
queryHandlers.shift();
test("falls back to a body scan when fullText is unsupported", calls.query.at(-1)?.body === "invoice" && fallback.searchMode === "body");
const filtersOnly = await handle("POST", "/messages/search", { subject: "x" });
test("filter-only search reports no searchMode", filtersOnly.searchMode === undefined);

// ─── Read batch / bulk ──────────────────────────────────────────────

console.log("\n\x1b[1mBatch and bulk\x1b[0m");
store.clear();
for (let i = 1; i <= 40; i++) store.set(i, { header: header(i, { tags: i % 2 ? ["$label1"] : [] }), raw: "x" });
const batchIds = [...Array(40).keys()].map((i) => i + 1).reverse();
maxInFlight = 0;
await handle("POST", "/messages/read-batch", { messageIds: batchIds });
// 8 operations × (get + getFull)
test(`in-flight messenger calls bounded (max ${maxInFlight} ≤ 16)`, maxInFlight > 2 && maxInFlight <= 16);

batchIds.splice(5, 0, 404);
const batch = await handle("POST", "/messages/read-batch", { messageIds: batchIds });
test("read-batch preserves request order", JSON.stringify(batch.map((m) => m.id)) === JSON.stringify(batchIds));
test("read-batch reports per-message errors", batch[5].error?.includes("not found") && batch[6].parts?.text === "body 35");
test("read-batch with no ids returns []", JSON.stringify(await handle("POST", "/messages/read-batch", {})) === "[]");

calls.update.length = 0;
const tagged = await handle("POST", "/bulk/tag", { folderId: "f1", tagKey: "$label1", limit: 100 });
test("bulk tag only touches untagged messages", tagged.tagged === 20 && calls.update.length === 20);
test("bulk tag appends to existing tags", calls.update.every((u) => u.props.tags.at(-1) === "$label1"));

calls.getRaw.length = 0;
store.get(7).raw = undefined;
const fetched = await handle("POST", "/bulk/fetch", { folderId: "f1", limit: 100 });
test("bulk fetch counts successes", fetched.fetched === 39 && fetched.total === 40);

// ─── List sorting (#24, #15) ────────────────────────────────────────

console.log("\n\x1b[1mList sorting\x1b[0m");
store.clear();
// Database order is oldest → newest, so the newest messages sit on the last page.
for (let i = 1; i <= 30; i++) {
  store.set(i, { header: header(i, { date: new Date(Date.UTC(2026, 0, i)), read: i % 3 === 0, subject: `S${String(i).padStart(2, "0")}` }) });
}
const newest = await handle("POST", "/messages/list", { folderId: "f1", limit: 3, sort: "date", sortOrder: "desc" });
test("sort=date desc returns the true newest messages across pages", JSON.stringify(newest.messages.map((m) => m.id)) === "[30,29,28]", JSON.stringify(newest.messages.map((m) => m.id)));
test("sorted page reports hasMore", newest.hasMore === true && newest.total === 3);
const next = await handle("POST", "/messages/list", { folderId: "f1", limit: 3, offset: 3, sort: "date", sortOrder: "desc" });
test("offset applies after sorting", JSON.stringify(next.messages.map((m) => m.id)) === "[27,26,25]", JSON.stringify(next.messages.map((m) => m.id)));
const oldest = await handle("POST", "/messages/list", { folderId: "f1", limit: 2, sort: "date", sortOrder: "asc" });
test("sort=date asc returns the oldest", JSON.stringify(oldest.messages.map((m) => m.id)) === "[1,2]");
const unreadNewest = await handle("POST", "/messages/list", { folderId: "f1", limit: 2, sort: "date", sortOrder: "desc", unreadOnly: true });
test("filters apply before sorting", JSON.stringify(unreadNewest.messages.map((m) => m.id)) === "[29,28]", JSON.stringify(unreadNewest.messages.map((m) => m.id)));
const lastPage = await handle("POST", "/messages/list", { folderId: "f1", limit: 5, offset: 28, sort: "subject", sortOrder: "asc" });
test("last sorted page has hasMore=false", lastPage.messages.length === 2 && lastPage.hasMore === false);
const unsorted = await handle("POST", "/messages/list", { folderId: "f1", limit: 3 });
test("without sort, listing keeps database order and paging", JSON.stringify(unsorted.messages.map((m) => m.id)) === "[1,2,3]" && unsorted.hasMore === true);

// ─── Attachment ─────────────────────────────────────────────────────

console.log("\n\x1b[1mAttachment\x1b[0m");
const att = await handle("POST", "/messages/1/attachment", { partName: "1.2" });
test("chunked base64 matches Node's encoder (100 KB, multi-chunk)", att.data === attachmentBytes.toString("base64"));

console.log(`\n\x1b[1m${"─".repeat(40)}\x1b[0m`);
console.log(`\x1b[1m${passed} passed, ${failed} failed, ${passed + failed} total\x1b[0m\n`);
process.exit(failed > 0 ? 1 : 0);
