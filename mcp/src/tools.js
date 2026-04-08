/**
 * MCP tool definitions for thunderbird-cli.
 *
 * Each tool has:
 *   - name: tool identifier exposed to MCP clients
 *   - description: what the tool does (read by the LLM)
 *   - inputSchema: JSON Schema for arguments
 *   - handler: async (args, api) => result — calls bridge HTTP API
 *
 * `api` is injected by the server: api(method, path, body?) → response
 */

import { parseRelativeDate } from "./client.js";

export const tools = [
  // ─── 1. Stats ──────────────────────────────────────────────────
  {
    name: "email_stats",
    description:
      "Get an overview of all email accounts: total accounts, unread counts, message totals. Optionally filter to a single account or include per-folder breakdown.",
    inputSchema: {
      type: "object",
      properties: {
        accountId: {
          type: "string",
          description: "Optional: limit stats to a specific account ID",
        },
        includeFolders: {
          type: "boolean",
          description: "Include per-folder breakdown",
          default: false,
        },
      },
    },
    handler: async (args, api) => {
      if (args.accountId || args.includeFolders) {
        return await api("POST", "/stats", {
          accountId: args.accountId,
          folders: args.includeFolders,
        });
      }
      return await api("GET", "/stats");
    },
  },

  // ─── 2. Search ─────────────────────────────────────────────────
  {
    name: "email_search",
    description:
      "Search for emails across all accounts. Supports filters by sender, recipient, subject, date range, attachments, tags. Excludes junk by default. Use --fields to minimize token cost.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Full-text search query (searches body)",
        },
        accountId: { type: "string", description: "Limit to specific account" },
        folderId: { type: "string", description: "Limit to specific folder" },
        from: { type: "string", description: "Filter by sender address" },
        to: { type: "string", description: "Filter by recipient address" },
        subject: { type: "string", description: "Filter by subject substring" },
        unread: { type: "boolean", description: "Unread only" },
        flagged: { type: "boolean", description: "Flagged/starred only" },
        tag: { type: "string", description: "Filter by tag key (e.g. $label1)" },
        since: {
          type: "string",
          description:
            "Start date (ISO 8601 or relative: '7d', '2w', '3m', '1y', 'today', 'yesterday')",
        },
        until: { type: "string", description: "End date (ISO or relative)" },
        hasAttachment: { type: "boolean", description: "Only with attachments" },
        sizeMin: { type: "number", description: "Minimum message size in bytes" },
        sizeMax: { type: "number", description: "Maximum message size in bytes" },
        includeJunk: {
          type: "boolean",
          description: "Include junk messages (default: false)",
        },
        limit: { type: "number", description: "Max results", default: 25 },
      },
      required: ["query"],
    },
    handler: async (args, api) => {
      const body = { query: args.query, limit: args.limit || 25 };
      if (args.accountId) body.accountId = args.accountId;
      if (args.folderId) body.folderId = args.folderId;
      if (args.from) body.fromAddress = args.from;
      if (args.to) body.toAddress = args.to;
      if (args.subject) body.subject = args.subject;
      if (args.unread) body.unreadOnly = true;
      if (args.flagged) body.flagged = true;
      if (args.tag) body.tag = args.tag;
      if (args.since) body.fromDate = parseRelativeDate(args.since);
      if (args.until) body.toDate = parseRelativeDate(args.until);
      if (args.hasAttachment) body.hasAttachment = true;
      if (args.sizeMin) body.sizeMin = args.sizeMin;
      if (args.sizeMax) body.sizeMax = args.sizeMax;
      if (args.includeJunk) body.includeJunk = true;
      return await api("POST", "/messages/search", body);
    },
  },

  // ─── 3. List ───────────────────────────────────────────────────
  {
    name: "email_list",
    description:
      "List messages in a specific folder. Use email_folders first to get folder IDs. Supports pagination and sorting.",
    inputSchema: {
      type: "object",
      properties: {
        folderId: {
          type: "string",
          description: "Folder ID (e.g. 'account1://INBOX')",
        },
        unread: { type: "boolean", description: "Unread only" },
        flagged: { type: "boolean", description: "Flagged only" },
        offset: { type: "number", description: "Skip first N (pagination)" },
        sort: {
          type: "string",
          enum: ["date", "from", "subject", "size"],
          description: "Sort field",
        },
        sortOrder: {
          type: "string",
          enum: ["asc", "desc"],
          description: "Sort direction",
        },
        limit: { type: "number", description: "Max results", default: 25 },
      },
      required: ["folderId"],
    },
    handler: async (args, api) => {
      const body = { folderId: args.folderId, limit: args.limit || 25 };
      if (args.unread) body.unreadOnly = true;
      if (args.flagged) body.flagged = true;
      if (args.offset) body.offset = args.offset;
      if (args.sort) body.sort = args.sort;
      if (args.sortOrder) body.sortOrder = args.sortOrder;
      return await api("POST", "/messages/list", body);
    },
  },

  // ─── 4. Read ───────────────────────────────────────────────────
  {
    name: "email_read",
    description:
      "Read a specific email message. Modes: 'default' (headers + text body), 'headers' (cheapest), 'full' (with HTML), 'raw' (RFC822). Use maxBody to truncate long messages.",
    inputSchema: {
      type: "object",
      properties: {
        messageId: {
          type: "number",
          description: "Thunderbird internal message ID",
        },
        mode: {
          type: "string",
          enum: ["default", "headers", "full", "raw", "check-download"],
          description: "Read mode",
          default: "default",
        },
        maxBody: {
          type: "number",
          description: "Truncate body to N characters",
        },
      },
      required: ["messageId"],
    },
    handler: async (args, api) => {
      const id = args.messageId;
      const mode = args.mode || "default";
      let result;
      if (mode === "raw") result = await api("GET", `/messages/${id}/raw`);
      else if (mode === "headers") result = await api("GET", `/messages/${id}/headers`);
      else if (mode === "full") result = await api("GET", `/messages/${id}/full`);
      else if (mode === "check-download")
        result = await api("GET", `/messages/${id}/check-download`);
      else result = await api("GET", `/messages/${id}`);

      // Apply maxBody truncation
      if (args.maxBody && result?.parts?.text && result.parts.text.length > args.maxBody) {
        result.parts.text = result.parts.text.slice(0, args.maxBody) + "\n...[truncated]";
        result.parts.textTruncated = true;
      }
      return result;
    },
  },

  // ─── 5. Thread ─────────────────────────────────────────────────
  {
    name: "email_thread",
    description:
      "Get the full conversation thread for a message — all related messages sorted chronologically, resolved across accounts via References/In-Reply-To headers.",
    inputSchema: {
      type: "object",
      properties: {
        messageId: { type: "number", description: "Message ID" },
      },
      required: ["messageId"],
    },
    handler: async (args, api) => {
      return await api("GET", `/messages/${args.messageId}/thread`);
    },
  },

  // ─── 6. Compose ────────────────────────────────────────────────
  {
    name: "email_compose",
    description:
      "Compose a new email. Default mode is 'draft' (saved to Drafts folder, not sent). Use mode='send' to send immediately, mode='open' to open in Thunderbird's compose window for human review. ALWAYS prefer draft mode unless the human explicitly asked to send.",
    inputSchema: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "Recipient(s), comma-separated for multiple",
        },
        cc: { type: "string", description: "CC recipients" },
        bcc: { type: "string", description: "BCC recipients" },
        subject: { type: "string", description: "Subject line" },
        body: { type: "string", description: "Message body (plain text)" },
        html: {
          type: "boolean",
          description: "Treat body as HTML",
          default: false,
        },
        from: {
          type: "string",
          description:
            "Identity ID to send from (use email_identities-equivalent or check email_stats for accounts)",
        },
        priority: {
          type: "string",
          enum: ["highest", "high", "normal", "low", "lowest"],
        },
        mode: {
          type: "string",
          enum: ["draft", "open", "send"],
          description: "draft (default, saves silently), open (compose window), send (immediate)",
          default: "draft",
        },
      },
      required: ["to", "body"],
    },
    handler: async (args, api) => {
      const payload = {
        to: args.to,
        subject: args.subject || "",
        body: args.body,
        isHTML: args.html || false,
      };
      if (args.cc) payload.cc = args.cc;
      if (args.bcc) payload.bcc = args.bcc;
      if (args.from) payload.identityId = args.from;
      if (args.priority) payload.priority = args.priority;
      const mode = args.mode || "draft";
      if (mode === "send") payload.send = true;
      else if (mode === "open") payload.open = true;
      else payload.draft = true;
      return await api("POST", "/compose", payload);
    },
  },

  // ─── 7. Reply ──────────────────────────────────────────────────
  {
    name: "email_reply",
    description:
      "Reply to a message. Default mode is 'draft'. Use mode='send' for immediate send. Set replyAll=true to reply to all recipients.",
    inputSchema: {
      type: "object",
      properties: {
        messageId: { type: "number", description: "Message ID to reply to" },
        body: { type: "string", description: "Reply body" },
        replyAll: { type: "boolean", description: "Reply to all recipients" },
        mode: {
          type: "string",
          enum: ["draft", "open", "send"],
          default: "draft",
        },
      },
      required: ["messageId", "body"],
    },
    handler: async (args, api) => {
      const payload = {
        messageId: args.messageId,
        body: args.body,
        replyAll: args.replyAll || false,
      };
      const mode = args.mode || "draft";
      if (mode === "send") payload.send = true;
      else if (mode === "open") payload.open = true;
      else payload.draft = true;
      return await api("POST", "/reply", payload);
    },
  },

  // ─── 8. Forward ────────────────────────────────────────────────
  {
    name: "email_forward",
    description:
      "Forward a message to a new recipient. Default mode is 'draft' for human review.",
    inputSchema: {
      type: "object",
      properties: {
        messageId: { type: "number", description: "Message ID to forward" },
        to: { type: "string", description: "Recipient address" },
        body: { type: "string", description: "Optional additional text" },
        mode: {
          type: "string",
          enum: ["draft", "open", "send"],
          default: "draft",
        },
      },
      required: ["messageId", "to"],
    },
    handler: async (args, api) => {
      const payload = {
        messageId: args.messageId,
        to: args.to,
        body: args.body || "",
      };
      const mode = args.mode || "draft";
      if (mode === "send") payload.send = true;
      else if (mode === "open") payload.open = true;
      else payload.draft = true;
      return await api("POST", "/forward", payload);
    },
  },

  // ─── 9. Mark ───────────────────────────────────────────────────
  {
    name: "email_mark",
    description:
      "Update message flags: read/unread, flagged/unflagged, junk/not-junk. Accepts a single ID or array of IDs for batch operations.",
    inputSchema: {
      type: "object",
      properties: {
        messageIds: {
          type: "array",
          items: { type: "number" },
          description: "Message IDs",
        },
        read: { type: "boolean", description: "Mark as read (true) or unread (false)" },
        flagged: { type: "boolean", description: "Flag (true) or unflag (false)" },
        junk: { type: "boolean", description: "Mark junk (true) or not-junk (false)" },
      },
      required: ["messageIds"],
    },
    handler: async (args, api) => {
      const props = {};
      if (args.read !== undefined) props.read = args.read;
      if (args.flagged !== undefined) props.flagged = args.flagged;
      if (args.junk !== undefined) props.junk = args.junk;
      const results = [];
      for (const id of args.messageIds) {
        results.push(await api("POST", "/messages/update", { messageId: id, ...props }));
      }
      return { success: true, updated: results.length };
    },
  },

  // ─── 10. Archive / Move / Delete ───────────────────────────────
  {
    name: "email_archive",
    description:
      "Archive, move, or delete messages. Operations: 'archive' (move to archive folder), 'move' (to specific folder), 'delete' (to trash). Permanent delete requires confirm=true.",
    inputSchema: {
      type: "object",
      properties: {
        messageIds: {
          type: "array",
          items: { type: "number" },
          description: "Message IDs",
        },
        operation: {
          type: "string",
          enum: ["archive", "move", "delete"],
          description: "Operation type",
        },
        destinationFolderId: {
          type: "string",
          description: "Required for 'move' operation",
        },
        permanent: {
          type: "boolean",
          description: "For delete: skip trash (requires confirm)",
        },
        confirm: {
          type: "boolean",
          description: "Required for permanent delete",
        },
      },
      required: ["messageIds", "operation"],
    },
    handler: async (args, api) => {
      if (args.operation === "archive") {
        return await api("POST", "/messages/archive", { messageIds: args.messageIds });
      }
      if (args.operation === "move") {
        if (!args.destinationFolderId) {
          return { error: "destinationFolderId required for move" };
        }
        return await api("POST", "/messages/move", {
          messageIds: args.messageIds,
          destinationFolderId: args.destinationFolderId,
        });
      }
      if (args.operation === "delete") {
        if (args.permanent && !args.confirm) {
          return { error: "Permanent delete requires confirm=true" };
        }
        return await api("POST", "/messages/delete", {
          messageIds: args.messageIds,
          permanent: args.permanent || false,
        });
      }
      return { error: `Unknown operation: ${args.operation}` };
    },
  },

  // ─── 11. Attachments ───────────────────────────────────────────
  {
    name: "email_attachments",
    description:
      "List or download attachments from a message. Operation 'list' returns attachment metadata. Operation 'download' returns base64-encoded file data (use partName from list results).",
    inputSchema: {
      type: "object",
      properties: {
        messageId: { type: "number", description: "Message ID" },
        operation: {
          type: "string",
          enum: ["list", "download"],
          description: "list metadata or download a specific attachment",
        },
        partName: {
          type: "string",
          description: "Required for download — get from list operation",
        },
      },
      required: ["messageId", "operation"],
    },
    handler: async (args, api) => {
      if (args.operation === "list") {
        return await api("GET", `/messages/${args.messageId}/attachments`);
      }
      if (args.operation === "download") {
        if (!args.partName) return { error: "partName required for download" };
        return await api("POST", `/messages/${args.messageId}/attachment`, {
          partName: args.partName,
        });
      }
      return { error: `Unknown operation: ${args.operation}` };
    },
  },

  // ─── 12. Folders ───────────────────────────────────────────────
  {
    name: "email_folders",
    description:
      "List folders for an account, get folder info with message counts, or trigger sync. Operations: 'list' (folders for account), 'all' (across all accounts), 'info' (one folder), 'sync' (refresh from IMAP).",
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["list", "all", "info", "sync"],
          description: "Operation type",
        },
        accountId: {
          type: "string",
          description: "Required for 'list' operation",
        },
        folderId: {
          type: "string",
          description: "Required for 'info' and 'sync' operations",
        },
      },
      required: ["operation"],
    },
    handler: async (args, api) => {
      if (args.operation === "list") {
        if (!args.accountId) return { error: "accountId required for list" };
        return await api("GET", `/accounts/${args.accountId}/folders`);
      }
      if (args.operation === "all") {
        const accounts = await api("GET", "/accounts");
        const all = [];
        for (const acct of accounts) {
          const folders = await api("GET", `/accounts/${acct.id}/folders`);
          for (const f of folders) all.push({ ...f, accountId: acct.id });
        }
        return all;
      }
      if (args.operation === "info") {
        if (!args.folderId) return { error: "folderId required for info" };
        return await api("POST", "/folders/info", { folderId: args.folderId });
      }
      if (args.operation === "sync") {
        if (args.folderId) return await api("POST", "/sync", { folderId: args.folderId });
        return await api("POST", "/sync", { all: true });
      }
      return { error: `Unknown operation: ${args.operation}` };
    },
  },
];
