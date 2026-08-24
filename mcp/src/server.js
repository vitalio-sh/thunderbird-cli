#!/usr/bin/env node

/**
 * thunderbird-cli MCP server
 *
 * Exposes Thunderbird email management as MCP tools for Claude Desktop and
 * other MCP-compatible clients. Communicates with the local bridge daemon
 * (default: 127.0.0.1:7700) which forwards to the Thunderbird WebExtension.
 *
 * Usage:
 *   tb-mcp                                # uses defaults
 *   TB_BRIDGE_HOST=host.docker.internal tb-mcp
 *
 * Add to Claude Desktop config (claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "thunderbird": { "command": "tb-mcp" }
 *     }
 *   }
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { api } from "./client.js";
import { tools } from "./tools.js";

// ─── Server setup ──────────────────────────────────────────────────

const LOCK_DIR = process.env.TB_MCP_LOCK_DIR || tmpdir();
const LOCK_PATH = join(LOCK_DIR, "thunderbird-cli-mcp.lock.json");

function makeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function acquireSingletonLock() {
  mkdirSync(LOCK_DIR, { recursive: true });
  const payload = JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() });

  try {
    writeFileSync(LOCK_PATH, payload, { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;

    let existing;
    try {
      existing = JSON.parse(readFileSync(LOCK_PATH, "utf8"));
    } catch {
      rmSync(LOCK_PATH, { force: true });
      writeFileSync(LOCK_PATH, payload, { flag: "wx" });
      return;
    }

    if (isPidAlive(existing.pid)) {
      throw makeError(
        "MCP_SINGLETON_ACTIVE",
        `thunderbird-cli MCP server already running with pid ${existing.pid}`
      );
    }

    rmSync(LOCK_PATH, { force: true });
    writeFileSync(LOCK_PATH, payload, { flag: "wx" });
  }
}

function releaseSingletonLock() {
  try {
    const existing = JSON.parse(readFileSync(LOCK_PATH, "utf8"));
    if (existing.pid === process.pid) {
      rmSync(LOCK_PATH, { force: true });
    }
  } catch {}
}

const server = new Server(
  {
    name: "thunderbird-cli",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ─── Handlers ──────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: tools.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    })),
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const tool = tools.find((t) => t.name === name);

  if (!tool) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
      isError: true,
    };
  }

  try {
    const result = await tool.handler(args || {}, api);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: err.message || String(err),
            code: err.code || "UNKNOWN",
          }),
        },
      ],
      isError: true,
    };
  }
});

// ─── Start ─────────────────────────────────────────────────────────

async function main() {
  acquireSingletonLock();
  process.on("exit", releaseSingletonLock);
  process.on("SIGINT", () => {
    releaseSingletonLock();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    releaseSingletonLock();
    process.exit(143);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr — stdout is reserved for MCP JSON-RPC protocol
  console.error(
    `[tb-mcp] thunderbird-cli MCP server running on stdio (${tools.length} tools)`
  );
}

main().catch((err) => {
  releaseSingletonLock();
  console.error("[tb-mcp] Fatal:", err.code || "UNKNOWN", err.message || err);
  process.exit(1);
});
