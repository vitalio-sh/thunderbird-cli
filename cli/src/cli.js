#!/usr/bin/env node

/**
 * tb — Thunderbird AI CLI
 *
 * AI-agent-friendly CLI for managing email via Thunderbird.
 * All output is JSON by default.
 */

import { Command } from "commander";
import { api, output, outputError, getConfig, parseRelativeDate } from "./client.js";

const program = new Command();

program
  .name("tb")
  .description("AI-agent email management via Thunderbird")
  .version("1.0.0")
  .option("-f, --format <type>", "output format: json, compact, table", "json")
  .option("--fields <csv>", "comma-separated fields to include in output")
  .option("--compact", "strip null values and minimize output")
  .option("--max-body <chars>", "truncate message bodies to N characters")
  .option("--timeout <ms>", "request timeout in milliseconds", "30000");

// ─── Helpers ──────────────────────────────────────────────────────────

function getOutputOpts(globalOpts) {
  const opts = {};
  if (globalOpts.fields) opts.fields = globalOpts.fields.split(",").map(s => s.trim());
  if (globalOpts.compact) opts.compact = true;
  if (globalOpts.maxBody) opts.maxBody = parseInt(globalOpts.maxBody);
  return opts;
}

function getTimeout(globalOpts) {
  return parseInt(globalOpts.timeout) || 30000;
}

function run(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      outputError(err, program.opts().format);
    }
  };
}

function parseIds(str) {
  return str.split(",").map(id => parseInt(id.trim()));
}

// ─── Health ───────────────────────────────────────────────────────────

program
  .command("health")
  .description("Check if Thunderbird bridge is running")
  .action(run(async () => {
    const g = program.opts();
    const data = await api("GET", "/health", null, getTimeout(g));
    output(data, g.format, getOutputOpts(g));
  }));

// ─── Bridge Status ────────────────────────────────────────────────────

program
  .command("bridge-status")
  .description("Get bridge status (works without extension)")
  .action(run(async () => {
    const g = program.opts();
    const data = await api("GET", "/bridge/status", null, getTimeout(g));
    output(data, g.format, getOutputOpts(g));
  }));

// ─── Accounts ─────────────────────────────────────────────────────────

program
  .command("accounts")
  .description("List all email accounts")
  .action(run(async () => {
    const g = program.opts();
    const data = await api("GET", "/accounts", null, getTimeout(g));
    output(data, g.format, getOutputOpts(g));
  }));

program
  .command("account <accountId>")
  .description("Get account details")
  .action(run(async (accountId) => {
    const g = program.opts();
    const data = await api("GET", `/accounts/${accountId}`, null, getTimeout(g));
    output(data, g.format, getOutputOpts(g));
  }));

// ─── Identities ───────────────────────────────────────────────────────

program
  .command("identities")
  .description("List all identities")
  .action(run(async () => {
    const g = program.opts();
    const data = await api("GET", "/identities", null, getTimeout(g));
    output(data, g.format, getOutputOpts(g));
  }));

// ─── Folders ──────────────────────────────────────────────────────────

program
  .command("folders [accountId]")
  .description("List folders for an account")
  .option("--all", "list folders across all accounts")
  .action(run(async (accountId, opts) => {
    const g = program.opts();
    const fmt = g.format;
    const outOpts = getOutputOpts(g);
    const timeout = getTimeout(g);

    if (opts.all) {
      const accounts = await api("GET", "/accounts", null, timeout);
      const allFolders = [];
      for (const acct of accounts) {
        const folders = await api("GET", `/accounts/${acct.id}/folders`, null, timeout);
        for (const f of folders) allFolders.push({ ...f, accountId: acct.id });
      }
      output(allFolders, fmt, outOpts);
    } else {
      if (!accountId) {
        outputError({ message: "Provide accountId or use --all", code: "INVALID_ARGS" }, fmt);
        return;
      }
      const data = await api("GET", `/accounts/${accountId}/folders`, null, timeout);
      output(data, fmt, outOpts);
    }
  }));

// ─── Folder Info ──────────────────────────────────────────────────────

program
  .command("folder-info <folderId>")
  .description("Get folder details")
  .action(run(async (folderId) => {
    const g = program.opts();
    const data = await api("POST", "/folders/info", { folderId }, getTimeout(g));
    output(data, g.format, getOutputOpts(g));
  }));

// ─── Folder Create ────────────────────────────────────────────────────

program
  .command("folder-create <parentFolderId> <name>")
  .description("Create a subfolder")
  .action(run(async (parentFolderId, name) => {
    const g = program.opts();
    const data = await api("POST", "/folders/create", { parentFolderId, name }, getTimeout(g));
    output(data, g.format, getOutputOpts(g));
  }));

// ─── Folder Rename ────────────────────────────────────────────────────

program
  .command("folder-rename <folderId> <newName>")
  .description("Rename a folder")
  .action(run(async (folderId, newName) => {
    const g = program.opts();
    const data = await api("POST", "/folders/rename", { folderId, newName }, getTimeout(g));
    output(data, g.format, getOutputOpts(g));
  }));

// ─── Folder Delete ────────────────────────────────────────────────────

program
  .command("folder-delete <folderId>")
  .description("Delete a folder")
  .option("--confirm", "required to confirm deletion")
  .action(run(async (folderId, opts) => {
    const g = program.opts();
    const fmt = g.format;
    if (!opts.confirm) {
      outputError({ message: "Use --confirm to delete", code: "INVALID_ARGS" }, fmt);
      return;
    }
    const data = await api("POST", "/folders/delete", { folderId }, getTimeout(g));
    output(data, fmt, getOutputOpts(g));
  }));

// ─── Stats ────────────────────────────────────────────────────────────

program
  .command("stats [accountId]")
  .description("Overview of all accounts (unread counts, totals)")
  .option("--folders", "include per-folder breakdown")
  .action(run(async (accountId, opts) => {
    const g = program.opts();
    const timeout = getTimeout(g);

    if (accountId || opts.folders) {
      const body = {};
      if (accountId) body.accountId = accountId;
      if (opts.folders) body.folders = true;
      const data = await api("POST", "/stats", body, timeout);
      output(data, g.format, getOutputOpts(g));
    } else {
      const data = await api("GET", "/stats", null, timeout);
      output(data, g.format, getOutputOpts(g));
    }
  }));

// ─── Search ───────────────────────────────────────────────────────────

program
  .command("search <query>")
  .description("Search messages across all accounts")
  .option("-a, --account <id>", "limit to specific account")
  .option("--folder <id>", "limit to specific folder")
  .option("--from <address>", "filter by sender")
  .option("--to <address>", "filter by recipient")
  .option("--subject <text>", "filter by subject")
  .option("--unread", "unread only")
  .option("--flagged", "flagged only")
  .option("--tag <tag>", "filter by tag")
  .option("--since <date>", "from date (ISO or relative: 7d, 2w, 3m, today, yesterday)")
  .option("--until <date>", "to date (ISO or relative)")
  .option("--has-attachment", "only messages with attachments")
  .option("--size-min <bytes>", "minimum message size")
  .option("--size-max <bytes>", "maximum message size")
  .option("--include-junk", "include junk/spam messages")
  .option("-l, --limit <n>", "max results", "25")
  .action(run(async (query, opts) => {
    const g = program.opts();
    const body = {
      query,
      limit: parseInt(opts.limit),
    };
    if (opts.account) body.accountId = opts.account;
    if (opts.folder) body.folderId = opts.folder;
    if (opts.from) body.fromAddress = opts.from;
    if (opts.to) body.toAddress = opts.to;
    if (opts.subject) body.subject = opts.subject;
    if (opts.unread) body.unreadOnly = true;
    if (opts.flagged) body.flagged = true;
    if (opts.tag) body.tag = opts.tag;
    if (opts.since) body.fromDate = parseRelativeDate(opts.since);
    if (opts.until) body.toDate = parseRelativeDate(opts.until);
    if (opts.hasAttachment) body.hasAttachment = true;
    if (opts.sizeMin) body.sizeMin = parseInt(opts.sizeMin);
    if (opts.sizeMax) body.sizeMax = parseInt(opts.sizeMax);
    if (opts.includeJunk) body.includeJunk = true;

    const data = await api("POST", "/messages/search", body, getTimeout(g));
    output(data, g.format, getOutputOpts(g));
  }));

// ─── List Messages ────────────────────────────────────────────────────

program
  .command("list <folderId>")
  .description("List messages in a folder")
  .option("--unread", "unread only")
  .option("--flagged", "flagged only")
  .option("--offset <n>", "skip first N messages")
  .option("--sort <field>", "sort by: date|from|subject|size")
  .option("--sort-order <dir>", "sort direction: asc|desc")
  .option("-l, --limit <n>", "max results", "25")
  .action(run(async (folderId, opts) => {
    const g = program.opts();
    const body = {
      folderId,
      limit: parseInt(opts.limit),
    };
    if (opts.unread) body.unreadOnly = true;
    if (opts.flagged) body.flagged = true;
    if (opts.offset) body.offset = parseInt(opts.offset);
    if (opts.sort) body.sort = opts.sort;
    if (opts.sortOrder) body.sortOrder = opts.sortOrder;

    const data = await api("POST", "/messages/list", body, getTimeout(g));
    output(data, g.format, getOutputOpts(g));
  }));

// ─── Read Message ─────────────────────────────────────────────────────

program
  .command("read <messageId>")
  .description("Read a full message")
  .option("--raw", "get raw RFC822")
  .option("--headers", "headers only")
  .option("--full", "include HTML body")
  .option("--body-only", "just text body, no JSON wrapper")
  .option("--check-download", "check download state")
  .action(run(async (messageId, opts) => {
    const g = program.opts();
    const timeout = getTimeout(g);
    const outOpts = getOutputOpts(g);

    if (opts.raw) {
      const data = await api("GET", `/messages/${messageId}/raw`, null, timeout);
      output(data, g.format, outOpts);
    } else if (opts.headers) {
      const data = await api("GET", `/messages/${messageId}/headers`, null, timeout);
      output(data, g.format, outOpts);
    } else if (opts.full) {
      const data = await api("GET", `/messages/${messageId}/full`, null, timeout);
      output(data, g.format, outOpts);
    } else if (opts.checkDownload) {
      const data = await api("GET", `/messages/${messageId}/check-download`, null, timeout);
      output(data, g.format, outOpts);
    } else if (opts.bodyOnly) {
      const data = await api("GET", `/messages/${messageId}`, null, timeout);
      output(data.parts?.text || data.body || "", g.format, { ...outOpts, raw: true });
    } else {
      const data = await api("GET", `/messages/${messageId}`, null, timeout);
      output(data, g.format, outOpts);
    }
  }));

// ─── Read Batch ───────────────────────────────────────────────────────

program
  .command("read-batch <messageIds>")
  .description("Read multiple messages at once (comma-separated IDs)")
  .action(run(async (messageIds) => {
    const g = program.opts();
    const ids = parseIds(messageIds);
    const data = await api("POST", "/messages/read-batch", { messageIds: ids }, getTimeout(g));
    output(data, g.format, getOutputOpts(g));
  }));

// ─── Thread ───────────────────────────────────────────────────────────

program
  .command("thread <messageId>")
  .description("Get full conversation thread for a message")
  .option("--headers", "headers only for each message")
  .action(run(async (messageId) => {
    const g = program.opts();
    const data = await api("GET", `/messages/${messageId}/thread`, null, getTimeout(g));
    output(data, g.format, getOutputOpts(g));
  }));

// ─── Recent ───────────────────────────────────────────────────────────

program
  .command("recent")
  .description("Recent messages across all accounts")
  .option("--hours <n>", "hours to look back", "24")
  .option("--unread", "unread only")
  .option("--account <id>", "limit to specific account")
  .option("-l, --limit <n>", "max results", "50")
  .action(run(async (opts) => {
    const g = program.opts();
    const body = {
      hours: parseInt(opts.hours),
      limit: parseInt(opts.limit),
    };
    if (opts.unread) body.unreadOnly = true;
    if (opts.account) body.accountId = opts.account;

    const data = await api("POST", "/recent", body, getTimeout(g));
    output(data, g.format, getOutputOpts(g));
  }));

// ─── Move ─────────────────────────────────────────────────────────────

program
  .command("move <messageIds> <folderId>")
  .description("Move message(s) to folder (comma-separated IDs)")
  .action(run(async (messageIds, folderId) => {
    const g = program.opts();
    const ids = parseIds(messageIds);
    const data = await api("POST", "/messages/move", {
      messageIds: ids,
      destinationFolderId: folderId,
    }, getTimeout(g));
    output(data, g.format, getOutputOpts(g));
  }));

// ─── Copy ─────────────────────────────────────────────────────────────

program
  .command("copy <messageIds> <folderId>")
  .description("Copy message(s) to folder (comma-separated IDs)")
  .action(run(async (messageIds, folderId) => {
    const g = program.opts();
    const ids = parseIds(messageIds);
    const data = await api("POST", "/messages/copy", {
      messageIds: ids,
      destinationFolderId: folderId,
    }, getTimeout(g));
    output(data, g.format, getOutputOpts(g));
  }));

// ─── Delete ───────────────────────────────────────────────────────────

program
  .command("delete <messageIds>")
  .description("Delete message(s) (to trash)")
  .option("--permanent", "permanently delete (skip trash)")
  .option("--confirm", "required for permanent delete")
  .action(run(async (messageIds, opts) => {
    const g = program.opts();
    const fmt = g.format;
    if (opts.permanent && !opts.confirm) {
      outputError({ message: "Use --confirm for permanent delete", code: "INVALID_ARGS" }, fmt);
      return;
    }
    const ids = parseIds(messageIds);
    const data = await api("POST", "/messages/delete", {
      messageIds: ids,
      permanent: opts.permanent || false,
    }, getTimeout(g));
    output(data, fmt, getOutputOpts(g));
  }));

// ─── Archive ──────────────────────────────────────────────────────────

program
  .command("archive <messageIds>")
  .description("Archive message(s) (comma-separated IDs)")
  .action(run(async (messageIds) => {
    const g = program.opts();
    const ids = parseIds(messageIds);
    const data = await api("POST", "/messages/archive", { messageIds: ids }, getTimeout(g));
    output(data, g.format, getOutputOpts(g));
  }));

// ─── Mark ─────────────────────────────────────────────────────────────

program
  .command("mark <messageIds>")
  .description("Update message flags (comma-separated IDs for batch)")
  .option("--read", "mark as read")
  .option("--unread", "mark as unread")
  .option("--flagged", "flag message")
  .option("--unflagged", "remove flag")
  .option("--junk", "mark as junk")
  .option("--not-junk", "mark as not junk")
  .action(run(async (messageIds, opts) => {
    const g = program.opts();
    const ids = parseIds(messageIds);
    const timeout = getTimeout(g);

    const flags = {};
    if (opts.read) flags.read = true;
    if (opts.unread) flags.read = false;
    if (opts.flagged) flags.flagged = true;
    if (opts.unflagged) flags.flagged = false;
    if (opts.junk) flags.junk = true;
    if (opts.notJunk) flags.junk = false;

    if (ids.length === 1) {
      const data = await api("POST", "/messages/update", { messageId: ids[0], ...flags }, timeout);
      output(data, g.format, getOutputOpts(g));
    } else {
      const results = [];
      for (const id of ids) {
        const data = await api("POST", "/messages/update", { messageId: id, ...flags }, timeout);
        results.push(data);
      }
      output(results, g.format, getOutputOpts(g));
    }
  }));

// ─── Tags ─────────────────────────────────────────────────────────────

program
  .command("tags")
  .description("List available tags")
  .action(run(async () => {
    const g = program.opts();
    const data = await api("GET", "/tags", null, getTimeout(g));
    output(data, g.format, getOutputOpts(g));
  }));

// ─── Tag ──────────────────────────────────────────────────────────────

program
  .command("tag <messageId> <tag>")
  .description("Add/remove tag on a message")
  .option("--remove", "remove tag instead of adding")
  .action(run(async (messageId, tag, opts) => {
    const g = program.opts();
    const timeout = getTimeout(g);

    const msg = await api("GET", `/messages/${messageId}`, null, timeout);
    let tags = msg.tags || [];
    if (opts.remove) {
      tags = tags.filter(t => t !== tag);
    } else {
      if (!tags.includes(tag)) tags.push(tag);
    }
    const data = await api("POST", "/messages/update", {
      messageId: parseInt(messageId),
      tags,
    }, timeout);
    output(data, g.format, getOutputOpts(g));
  }));

// ─── Tag Create ───────────────────────────────────────────────────────

program
  .command("tag-create <key> <label> <color>")
  .description("Create a new tag")
  .action(run(async (key, label, color) => {
    const g = program.opts();
    const data = await api("POST", "/tags/create", { key, tag: label, color }, getTimeout(g));
    output(data, g.format, getOutputOpts(g));
  }));

// ─── Compose ──────────────────────────────────────────────────────────

program
  .command("compose")
  .description("Compose a new message")
  .requiredOption("--to <address>", "recipient(s), comma-separated")
  .option("--cc <address>", "CC recipient(s)")
  .option("--bcc <address>", "BCC recipient(s)")
  .option("--subject <text>", "subject line")
  .option("--body <text>", "message body")
  .option("--body-file <path>", "read body from file")
  .option("--html", "body is HTML")
  .option("--from <identityId>", "send from specific identity")
  .option("--priority <level>", "priority: highest|high|normal|low|lowest")
  .option("--header <key:value>", "custom header")
  .option("--draft", "save as draft (default)")
  .option("--open", "open compose window")
  .option("--send", "send immediately")
  .action(run(async (opts) => {
    const g = program.opts();
    let body = opts.body || "";
    if (opts.bodyFile) {
      const { readFileSync } = await import("fs");
      body = readFileSync(opts.bodyFile, "utf-8");
    }

    const payload = {
      to: opts.to,
      subject: opts.subject || "",
      body,
      isHTML: opts.html || false,
    };
    if (opts.cc) payload.cc = opts.cc;
    if (opts.bcc) payload.bcc = opts.bcc;
    if (opts.from) payload.identityId = opts.from;
    if (opts.priority) payload.priority = opts.priority;
    if (opts.header) payload.header = opts.header;

    // Mode: send, open, or draft (default)
    if (opts.send) {
      payload.send = true;
    } else if (opts.open) {
      payload.open = true;
    } else {
      payload.draft = true;
    }

    const data = await api("POST", "/compose", payload, getTimeout(g));
    output(data, g.format, getOutputOpts(g));
  }));

// ─── Reply ────────────────────────────────────────────────────────────

program
  .command("reply <messageId>")
  .description("Reply to a message")
  .option("--body <text>", "reply text")
  .option("--body-file <path>", "read reply from file")
  .option("--all", "reply to all")
  .option("--html", "body is HTML")
  .option("--draft", "save as draft (default)")
  .option("--open", "open compose window")
  .option("--send", "send immediately")
  .action(run(async (messageId, opts) => {
    const g = program.opts();
    let body = opts.body || "";
    if (opts.bodyFile) {
      const { readFileSync } = await import("fs");
      body = readFileSync(opts.bodyFile, "utf-8");
    }

    const payload = {
      messageId: parseInt(messageId),
      body,
      replyAll: opts.all || false,
    };

    if (opts.send) {
      payload.send = true;
    } else if (opts.open) {
      payload.open = true;
    } else {
      payload.draft = true;
    }

    const data = await api("POST", "/reply", payload, getTimeout(g));
    output(data, g.format, getOutputOpts(g));
  }));

// ─── Forward ──────────────────────────────────────────────────────────

program
  .command("forward <messageId>")
  .description("Forward a message")
  .requiredOption("--to <address>", "forward to")
  .option("--body <text>", "additional text")
  .option("--draft", "save as draft (default)")
  .option("--open", "open compose window")
  .option("--send", "send immediately")
  .action(run(async (messageId, opts) => {
    const g = program.opts();
    const payload = {
      messageId: parseInt(messageId),
      to: opts.to,
      body: opts.body || "",
    };

    if (opts.send) {
      payload.send = true;
    } else if (opts.open) {
      payload.open = true;
    } else {
      payload.draft = true;
    }

    const data = await api("POST", "/forward", payload, getTimeout(g));
    output(data, g.format, getOutputOpts(g));
  }));

// ─── Attachments ──────────────────────────────────────────────────────

program
  .command("attachments <messageId>")
  .description("List attachments for a message")
  .action(run(async (messageId) => {
    const g = program.opts();
    const data = await api("GET", `/messages/${messageId}/attachments`, null, getTimeout(g));
    output(data, g.format, getOutputOpts(g));
  }));

// ─── Attachment Download ──────────────────────────────────────────────

program
  .command("attachment-download <messageId> [partName]")
  .description("Download attachment(s) from a message")
  .option("--output <path>", "file path to write")
  .option("--all", "download all attachments")
  .option("--output-dir <dir>", "directory for --all downloads")
  .action(run(async (messageId, partName, opts) => {
    const g = program.opts();
    const timeout = getTimeout(g);
    const { writeFileSync, mkdirSync } = await import("fs");
    const { join } = await import("path");

    if (opts.all) {
      const attachments = await api("GET", `/messages/${messageId}/attachments`, null, timeout);
      const dir = opts.outputDir || ".";
      mkdirSync(dir, { recursive: true });
      const results = [];
      for (const att of attachments) {
        const data = await api("POST", `/messages/${messageId}/attachment`, { partName: att.partName }, timeout);
        const filePath = join(dir, att.name || att.partName);
        writeFileSync(filePath, Buffer.from(data.data, "base64"));
        results.push({ partName: att.partName, name: att.name, path: filePath });
      }
      output(results, g.format, getOutputOpts(g));
    } else {
      if (!partName) {
        outputError({ message: "Provide partName or use --all", code: "INVALID_ARGS" }, g.format);
        return;
      }
      const data = await api("POST", `/messages/${messageId}/attachment`, { partName }, timeout);
      if (opts.output) {
        writeFileSync(opts.output, Buffer.from(data.data, "base64"));
        output({ saved: opts.output, size: data.size }, g.format, getOutputOpts(g));
      } else {
        output(data, g.format, getOutputOpts(g));
      }
    }
  }));

// ─── Fetch ────────────────────────────────────────────────────────────

program
  .command("fetch [messageId]")
  .description("Fetch message content from server")
  .option("--folder <folderId>", "fetch messages in folder")
  .option("-l, --limit <n>", "limit for folder fetch")
  .action(run(async (messageId, opts) => {
    const g = program.opts();
    const body = {};
    if (messageId) {
      body.messageId = parseInt(messageId);
    } else if (opts.folder) {
      body.folderId = opts.folder;
      if (opts.limit) body.limit = parseInt(opts.limit);
    }
    const data = await api("POST", "/messages/fetch", body, getTimeout(g));
    output(data, g.format, getOutputOpts(g));
  }));

// ─── Download Status ──────────────────────────────────────────────────

program
  .command("download-status <messageId>")
  .description("Check download status of a message")
  .action(run(async (messageId) => {
    const g = program.opts();
    const data = await api("GET", `/messages/${messageId}/download-status`, null, getTimeout(g));
    output(data, g.format, getOutputOpts(g));
  }));

// ─── Contacts ─────────────────────────────────────────────────────────

program
  .command("contacts")
  .description("List address book contacts")
  .option("--book <bookId>", "limit to specific address book")
  .option("-l, --limit <n>", "max results")
  .action(run(async (opts) => {
    const g = program.opts();
    if (opts.book || opts.limit) {
      const body = {};
      if (opts.book) body.book = opts.book;
      if (opts.limit) body.limit = parseInt(opts.limit);
      const data = await api("POST", "/contacts/search", body, getTimeout(g));
      output(data, g.format, getOutputOpts(g));
    } else {
      const data = await api("GET", "/contacts", null, getTimeout(g));
      output(data, g.format, getOutputOpts(g));
    }
  }));

// ─── Contacts Search ─────────────────────────────────────────────────

program
  .command("contacts-search <query>")
  .description("Search contacts")
  .option("--book <bookId>", "limit to specific address book")
  .option("-l, --limit <n>", "max results")
  .action(run(async (query, opts) => {
    const g = program.opts();
    const body = { query };
    if (opts.book) body.book = opts.book;
    if (opts.limit) body.limit = parseInt(opts.limit);
    const data = await api("POST", "/contacts/search", body, getTimeout(g));
    output(data, g.format, getOutputOpts(g));
  }));

// ─── Contact ──────────────────────────────────────────────────────────

program
  .command("contact <contactId>")
  .description("Get contact details")
  .action(run(async (contactId) => {
    const g = program.opts();
    const data = await api("GET", `/contacts/${contactId}`, null, getTimeout(g));
    output(data, g.format, getOutputOpts(g));
  }));

// ─── Sync ─────────────────────────────────────────────────────────────

program
  .command("sync [folderId]")
  .description("Trigger folder sync")
  .option("--all", "sync all folders")
  .action(run(async (folderId, opts) => {
    const g = program.opts();
    const body = {};
    if (opts.all) {
      body.all = true;
    } else if (folderId) {
      body.folderId = folderId;
    }
    const data = await api("POST", "/sync", body, getTimeout(g));
    output(data, g.format, getOutputOpts(g));
  }));

// ─── Sync Status ──────────────────────────────────────────────────────

program
  .command("sync-status <folderId>")
  .description("Check sync status of a folder")
  .action(run(async (folderId) => {
    const g = program.opts();
    const data = await api("POST", "/sync/status", { folderId }, getTimeout(g));
    output(data, g.format, getOutputOpts(g));
  }));

// ─── Bulk Operations ─────────────────────────────────────────────────

const bulk = program.command("bulk").description("Bulk operations");

bulk
  .command("mark-read <folderId>")
  .description("Mark all messages in folder as read")
  .option("-l, --limit <n>", "batch size", "100")
  .action(run(async (folderId, opts) => {
    const g = program.opts();
    const timeout = getTimeout(g);
    const list = await api("POST", "/messages/list", {
      folderId,
      limit: parseInt(opts.limit),
      unreadOnly: true,
    }, timeout);

    const messages = list.messages || list;
    let marked = 0;
    for (const msg of messages) {
      await api("POST", "/messages/update", { messageId: msg.id, read: true }, timeout);
      marked++;
    }
    output({ success: true, marked }, g.format, getOutputOpts(g));
  }));

bulk
  .command("move <fromFolderId> <toFolderId>")
  .description("Move messages between folders")
  .option("--older-than <days>", "only messages older than N days")
  .option("--from <address>", "filter by sender")
  .option("--subject <pattern>", "filter by subject")
  .option("-l, --limit <n>", "batch size", "100")
  .action(run(async (fromFolderId, toFolderId, opts) => {
    const g = program.opts();
    const timeout = getTimeout(g);
    const list = await api("POST", "/messages/list", {
      folderId: fromFolderId,
      limit: parseInt(opts.limit),
    }, timeout);

    let toMove = list.messages || list;
    if (opts.olderThan) {
      const cutoff = new Date(Date.now() - parseInt(opts.olderThan) * 86400000);
      toMove = toMove.filter(m => new Date(m.date) < cutoff);
    }
    if (opts.from) {
      const addr = opts.from.toLowerCase();
      toMove = toMove.filter(m => (m.author || "").toLowerCase().includes(addr));
    }
    if (opts.subject) {
      const pat = new RegExp(opts.subject, "i");
      toMove = toMove.filter(m => pat.test(m.subject || ""));
    }

    if (toMove.length > 0) {
      const ids = toMove.map(m => m.id);
      await api("POST", "/messages/move", {
        messageIds: ids,
        destinationFolderId: toFolderId,
      }, timeout);
    }

    output({ success: true, moved: toMove.length }, g.format, getOutputOpts(g));
  }));

bulk
  .command("delete <folderId>")
  .description("Bulk delete messages in folder")
  .option("--older-than <days>", "only messages older than N days")
  .option("--from <address>", "filter by sender")
  .option("--subject <pattern>", "filter by subject")
  .option("--confirm", "required to confirm deletion")
  .option("-l, --limit <n>", "batch size", "100")
  .action(run(async (folderId, opts) => {
    const g = program.opts();
    const fmt = g.format;
    if (!opts.confirm) {
      outputError({ message: "Use --confirm for bulk delete", code: "INVALID_ARGS" }, fmt);
      return;
    }
    const timeout = getTimeout(g);
    const body = { folderId };
    if (opts.olderThan) body.olderThan = parseInt(opts.olderThan);
    if (opts.from) body.from = opts.from;
    if (opts.subject) body.subject = opts.subject;
    if (opts.limit) body.limit = parseInt(opts.limit);

    const data = await api("POST", "/bulk/delete", body, timeout);
    output(data, fmt, getOutputOpts(g));
  }));

bulk
  .command("tag <folderId> <tagKey>")
  .description("Bulk tag messages in folder")
  .option("--older-than <days>", "only messages older than N days")
  .option("--from <address>", "filter by sender")
  .option("--subject <pattern>", "filter by subject")
  .option("-l, --limit <n>", "batch size", "100")
  .action(run(async (folderId, tagKey, opts) => {
    const g = program.opts();
    const timeout = getTimeout(g);
    const body = { folderId, tagKey };
    if (opts.olderThan) body.olderThan = parseInt(opts.olderThan);
    if (opts.from) body.from = opts.from;
    if (opts.subject) body.subject = opts.subject;
    if (opts.limit) body.limit = parseInt(opts.limit);

    const data = await api("POST", "/bulk/tag", body, timeout);
    output(data, g.format, getOutputOpts(g));
  }));

bulk
  .command("fetch <folderId>")
  .description("Bulk fetch messages in folder")
  .option("-l, --limit <n>", "batch size")
  .action(run(async (folderId, opts) => {
    const g = program.opts();
    const body = { folderId };
    if (opts.limit) body.limit = parseInt(opts.limit);
    const data = await api("POST", "/bulk/fetch", body, getTimeout(g));
    output(data, g.format, getOutputOpts(g));
  }));

// ─── Parse & Run ──────────────────────────────────────────────────────

program.parseAsync(process.argv).catch(err => {
  outputError(err, program.opts().format);
});
