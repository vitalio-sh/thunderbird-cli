#!/usr/bin/env node

/**
 * MCP server integration test
 *
 * Spawns a mock bridge + the MCP server, sends MCP JSON-RPC requests via stdio,
 * and verifies every tool returns correct results.
 */

import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID, randomUUID as uuid } from "crypto";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_SERVER = join(__dirname, "../mcp/src/server.js");
const PORT = 19800;
const WS_PORT = 19801;

let passed = 0,
  failed = 0;
const failures = [];

// ─── Mock bridge handler ───────────────────────────────────────────

function handle({ method, path, body }) {
  if (path === "/health") return { status: "ok", version: "2.0.0", thunderbird: true };
  if (path === "/accounts" && method === "GET")
    return [
      {
        id: "acct1",
        name: "Test",
        type: "imap",
        identities: [{ id: "id1", email: "t@t.com", name: "T" }],
        rootFolder: { id: "rf", name: "" },
      },
    ];
  if (path?.match(/^\/accounts\/[^/]+\/folders$/))
    return [
      {
        id: "f1",
        name: "Inbox",
        path: "/Inbox",
        type: "inbox",
        unreadMessageCount: 5,
        totalMessageCount: 50,
        depth: 0,
      },
    ];
  if (path === "/folders/info")
    return {
      id: body?.folderId,
      name: "Inbox",
      type: "inbox",
      unreadMessageCount: 5,
      totalMessageCount: 50,
    };
  if (path === "/messages/search")
    return {
      messages: [
        {
          id: 1,
          subject: "Test",
          author: "a@b.com",
          date: "2026-04-01",
          read: false,
          flagged: false,
          junk: false,
          size: 100,
          tags: [],
        },
      ],
      total: 1,
      offset: 0,
      hasMore: false,
    };
  if (path === "/messages/list")
    return {
      messages: [
        {
          id: 1,
          subject: "Test",
          author: "a@b.com",
          date: "2026-04-01",
          read: false,
          flagged: false,
          junk: false,
          size: 100,
          tags: [],
        },
      ],
      total: 1,
    };
  if (path?.match(/^\/messages\/\d+$/) && method === "GET")
    return {
      id: 1,
      subject: "Test",
      author: "a@b.com",
      date: "2026-04-01",
      parts: { text: "Hello world body text", html: "", attachments: [] },
    };
  if (path?.match(/\/raw$/)) return { raw: "From: a@b.com\nSubject: Test\n\nBody" };
  if (path?.match(/\/headers$/)) return { id: 1, subject: "Test", author: "a@b.com" };
  if (path?.match(/\/full$/))
    return { id: 1, subject: "Test", parts: { text: "Hello", html: "<p>Hi</p>", attachments: [] } };
  if (path?.match(/\/check-download$/))
    return { id: 1, downloadState: "full", size: 100, hasBody: true };
  if (path?.match(/\/thread$/)) return { thread: [{ id: 1, subject: "Test" }], count: 1 };
  if (path?.match(/\/attachments$/))
    return [{ name: "f.pdf", contentType: "application/pdf", partName: "1.2", size: 5000 }];
  if (path?.match(/\/attachment$/) && method === "POST")
    return { name: "f.pdf", size: 5000, contentType: "application/pdf", data: "SGVsbG8=" };
  if (path === "/messages/move") return { success: true, moved: (body?.messageIds || []).length };
  if (path === "/messages/delete") return { success: true, deleted: (body?.messageIds || []).length };
  if (path === "/messages/archive") return { success: true, archived: (body?.messageIds || []).length };
  if (path === "/messages/update") return { success: true };
  if (path === "/compose")
    return { success: true, action: body?.send ? "sent" : body?.open ? "draft_opened" : "draft_saved" };
  if (path === "/reply") return { success: true, action: body?.send ? "sent" : "draft_saved" };
  if (path === "/forward") return { success: true, action: body?.send ? "sent" : "draft_saved" };
  if (path === "/stats")
    return { totalAccounts: 1, totalUnread: 5, totalMessages: 100, accounts: [] };
  if (path === "/sync") return { success: true, synced: body?.all ? "all" : body?.folderId };
  return { error: `Not found: ${method} ${path}` };
}

// ─── Bridge servers ────────────────────────────────────────────────

async function startBridge() {
  return new Promise((resolve) => {
    const pending = new Map();
    let extSock = null;
    const wss = new WebSocketServer({ host: "127.0.0.1", port: WS_PORT });
    wss.on("connection", (ws) => {
      extSock = ws;
      ws.on("message", (d) => {
        const m = JSON.parse(d.toString());
        const p = pending.get(m.id);
        if (p) {
          pending.delete(m.id);
          clearTimeout(p.timer);
          p.resolve(m.result);
        }
      });
    });
    const httpServer = createServer(async (req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/bridge/status") {
        res.writeHead(200);
        res.end(JSON.stringify({ bridge: "running", extension: "connected" }));
        return;
      }
      let b = "";
      for await (const c of req) b += c;
      let pb = null;
      if (b.trim())
        try {
          pb = JSON.parse(b);
        } catch {}
      try {
        const result = await new Promise((resolve, reject) => {
          if (!extSock || extSock.readyState !== 1) {
            reject(new Error("no ext"));
            return;
          }
          const id = uuid();
          const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error("timeout"));
          }, 5000);
          pending.set(id, { resolve, reject, timer });
          extSock.send(JSON.stringify({ id, method: req.method, path: req.url, body: pb }));
        });
        res.writeHead(200);
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    httpServer.listen(PORT, "127.0.0.1", () => {
      const mock = new WebSocket(`ws://127.0.0.1:${WS_PORT}`);
      mock.on("open", () => resolve({ httpServer, wss, mock }));
      mock.on("message", (d) => {
        const r = JSON.parse(d.toString());
        mock.send(JSON.stringify({ id: r.id, result: handle(r) }));
      });
    });
  });
}

// ─── MCP client (over stdio) ───────────────────────────────────────

class McpClient {
  constructor(serverPath, env) {
    this.proc = spawn("node", [serverPath], {
      stdio: ["pipe", "pipe", "inherit"],
      env: { ...process.env, ...env },
    });
    this.buffer = "";
    this.pending = new Map();
    this.nextId = 1;
    this.proc.stdout.on("data", (chunk) => {
      this.buffer += chunk.toString();
      let idx;
      while ((idx = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined && this.pending.has(msg.id)) {
            const p = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            p.resolve(msg);
          }
        } catch {}
      }
    });
  }

  send(method, params) {
    const id = this.nextId++;
    const msg = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout: ${method}`));
      }, 10000);
      this.pending.set(id, {
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
      this.proc.stdin.write(JSON.stringify(msg) + "\n");
    });
  }

  notify(method, params) {
    this.proc.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n"
    );
  }

  async initialize() {
    await this.send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0" },
    });
    this.notify("notifications/initialized");
  }

  async listTools() {
    const r = await this.send("tools/list", {});
    return r.result?.tools || [];
  }

  async callTool(name, args) {
    const r = await this.send("tools/call", { name, arguments: args });
    if (r.result?.content?.[0]?.text) {
      try {
        return JSON.parse(r.result.content[0].text);
      } catch {
        return r.result.content[0].text;
      }
    }
    return r.result;
  }

  close() {
    this.proc.kill();
  }
}

// ─── Test runner ───────────────────────────────────────────────────

function test(name, result, check) {
  if (check(result)) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed++;
    failures.push({ name, result });
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    ${JSON.stringify(result).slice(0, 200)}`);
  }
}

const servers = await startBridge();
await new Promise((r) => setTimeout(r, 300));

const client = new McpClient(MCP_SERVER, {
  TB_BRIDGE_HOST: "127.0.0.1",
  TB_BRIDGE_PORT: String(PORT),
});

console.log("\n\x1b[1m=== thunderbird-cli MCP Server Tests ===\x1b[0m\n");

await client.initialize();

console.log("\x1b[1mProtocol\x1b[0m");
const toolList = await client.listTools();
test("tools/list returns 12 tools", toolList, (r) => Array.isArray(r) && r.length === 12);
test("each tool has name+description+inputSchema", toolList, (r) =>
  r.every((t) => t.name && t.description && t.inputSchema)
);

console.log("\n\x1b[1mTools (12)\x1b[0m");

test("email_stats", await client.callTool("email_stats", {}), (r) => r.totalAccounts === 1);
test(
  "email_stats with accountId",
  await client.callTool("email_stats", { accountId: "acct1" }),
  (r) => r.totalAccounts !== undefined
);
test(
  "email_stats includeFolders",
  await client.callTool("email_stats", { includeFolders: true }),
  (r) => r.totalAccounts !== undefined
);

test(
  "email_search basic",
  await client.callTool("email_search", { query: "test" }),
  (r) => r.messages?.length >= 0
);
test(
  "email_search with filters",
  await client.callTool("email_search", {
    query: "test",
    unread: true,
    since: "7d",
    limit: 5,
  }),
  (r) => r.messages !== undefined
);

test(
  "email_list",
  await client.callTool("email_list", { folderId: "f1" }),
  (r) => r.messages !== undefined
);
test(
  "email_list with sort",
  await client.callTool("email_list", { folderId: "f1", sort: "date", sortOrder: "desc" }),
  (r) => r.messages !== undefined
);

test(
  "email_read default",
  await client.callTool("email_read", { messageId: 1 }),
  (r) => r.id === 1 && r.parts
);
test(
  "email_read headers",
  await client.callTool("email_read", { messageId: 1, mode: "headers" }),
  (r) => r.id === 1
);
test(
  "email_read full",
  await client.callTool("email_read", { messageId: 1, mode: "full" }),
  (r) => r.parts?.html !== undefined
);
test(
  "email_read raw",
  await client.callTool("email_read", { messageId: 1, mode: "raw" }),
  (r) => r.raw
);
test(
  "email_read with maxBody",
  await client.callTool("email_read", { messageId: 1, maxBody: 5 }),
  (r) => r.parts?.textTruncated === true
);

test(
  "email_thread",
  await client.callTool("email_thread", { messageId: 1 }),
  (r) => r.thread !== undefined
);

test(
  "email_compose draft (default)",
  await client.callTool("email_compose", { to: "a@b.com", body: "Hi" }),
  (r) => r.success && r.action === "draft_saved"
);
test(
  "email_compose send",
  await client.callTool("email_compose", { to: "a@b.com", body: "Hi", mode: "send" }),
  (r) => r.action === "sent"
);
test(
  "email_compose open",
  await client.callTool("email_compose", { to: "a@b.com", body: "Hi", mode: "open" }),
  (r) => r.action === "draft_opened"
);

test(
  "email_reply",
  await client.callTool("email_reply", { messageId: 1, body: "Thanks" }),
  (r) => r.success
);
test(
  "email_reply --send",
  await client.callTool("email_reply", { messageId: 1, body: "Thanks", mode: "send" }),
  (r) => r.action === "sent"
);

test(
  "email_forward",
  await client.callTool("email_forward", { messageId: 1, to: "c@d.com", body: "FYI" }),
  (r) => r.success
);

test(
  "email_mark read",
  await client.callTool("email_mark", { messageIds: [1], read: true }),
  (r) => r.success
);
test(
  "email_mark batch flagged",
  await client.callTool("email_mark", { messageIds: [1, 2, 3], flagged: true }),
  (r) => r.updated === 3
);

test(
  "email_archive operation=archive",
  await client.callTool("email_archive", { messageIds: [1], operation: "archive" }),
  (r) => r.success
);
test(
  "email_archive operation=move",
  await client.callTool("email_archive", {
    messageIds: [1],
    operation: "move",
    destinationFolderId: "f2",
  }),
  (r) => r.success
);
test(
  "email_archive operation=delete",
  await client.callTool("email_archive", { messageIds: [1], operation: "delete" }),
  (r) => r.success
);
test(
  "email_archive permanent delete without confirm",
  await client.callTool("email_archive", {
    messageIds: [1],
    operation: "delete",
    permanent: true,
  }),
  (r) => r.error?.includes("confirm")
);

test(
  "email_attachments list",
  await client.callTool("email_attachments", { messageId: 1, operation: "list" }),
  (r) => Array.isArray(r) && r.length > 0
);
test(
  "email_attachments download",
  await client.callTool("email_attachments", {
    messageId: 1,
    operation: "download",
    partName: "1.2",
  }),
  (r) => r.data
);

test(
  "email_folders list",
  await client.callTool("email_folders", { operation: "list", accountId: "acct1" }),
  (r) => Array.isArray(r)
);
test(
  "email_folders all",
  await client.callTool("email_folders", { operation: "all" }),
  (r) => Array.isArray(r)
);
test(
  "email_folders info",
  await client.callTool("email_folders", { operation: "info", folderId: "f1" }),
  (r) => r.name
);
test(
  "email_folders sync",
  await client.callTool("email_folders", { operation: "sync" }),
  (r) => r.success
);

console.log("\n\x1b[1mError handling\x1b[0m");
const unknownTool = await client.callTool("nonexistent_tool", {});
test("unknown tool returns error", unknownTool, (r) => r.error?.includes("Unknown tool"));

// Summary
console.log(`\n\x1b[1m${"─".repeat(40)}\x1b[0m`);
console.log(
  `\x1b[1m${passed} passed, ${failed} failed, ${passed + failed} total\x1b[0m\n`
);
if (failures.length > 0) {
  console.log("\x1b[31mFailures:\x1b[0m");
  for (const f of failures) {
    console.log(`  ${f.name}: ${JSON.stringify(f.result).slice(0, 200)}`);
  }
}

client.close();
servers.mock.close();
servers.wss.close();
servers.httpServer.close();
process.exit(failed > 0 ? 1 : 0);
