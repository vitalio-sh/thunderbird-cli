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
 *
 * Per-request override: HTTP clients can pass `X-TB-Timeout: <ms>` header.
 */

import { createServer } from "http";
import { WebSocketServer } from "ws";
import { randomUUID } from "crypto";

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

let extensionSocket = null;
const pending = new Map(); // id → { resolve, reject, timer }

// ─── WebSocket Server (for extension) ───────────────────────────────

const wss = new WebSocketServer({ host: "127.0.0.1", port: WS_PORT });

wss.on("connection", (ws) => {
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
    if (extensionSocket === ws) extensionSocket = null;
  });
});

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
  const allowedOrigin = getAllowedCorsOrigin(req.headers.origin);
  if (allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-TB-Timeout");
    res.setHeader("Access-Control-Max-Age", "600");
    res.setHeader("Vary", "Origin");
  }

  if (req.method === "OPTIONS") {
    if (req.headers.origin && !allowedOrigin) {
      res.writeHead(403);
      res.end(JSON.stringify({ error: "CORS origin not allowed" }));
      return;
    }
    res.writeHead(204);
    res.end();
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
  let body = "";
  for await (const chunk of req) body += chunk;

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
    const status = err.message?.includes("not connected") ? 503 : 500;
    res.writeHead(status);
    res.end(JSON.stringify({ error: err.message || "Unknown error" }));
  }
});

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

httpServer.listen(HTTP_PORT, "127.0.0.1", () => {
  console.log(`[bridge] HTTP server on http://127.0.0.1:${HTTP_PORT}`);
  console.log(`[bridge] WebSocket server on ws://127.0.0.1:${WS_PORT}`);
  console.log(`[bridge] Default timeout: ${DEFAULT_TIMEOUT}ms (override via TB_BRIDGE_TIMEOUT env or X-TB-Timeout header)`);
  console.log(`[bridge] Waiting for Thunderbird extension to connect...`);
});
