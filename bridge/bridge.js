#!/usr/bin/env node

/**
 * Thunderbird AI Bridge Server
 *
 * HTTP server (port 7700) for CLI requests.
 * WebSocket server (port 7701) for Thunderbird extension.
 * Forwards: CLI HTTP → WebSocket → Extension → response.
 *
 * Usage: node bridge.js
 */

import { createServer } from "http";
import { WebSocketServer } from "ws";
import { randomUUID } from "crypto";

const HTTP_PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === "--port") || "7700");
const WS_PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === "--ws-port") || "7701");

let extensionSocket = null;
const pending = new Map(); // id → { resolve, reject, timer }

// ─── WebSocket Server (for extension) ───────────────────────────────

const wss = new WebSocketServer({ host: "127.0.0.1", port: WS_PORT });

wss.on("connection", (ws) => {
  console.log("[bridge] Extension connected");
  extensionSocket = ws;

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

// ─── Forward request to extension ───────────────────────────────────

function forwardToExtension(method, path, body) {
  return new Promise((resolve, reject) => {
    if (!extensionSocket || extensionSocket.readyState !== 1) {
      reject({ message: "Thunderbird extension not connected. Is Thunderbird running?" });
      return;
    }
    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject({ message: "Request timed out (30s)" });
    }, 30000);
    pending.set(id, { resolve, reject, timer });
    extensionSocket.send(JSON.stringify({ id, method, path, body }));
  });
}

// ─── HTTP Server (for CLI) ──────────────────────────────────────────

const httpServer = createServer(async (req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
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

  // Forward to extension
  try {
    const result = await forwardToExtension(req.method, req.url, parsedBody);
    res.writeHead(200);
    res.end(JSON.stringify(result));
  } catch (err) {
    const status = err.message?.includes("not connected") ? 503 : 500;
    res.writeHead(status);
    res.end(JSON.stringify({ error: err.message || "Unknown error" }));
  }
});

httpServer.listen(HTTP_PORT, "127.0.0.1", () => {
  console.log(`[bridge] HTTP server on http://127.0.0.1:${HTTP_PORT}`);
  console.log(`[bridge] WebSocket server on ws://127.0.0.1:${WS_PORT}`);
  console.log(`[bridge] Waiting for Thunderbird extension to connect...`);
});
