#!/usr/bin/env node
/**
 * Bridge transport-security tests.
 *
 * Spawns the real bridge/bridge.js as a subprocess and checks the defenses against a web page
 * in the user's browser reaching the localhost bridge: CORS allowlist, blind cross-origin
 * requests, DNS rebinding (Host header), and WebSocket hijacking of the extension slot.
 * Also checks that ordinary CLI-style requests and the heartbeat keep working.
 */

import { spawn } from "child_process";
import { createServer, request } from "http";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { WebSocket } from "ws";

const BRIDGE = join(dirname(fileURLToPath(import.meta.url)), "..", "bridge", "bridge.js");
const PORT = 19720;
const WS_PORT = 19721;
const SELF_ORIGIN = `http://127.0.0.1:${PORT}`;

let passed = 0, failed = 0;

function test(name, actual, expected) {
  if (actual === expected) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${name} — expected ${expected}, got ${actual}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startBridge(env = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [BRIDGE, "--port", String(PORT), "--ws-port", String(WS_PORT)], {
      env: { ...process.env, TB_AUTH_TOKEN: undefined, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    const onData = (chunk) => {
      out += chunk.toString();
      if (out.includes("Waiting for Thunderbird extension")) resolve(proc);
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("exit", (code) => reject(new Error(`bridge exited early (code ${code}): ${out}`)));
    setTimeout(() => reject(new Error(`bridge did not start: ${out}`)), 5000);
  });
}

function stopBridge(proc) {
  return new Promise((resolve) => {
    proc.removeAllListeners("exit");
    proc.on("exit", resolve);
    proc.kill();
  });
}

async function withBridge(env, fn) {
  const proc = await startBridge(env);
  try {
    await fn();
  } finally {
    await stopBridge(proc);
  }
}

/** Raw HTTP call so Host and Origin can be set freely (fetch forbids overriding Host). */
function http(method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: PORT, method, path, headers }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, json });
      });
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** Connect a fake extension. Resolves "open" or "rejected". */
function connectExtension(options = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}`, options);
    const received = [];
    ws.on("message", (d) => {
      const msg = JSON.parse(d.toString());
      received.push(msg);
      ws.send(JSON.stringify({ id: msg.id, result: { echoed: msg.path } }));
    });
    ws.on("open", () => resolve({ state: "open", ws, received }));
    ws.on("unexpected-response", () => resolve({ state: "rejected", ws, received }));
    ws.on("error", () => resolve({ state: "rejected", ws, received }));
  });
}

async function extensionStatus() {
  return (await http("GET", "/bridge/status")).json?.extension;
}

// ─── HTTP: Host header (DNS rebinding) ──────────────────────────────

console.log("\n\x1b[1mHost header (DNS rebinding)\x1b[0m");
await withBridge({}, async () => {
  test("127.0.0.1 host accepted", (await http("GET", "/bridge/status")).status, 200);
  test("localhost host accepted", (await http("GET", "/bridge/status", { headers: { Host: `localhost:${PORT}` } })).status, 200);
  test("IPv6 loopback host accepted", (await http("GET", "/bridge/status", { headers: { Host: `[::1]:${PORT}` } })).status, 200);
  test("host.docker.internal accepted", (await http("GET", "/bridge/status", { headers: { Host: `host.docker.internal:${PORT}` } })).status, 200);
  const rebound = await http("GET", "/bridge/status", { headers: { Host: `evil.example:${PORT}` } });
  test("rebound domain rejected", rebound.status, 403);
  test("rebound domain carries FORBIDDEN code", rebound.json?.code, "FORBIDDEN");
});

await withBridge({ TB_BRIDGE_ALLOWED_HOSTS: "mac.lan" }, async () => {
  test("TB_BRIDGE_ALLOWED_HOSTS extends the allowlist", (await http("GET", "/bridge/status", { headers: { Host: `mac.lan:${PORT}` } })).status, 200);
});

// ─── HTTP: Origin / CORS ────────────────────────────────────────────

console.log("\n\x1b[1mOrigin / CORS\x1b[0m");
await withBridge({}, async () => {
  const ext = await connectExtension();
  test("fake extension connects without Origin", ext.state, "open");

  const plain = await http("POST", "/messages/search", { headers: { "Content-Type": "application/json" }, body: "{}" });
  test("CLI-style request (no Origin) is forwarded", plain.json?.echoed, "/messages/search");
  test("no Origin → no CORS header", plain.headers["access-control-allow-origin"], undefined);

  const before = ext.received.length;
  const blind = await http("POST", "/compose", {
    headers: { Origin: "https://evil.example", "Content-Type": "text/plain" },
    body: JSON.stringify({ to: "attacker@evil.example", body: "x", send: true }),
  });
  test("blind cross-origin POST rejected", blind.status, 403);
  test("blind cross-origin POST never reaches the extension", ext.received.length, before);
  test("opaque null Origin rejected", (await http("POST", "/compose", { headers: { Origin: "null" }, body: "{}" })).status, 403);

  test("preflight from foreign origin rejected", (await http("OPTIONS", "/compose", { headers: { Origin: "https://evil.example" } })).status, 403);
  const pre = await http("OPTIONS", "/compose", { headers: { Origin: SELF_ORIGIN } });
  test("preflight from allowed origin → 204", pre.status, 204);
  test("allowed origin is echoed", pre.headers["access-control-allow-origin"], SELF_ORIGIN);
  test("Vary: Origin set", pre.headers["vary"], "Origin");

  ext.ws.close();
});

await withBridge({ TB_BRIDGE_CORS_ORIGINS: "http://localhost:5173" }, async () => {
  const r = await http("GET", "/bridge/status", { headers: { Origin: "http://localhost:5173" } });
  test("TB_BRIDGE_CORS_ORIGINS allows a configured origin", r.headers["access-control-allow-origin"], "http://localhost:5173");
});

// ─── WebSocket: extension slot hijacking ────────────────────────────

console.log("\n\x1b[1mWebSocket origin\x1b[0m");
await withBridge({}, async () => {
  const legit = await connectExtension({ origin: "moz-extension://4b1c1e5e-0000-4000-8000-000000000000" });
  test("moz-extension:// origin accepted", legit.state, "open");

  test("https:// page origin rejected", (await connectExtension({ origin: "https://evil.example" })).state, "rejected");
  test("http://localhost page origin rejected", (await connectExtension({ origin: "http://localhost:3000" })).state, "rejected");
  test("opaque null origin rejected", (await connectExtension({ origin: "null" })).state, "rejected");

  const routed = await http("POST", "/messages/search", { body: "{}" });
  test("rejected page did not replace the extension socket", routed.json?.echoed, "/messages/search");
  test("requests still routed to the real extension", legit.received.length, 1);
  legit.ws.close();
});

// ─── Extension slot (#22) ───────────────────────────────────────────

console.log("\n\x1b[1mExtension slot\x1b[0m");
const closeCode = (ws, ms = 2000) => new Promise((resolve) => {
  if (ws.readyState === WebSocket.CLOSED) return resolve("closed");
  const t = setTimeout(() => resolve("still open"), ms);
  ws.on("close", (code) => { clearTimeout(t); resolve(code); });
});

await withBridge({ TB_BRIDGE_WS_TAKEOVER_MS: "200" }, async () => {
  const first = await connectExtension();
  const intruder = await connectExtension();
  test("second connection is closed while the extension responds", await closeCode(intruder.ws), 1008);
  const routed = await http("POST", "/messages/search", { body: "{}" });
  test("requests still go to the original extension", routed.json?.echoed === "/messages/search" && first.received.length === 1 && intruder.received.length === 0, true);
  first.ws.close();
  await sleep(100);
  const after = await connectExtension();
  await sleep(50);
  test("slot is free again once the extension disconnects", await extensionStatus(), "connected");
  const routedAfter = await http("POST", "/messages/search", { body: "{}" });
  test("reconnected extension receives requests", routedAfter.json?.echoed === "/messages/search" && after.received.length === 1, true);
  after.ws.close();
});

await withBridge({ TB_BRIDGE_WS_TAKEOVER_MS: "200" }, async () => {
  const stale = await connectExtension({ autoPong: false });
  const fresh = await connectExtension();
  test("replacement stays open when the old socket is unresponsive", await closeCode(fresh.ws, 600), "still open");
  const routed = await http("POST", "/messages/search", { body: "{}" });
  test("requests go to the replacement", routed.json?.echoed === "/messages/search" && fresh.received.length === 1 && stale.received.length === 0, true);
  test("unresponsive socket was terminated", await closeCode(stale.ws, 500) !== "still open", true);
  fresh.ws.close();
});

// ─── WebSocket heartbeat ────────────────────────────────────────────

console.log("\n\x1b[1mHeartbeat\x1b[0m");
await withBridge({ TB_BRIDGE_WS_HEARTBEAT_MS: "150" }, async () => {
  const healthy = await connectExtension();
  await sleep(600);
  test("responsive extension stays connected", await extensionStatus(), "connected");
  healthy.ws.close();
  await sleep(100);

  const dead = await connectExtension({ autoPong: false });
  test("unresponsive socket connects", dead.state, "open");
  await sleep(600);
  test("unresponsive socket is terminated", await extensionStatus(), "disconnected");
});

// ─── Error codes (#12) ──────────────────────────────────────────────

console.log("\n\x1b[1mError codes\x1b[0m");
await withBridge({}, async () => {
  const noExt = await http("POST", "/messages/search", { body: "{}" });
  test("no extension → 503", noExt.status, 503);
  test("no extension → EXTENSION_DISCONNECTED code", noExt.json?.code, "EXTENSION_DISCONNECTED");
  const silent = new WebSocket(`ws://127.0.0.1:${WS_PORT}`);
  await new Promise((r) => silent.on("open", r));
  await sleep(50);
  const slow = await http("POST", "/messages/search", { headers: { "X-TB-Timeout": "200" }, body: "{}" });
  test("extension timeout → 504", slow.status, 504);
  test("extension timeout → TIMEOUT code (never an empty result)", slow.json?.code === "TIMEOUT" && slow.json?.messages === undefined, true);
  silent.close();
});

// ─── Startup: port already taken ────────────────────────────────────

console.log("\n\x1b[1mPort in use\x1b[0m");
for (const [label, port] of [["WebSocket", WS_PORT], ["HTTP", PORT]]) {
  const blocker = createServer();
  await new Promise((r) => blocker.listen(port, "127.0.0.1", r));
  const proc = spawn(process.execPath, [BRIDGE, "--port", String(PORT), "--ws-port", String(WS_PORT)], {
    env: { ...process.env, TB_AUTH_TOKEN: undefined },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  proc.stdout.on("data", (c) => (out += c));
  proc.stderr.on("data", (c) => (out += c));
  const code = await new Promise((r) => proc.on("exit", r));
  await new Promise((r) => blocker.close(r));
  test(`${label} port taken → exit code 1`, code, 1);
  test(`${label} port taken → explains and names the port`, out.includes(`Cannot listen on 127.0.0.1:${port}`) && out.includes(`lsof -nP -iTCP:${port}`), true);
  test(`${label} port taken → no raw stack trace`, out.includes("Unhandled 'error' event"), false);
}

console.log(`\n\x1b[1m${"─".repeat(40)}\x1b[0m`);
console.log(`\x1b[1m${passed} passed, ${failed} failed, ${passed + failed} total\x1b[0m\n`);
process.exit(failed > 0 ? 1 : 0);
