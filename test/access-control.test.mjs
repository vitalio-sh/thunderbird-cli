// Synthetic mail only: exercise the real router, never the installed bridge.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import WebSocket from "ws";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = name => fs.readFileSync(root + "extension/src/" + name, "utf8");
const manifest = JSON.parse(fs.readFileSync(root + "extension/manifest.json"));
let passed = 0;
async function test(name, fn) {
  await fn();
  console.log("PASS:", name);
  passed++;
}
function context(config = {}) {
  let nativeCalls = 0;
  const native = new Proxy(() => { nativeCalls++; throw Error("NATIVE_API_REACHED"); }, {
    get: () => native,
  });
  const ctx = vm.createContext({
    TB_ACCESS_CONFIG: config, messenger: native, WebSocket: class {},
    console: { log() {} }, setTimeout() {}, clearTimeout() {},
  });
  vm.runInContext(source("access-control.js"), ctx);
  vm.runInContext(source("thread-utils.js"), ctx);
  // Avoid registering the idle listener on the synthetic proxy.
  ctx.messenger = { messages: native, compose: native, folders: native, contacts: native,
    accounts: native, addressBooks: native, runtime: native };
  vm.runInContext(source("background.js"), ctx);
  ctx.nativeCalls = () => nativeCalls;
  return ctx;
}
const writes = [
  ["/messages/1/attachment", "downloadAttachments", { partName: "1.2" }],
  ["/compose", "compose", { open: true }], ["/reply", "compose", { messageId: 1, open: true }],
  ["/forward", "compose", { messageId: 1, open: true }],
  ["/messages/move", "move", {}], ["/messages/copy", "copy", {}],
  ["/messages/archive", "archive", {}], ["/messages/update", "mark", { read: true }],
  ["/messages/update", "mark", { flagged: false }], ["/messages/update", "mark", { junk: true }],
  ["/messages/update", "tag", { tags: [] }], ["/bulk/tag", "tag", {}],
  ["/tags/create", "tagCreate", {}], ["/folders/create", "folderCreate", {}],
  ["/folders/rename", "folderRename", {}],
];
await test("config validates keys, booleans and the send dependency", () => {
  for (const config of [null, [], false, { read: false }, { send: "false" }, { typo: true },
    { compose: false, send: true }, { delete: true }, { folderDelete: true }, JSON.parse('{"__proto__":true}')]) {
    assert.throws(() => context(config), /INVALID_ARGS/);
  }
  assert.throws(() => context(undefined).normalizeAccessPolicy(undefined), /INVALID_ARGS/);
});
await test("default policy keeps reads and drafts; source manifest matches it", async () => {
  const ctx = context();
  const state = await ctx.handleRequest({ method: "GET", path: "/access" });
  assert.equal(state.read, true);
  assert.equal(state.policy.compose, true);
  assert.equal(state.policy.downloadAttachments, true);
  assert(Object.entries(state.policy).every(([k, v]) => ["compose", "downloadAttachments"].includes(k) || v === false));
  assert(Object.isFrozen(state.policy));
  assert.deepEqual([...ctx.accessPermissions(state.policy)].sort(), [...manifest.permissions].sort());
});
const readGet = ["/health", "/access", "/accounts", "/accounts/a", "/accounts/a/folders",
  "/identities", "/stats", "/tags", "/contacts", "/contacts/c", "/messages/1",
  ...["raw", "headers", "full", "check-download", "download-status", "attachments", "thread"].map(s => "/messages/1/" + s)];
const readPost = ["/folders/info", "/messages/search", "/messages/list", "/messages/read-batch",
  "/messages/fetch", "/stats", "/recent", "/contacts/search", "/sync/status", "/bulk/fetch"];
await test("every read/search route stays allowed with every configurable right disabled", () => {
  const ctx = context({ compose: false, downloadAttachments: false });
  for (const path of readGet) ctx.authorizeRequest("GET", path);
  for (const path of readPost) ctx.authorizeRequest("POST", path, {});
});
for (const [path, key, body] of writes) {
  await test(`${path} requires ${key} before touching Thunderbird`, async () => {
    const ctx = context({ compose: false, downloadAttachments: false });
    await assert.rejects(ctx.handleRequest({ method: "POST", path, body }), /FORBIDDEN/);
    assert.equal(ctx.nativeCalls(), 0);
    context({ compose: false, downloadAttachments: false, [key]: true }).authorizeRequest("POST", path, body);
  });
}
await test("send blocked before opening a window for compose, reply and forward", async () => {
  for (const path of ["/compose", "/reply", "/forward"]) {
    const ctx = context();
    await assert.rejects(ctx.handleRequest({ method: "POST", path, body: { send: true } }), /FORBIDDEN.*send/);
    assert.equal(ctx.nativeCalls(), 0);
    context({ send: true }).authorizeRequest("POST", path, { send: true });
    await assert.rejects(ctx.handleRequest({ method: "POST", path, body: { send: "false" } }), /INVALID_ARGS/);
  }
});
await test("mixed flag/tag update requires both rights, with no partial mutation", async () => {
  for (const config of [{ tag: true }, { mark: true }]) {
    const ctx = context(config);
    await assert.rejects(ctx.handleRequest({ method: "POST", path: "/messages/update", body: { tags: [], read: true } }), /FORBIDDEN/);
    assert.equal(ctx.nativeCalls(), 0);
  }
  context({ tag: true, mark: true }).authorizeRequest("POST", "/messages/update", { tags: [], read: true });
});
await test("unknown paths and wrong methods fail closed; sync stays explicitly unsupported", async () => {
  const ctx = context();
  for (const [method, path] of [["GET", "/messages/delete"], ["POST", "/messages/new-write"], ["DELETE", "/messages/1"], ["POST", "/health"]]) {
    await assert.rejects(ctx.handleRequest({ method, path }), /FORBIDDEN/);
  }
  await assert.rejects(ctx.handleRequest({ method: "POST", path: "/sync" }), /Manual sync required/);
  assert.equal(ctx.nativeCalls(), 0);
});
await test("deletion is absent even with every supported right enabled", async () => {
  const defaults = vm.runInContext("ACCESS_POLICY", context());
  const all = Object.fromEntries(Object.keys(defaults).map(key => [key, true]));
  const ctx = context(all);
  for (const path of ["/messages/delete", "/bulk/delete", "/folders/delete", "/folders/emptyTrash", "/emptyTrash"]) {
    for (const method of ["POST", "DELETE"]) {
      await assert.rejects(ctx.handleRequest({ method, path, body: {
        messageIds: [1], folderId: "trash", permanent: true, confirm: true,
      } }), /FORBIDDEN/);
    }
  }
  assert.equal(ctx.nativeCalls(), 0);
  assert(!ctx.accessPermissions(all).includes("messagesDelete"));
  assert.doesNotMatch(source("background.js"), /messenger\.(?:messages|folders)\.(?:delete|emptyTrash|deleteAttachments)\s*\(/);
});
await test("moving into and restoring from Trash use only the move API", async () => {
  const ctx = context({ move: true });
  const calls = [];
  ctx.messenger.folders = { get: async id => ({ id }) };
  ctx.messenger.messages = { move: async (ids, folder) => calls.push({ ids, folder }) };
  for (const destinationFolderId of ["trash", "inbox"]) {
    const result = await ctx.handleRequest({ method: "POST", path: "/messages/move", body: { messageIds: [1], destinationFolderId } });
    assert.equal(result.moved, 1);
  }
  assert.equal(calls[0].folder.id, "trash"); assert.equal(calls[1].folder.id, "inbox");
});
await test("read and draft requests actually reach their real handlers", async () => {
  const ctx = context();
  for (const [method, path, body] of [["GET", "/messages/1"], ["POST", "/messages/1/attachment", { partName: "1.2" }],
    ["POST", "/messages/search", { query: "test" }], ["POST", "/compose", { open: true }]]) {
    await assert.rejects(ctx.handleRequest({ method, path, body }), /NATIVE_API_REACHED/);
  }
  assert.equal(ctx.nativeCalls(), 4);
});
await test("per-right builds embed policy and derive native permissions without editing source", () => {
  const dir = fs.mkdtempSync(root + ".access-test-");
  try {
    fs.cpSync(root + "extension", dir + "/extension", { recursive: true });
    fs.mkdirSync(dir + "/scripts");
    fs.copyFileSync(root + "scripts/build-xpi.mjs", dir + "/scripts/build-xpi.mjs");
    const ctx = context();
    const defaults = vm.runInContext("ACCESS_POLICY", ctx);
    const configs = [{}, { compose: false }, ...Object.keys(defaults).map(key => ({ [key]: true }))];
    for (const config of configs) {
      fs.writeFileSync(dir + "/access.json", JSON.stringify(config));
      const r = spawnSync(process.execPath, [dir + "/scripts/build-xpi.mjs", "--access-config", dir + "/access.json"], { encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      const zip = new AdmZip(dir + `/dist/thunderbird-cli-${manifest.version}.xpi`);
      const builtCtx = vm.createContext({});
      vm.runInContext(zip.readAsText("src/access-config.js"), builtCtx);
      vm.runInContext(zip.readAsText("src/access-control.js"), builtCtx);
      const expected = ctx.normalizeAccessPolicy(config);
      assert.equal(JSON.stringify(builtCtx.TB_ACCESS_CONFIG), JSON.stringify(expected));
      const permissions = JSON.parse(zip.readAsText("manifest.json")).permissions;
      assert.deepEqual(permissions, [...ctx.accessPermissions(expected)]);
      assert.equal(permissions.includes("compose.send"), expected.send);
      assert.equal(permissions.includes("messagesDelete"), false);
    }
    fs.writeFileSync(dir + "/access.json", '{"read":false}');
    const r = spawnSync(process.execPath, [dir + "/scripts/build-xpi.mjs", "--access-config", dir + "/access.json"], { encoding: "utf8" });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /unknown access setting/);
    assert.equal(fs.readFileSync(dir + "/extension/src/access-config.js", "utf8"), source("access-config.js"));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
await test("real bridge, CLI and MCP handlers preserve add-on denial and access discovery", async () => {
  const sockets = [];
  let bridge, peer;
  const savedEnv = { ...process.env };
  const child = async args => {
    const p = spawn(process.execPath, args, { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    p.stdout.on("data", b => { stdout += b; });
    p.stderr.on("data", b => { stderr += b; });
    const [code] = await once(p, "exit");
    return { code, stdout, stderr };
  };
  try {
    // Reserve both ports together so they cannot accidentally be the same.
    for (let i = 0; i < 2; i++) {
      const server = createServer();
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      sockets.push(server);
    }
    const [httpPort, wsPort] = sockets.map(s => s.address().port);
    for (const s of sockets) await new Promise(resolve => s.close(resolve));
    process.env.TB_BRIDGE_HOST = "127.0.0.1";
    process.env.TB_BRIDGE_PORT = String(httpPort);
    process.env.TB_AUTH_TOKEN = "synthetic-access-test-token";
    bridge = spawn(process.execPath, ["bridge/bridge.js", "--port", String(httpPort), "--ws-port", String(wsPort)], {
      cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolve, reject) => {
      let log = "";
      const timer = setTimeout(() => reject(Error("Test bridge did not start: " + log)), 5000);
      const onData = b => {
        log += b;
        if (log.includes("Waiting for Thunderbird extension")) { clearTimeout(timer); resolve(); }
      };
      bridge.stdout.on("data", onData); bridge.stderr.on("data", onData);
      bridge.once("exit", code => { clearTimeout(timer); reject(Error(`Test bridge exited ${code}: ${log}`)); });
    });
    const ctx = context({ downloadAttachments: false });
    // Run the real add-on socket handler, redirected to our isolated test bridge.
    ctx.WebSocket = class extends WebSocket {
      constructor() { super(`ws://127.0.0.1:${wsPort}/?token=${process.env.TB_AUTH_TOKEN}`); peer = this; }
    };
    vm.runInContext("ws = null; connect()", ctx);
    await once(peer, "open");
    const result = await child(["cli/src/cli.js", "access"]);
    assert.equal(result.code, 0, result.stderr);
    const state = JSON.parse(result.stdout).data;
    assert.equal(state.read, true); assert.equal(state.policy.send, false);
    assert.equal(state.policy.downloadAttachments, false);
    const denied = await child(["cli/src/cli.js", "compose", "--to", "test@example.invalid", "--body", "Test", "--send"]);
    assert.notEqual(denied.code, 0);
    assert.match(denied.stdout + denied.stderr, /FORBIDDEN/);
    for (const args of [["delete", "1", "--permanent", "--confirm"], ["folder-delete", "trash", "--confirm"], ["bulk", "delete", "trash", "--confirm"]]) {
      const removed = await child(["cli/src/cli.js", ...args]);
      assert.notEqual(removed.code, 0);
      assert.match(removed.stdout + removed.stderr, /unknown command/);
    }
    // Import after setting the isolated endpoint: the client captures env at load time.
    const { api } = await import("../mcp/src/client.js");
    const { tools } = await import("../mcp/src/tools.js");
    for (const [name, args] of [
      ["email_compose", { to: "test@example.invalid", body: "Test", mode: "send" }],
      ["email_attachments", { messageId: 1, operation: "download", partName: "1.2" }],
      ["email_archive", { messageIds: [1], operation: "move", destinationFolderId: "trash" }],
    ]) {
      await assert.rejects(tools.find(t => t.name === name).handler(args, api), error => error.code === "FORBIDDEN");
    }
    assert.equal(ctx.nativeCalls(), 0);
  } finally {
    if (peer) peer.terminate();
    if (bridge && bridge.exitCode === null) { const exited = once(bridge, "exit"); bridge.kill(); await exited; }
    for (const s of sockets) if (s.listening) await new Promise(resolve => s.close(resolve));
    process.env = savedEnv;
  }
});
console.log(`\n${passed} access-control checks passed.`);
