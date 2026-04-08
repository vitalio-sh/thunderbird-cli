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

import { api } from "./client.js";
import { tools } from "./tools.js";

// ─── Server setup ──────────────────────────────────────────────────

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
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr — stdout is reserved for MCP JSON-RPC protocol
  console.error(
    `[tb-mcp] thunderbird-cli MCP server running on stdio (${tools.length} tools)`
  );
}

main().catch((err) => {
  console.error("[tb-mcp] Fatal:", err);
  process.exit(1);
});
