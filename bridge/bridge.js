#!/usr/bin/env node

/**
 * Thunderbird AI Bridge Server
 *
 * HTTP server (port 7700) for CLI requests.
 * WebSocket server (port 7701) for Thunderbird extension.
 * Forwards: CLI HTTP → WebSocket → Extension → response.
 *
 * Usage: node bridge.js [--port 7700] [--ws-port 7701]
 *
 * Environment variables:
 *   TB_BRIDGE_TIMEOUT  default per-request timeout in ms (default: 120000)
 *   TB_AUTH_TOKEN      if set, HTTP requests must present it as `Authorization: Bearer <token>`.
 *                      Unset it to run without authentication. Setting it to an empty value is
 *                      rejected at startup rather than silently disabling authentication.
 *   TB_BRIDGE_CORS_ORIGINS    comma-separated browser origins allowed to call the HTTP API
 *                             (default: the bridge's own http://127.0.0.1 / http://localhost origin)
 *   TB_BRIDGE_ALLOWED_HOSTS   extra comma-separated Host header names to accept, in addition to
 *                             IP literals, localhost, *.localhost and *.internal
 *   TB_BRIDGE_WS_HEARTBEAT_MS WebSocket ping interval used to drop dead extension sockets (default: 30000)
 *
 * Per-request override: HTTP clients can pass `X-TB-Timeout: <ms>` header.
 */

import { createServer } from "http";
import { isIP } from "net";
import { WebSocketServer } from "ws";
import { randomUUID, timingSafeEqual } from "crypto";

for (let i = 2; i < process.argv.length; i += 2) {
  if (!["--port", "--ws-port"].includes(process.argv[i]) || !/^\d+$/.test(process.argv[i + 1] || "") ||
      Number(process.argv[i + 1]) < 1 || Number(process.argv[i + 1]) > 65535) {
    console.error("[bridge] Supported arguments: --port <1-65535> --ws-port <1-65535>. --read-only is not implemented.");
    process.exit(1);
  }
}

const HTTP_PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === "--port") || "7700");
const WS_PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === "--ws-port") || "7701");
const DEFAULT_TIMEOUT = parseInt(process.env.TB_BRIDGE_TIMEOUT || "120000");
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.TB_BRIDGE_WS_HEARTBEAT_MS || "30000");
const CORS_ALLOWED_ORIGINS = new Set(
  (process.env.TB_BRIDGE_CORS_ORIGINS || `http://127.0.0.1:${HTTP_PORT},http://localhost:${HTTP_PORT}`)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);
const EXTRA_ALLOWED_HOSTS = new Set(
  (process.env.TB_BRIDGE_ALLOWED_HOSTS || "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
);
// An empty TB_AUTH_TOKEN is a misconfiguration, not a way to disable auth. Failing open here
// would leave the bridge reachable by any local process with nothing in the log to say so.
const RAW_AUTH_TOKEN = process.env.TB_AUTH_TOKEN;
if (RAW_AUTH_TOKEN !== undefined && RAW_AUTH_TOKEN.trim() === "") {
  console.error(
    "[bridge] TB_AUTH_TOKEN is set but empty. Refusing to start rather than silently " +
      "disabling authentication — unset the variable to run without auth."
  );
  process.exit(1);
}
const AUTH_TOKEN = RAW_AUTH_TOKEN ?? null;

function isAuthorized(req) {
  if (!AUTH_TOKEN) return true;
  // RFC 7235: the auth scheme is case-insensitive. Require exactly "<scheme> <token>".
  const parts = (req.headers["authorization"] || "").split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") return false;
  const expected = Buffer.from(AUTH_TOKEN);
  const actual = Buffer.from(parts[1]);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

// ─── Browser-origin defenses ────────────────────────────────────────
// Binding to 127.0.0.1 does not stop a web page in the user's browser from reaching the
// bridge. CORS alone only hides responses: a page can still fire "simple" cross-origin
// POSTs (e.g. compose+send, delete) blindly, and DNS rebinding makes a hostile domain
// same-origin with the bridge. CLI/MCP clients send no Origin header, so rejecting
// unknown origins and non-local Host names costs them nothing.

function getAllowedCorsOrigin(originHeader) {
  if (!originHeader) return null;
  let origin;
  try {
    origin = new URL(originHeader).origin;
  } catch {
    return null;
  }
  return CORS_ALLOWED_ORIGINS.has(origin) ? origin : null;
}

function isAllowedHost(hostHeader) {
  if (!hostHeader) return true;
  let hostname;
  try {
    hostname = new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  const bare = hostname.replace(/^\[|\]$/g, "");
  // DNS rebinding needs a domain name; IP literals can't be rebound. `.internal` is reserved
  // for private use (host.docker.internal, host.containers.internal, ...).
  return (
    isIP(bare) !== 0 ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".internal") ||
    EXTRA_ALLOWED_HOSTS.has(hostname)
  );
}

// The extension connects from a moz-extension:// origin; non-browser clients send none.
// Web content can only present http(s)/file origins or the opaque "null" origin.
function isWebPageOrigin(originHeader) {
  if (!originHeader) return false;
  return originHeader === "null" || /^(https?|file):/i.test(originHeader);
}

let extensionSocket = null;
const pending = new Map(); // id → { resolve, reject, timer }

// ─── WebSocket Server (for extension) ───────────────────────────────

const wss = new WebSocketServer({
  host: "127.0.0.1",
  port: WS_PORT,
  verifyClient: ({ req }) => {
    if (isWebPageOrigin(req.headers.origin)) {
      console.error(`[bridge] Rejected WebSocket connection from web origin ${req.headers.origin}`);
      return false;
    }
    let token;
    try {
      token = new URL(req.url, "http://localhost").searchParams.get("token");
    } catch {
      return false;
    }
    return isAuthorized({ headers: { authorization: `Bearer ${token || ""}` } });
  },
});

wss.on("connection", (ws) => {
  ws.on("error", (err) => console.error("[bridge] Extension socket error:", err.message));
  if (extensionSocket) {
    ws.close(1008, "An extension is already connected");
    return;
  }
  console.log("[bridge] Extension connected");
  extensionSocket = ws;
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) {
          p.reject(msg.error);
        } else {
          p.resolve(msg.result);
        }
      }
    } catch (e) {
      console.error("[bridge] Bad message from extension:", e.message);
    }
  });

  ws.on("close", () => {
    console.log("[bridge] Extension disconnected");
    if (extensionSocket === ws) {
      extensionSocket = null;
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject({ message: "Thunderbird extension not connected; request outcome is unknown. Inspect drafts before retrying." });
      }
      pending.clear();
    }
  });
});

// Terminate sockets that stop answering pings (e.g. after the host slept), so requests fail
// fast with EXTENSION_DISCONNECTED instead of hanging until the per-request timeout.
const heartbeatInterval = setInterval(() => {
  for (const client of wss.clients) {
    if (client.isAlive === false) {
      client.terminate();
      continue;
    }
    client.isAlive = false;
    if (client.readyState === 1) client.ping();
  }
}, HEARTBEAT_INTERVAL_MS);

wss.on("close", () => {
  clearInterval(heartbeatInterval);
});

// ─── Forward request to extension ───────────────────────────────────

function forwardToExtension(method, path, body, timeoutMs = DEFAULT_TIMEOUT) {
  return new Promise((resolve, reject) => {
    if (!extensionSocket || extensionSocket.readyState !== 1) {
      reject({ message: "Thunderbird extension not connected. Is Thunderbird running?" });
      return;
    }
    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject({ message: `Request timed out (${Math.round(timeoutMs / 1000)}s)` });
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    extensionSocket.send(JSON.stringify({ id, method, path, body }));
  });
}

// ─── HTTP Server (for CLI) ──────────────────────────────────────────

const httpServer = createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  if (!isAllowedHost(req.headers.host)) {
    res.writeHead(403);
    res.end(
      JSON.stringify({
        error: `Host "${req.headers.host}" not allowed. Add it to TB_BRIDGE_ALLOWED_HOSTS if this is intended.`,
        code: "FORBIDDEN",
      })
    );
    return;
  }

  const allowedOrigin = getAllowedCorsOrigin(req.headers.origin);
  if (req.headers.origin && !allowedOrigin) {
    res.writeHead(403);
    res.end(
      JSON.stringify({
        error: "CORS origin not allowed. Add it to TB_BRIDGE_CORS_ORIGINS if this is intended.",
        code: "FORBIDDEN",
      })
    );
    return;
  }
  if (allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-TB-Timeout");
    res.setHeader("Access-Control-Max-Age", "600");
    res.setHeader("Vary", "Origin");
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (!isAuthorized(req)) {
    res.writeHead(401);
    res.end(
      JSON.stringify({
        error: "Missing or invalid Authorization token. Set TB_AUTH_TOKEN for this client.",
        code: "AUTH_REQUIRED",
      })
    );
    return;
  }

  // Bridge status endpoint (doesn't need extension)
  if (req.url === "/bridge/status") {
    const status = {
      bridge: "running",
      extension: extensionSocket ? "connected" : "disconnected",
      httpPort: HTTP_PORT,
      wsPort: WS_PORT,
      defaultTimeoutMs: DEFAULT_TIMEOUT,
    };
    res.writeHead(200);
    res.end(JSON.stringify(status));
    return;
  }

  // Read body
  const chunks = [];
  let bytes = 0;
  try {
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 40 * 1024 * 1024) {
        res.writeHead(413);
        res.end(JSON.stringify({ error: "Request exceeds 40 MiB" }));
        return;
      }
      chunks.push(chunk);
    }
  } catch {
    if (!res.destroyed) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "Incomplete request body" }));
    }
    return;
  }
  // A UTF-8 character may span network chunks; decode only after collecting bytes.
  const body = Buffer.concat(chunks, bytes).toString("utf8");

  let parsedBody = null;
  if (body.trim()) {
    try {
      parsedBody = JSON.parse(body);
    } catch (e) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return;
    }
  }

  // Per-request timeout override via X-TB-Timeout header
  let timeoutMs = DEFAULT_TIMEOUT;
  const headerTimeout = req.headers["x-tb-timeout"];
  if (headerTimeout) {
    const parsed = parseInt(headerTimeout);
    if (parsed > 0) timeoutMs = parsed;
  }

  // Forward to extension
  try {
    const result = await forwardToExtension(req.method, req.url, parsedBody, timeoutMs);
    res.writeHead(200);
    res.end(JSON.stringify(result));
  } catch (err) {
    const status = err.code === "FORBIDDEN" ? 403 : err.message?.includes("not connected") ? 503 : 500;
    res.writeHead(status);
    res.end(JSON.stringify({ error: err.message || "Unknown error", code: err.code }));
  }
});

// A taken port is the most common startup failure (often an editor's port forwarding); explain it
// instead of crashing with an unhandled 'error' event.
function onServerError(label, port) {
  return (err) => {
    if (err.code !== "EADDRINUSE" && err.code !== "EACCES") {
      console.error(`[bridge] ${label} server error:`, err.message);
      return;
    }
    console.error(`[bridge] Cannot listen on 127.0.0.1:${port} (${label}): ${err.code === "EADDRINUSE" ? "port already in use" : "permission denied"}.`);
    console.error(`[bridge] See what holds it:  lsof -nP -iTCP:${port} -sTCP:LISTEN`);
    console.error(
      label === "WebSocket"
        ? `[bridge] The Thunderbird extension always connects to ws://127.0.0.1:${port}, so free this port (e.g. stop editor port forwarding) rather than changing it.`
        : `[bridge] Or pick another HTTP port: --port <n>, and set TB_BRIDGE_PORT=<n> for tb / tb-mcp.`
    );
    process.exit(1);
  };
}
wss.on("error", onServerError("WebSocket", WS_PORT));
httpServer.on("error", onServerError("HTTP", HTTP_PORT));

httpServer.listen(HTTP_PORT, "127.0.0.1", () => {
  console.log(`[bridge] HTTP server on http://127.0.0.1:${HTTP_PORT}`);
  console.log(`[bridge] WebSocket server on ws://127.0.0.1:${WS_PORT}`);
  console.log(`[bridge] Default timeout: ${DEFAULT_TIMEOUT}ms (override via TB_BRIDGE_TIMEOUT env or X-TB-Timeout header)`);
  console.log(
    AUTH_TOKEN
      ? "[bridge] Auth: enabled (Authorization: Bearer required on all HTTP requests)"
      : "[bridge] Auth: disabled — any local process can call this bridge (set TB_AUTH_TOKEN to require a token)"
  );
  console.log(`[bridge] Waiting for Thunderbird extension to connect...`);
});
