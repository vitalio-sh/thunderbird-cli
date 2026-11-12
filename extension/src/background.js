/**
 * Thunderbird AI Bridge — Background Script (v2)
 *
 * Pure WebExtension — no Experiment APIs.
 * Connects to local Node.js bridge via WebSocket.
 * Handles requests using messenger.* APIs.
 */

const WS_URL = "ws://127.0.0.1:7701";
// Reconnect backoff while the bridge is absent: 3s, 6s, 12s, then every 15s. Cuts idle wakeups
// without making a freshly started bridge wait long for the extension.
const RECONNECT_BASE_MS = 3000;
const RECONNECT_MAX_MS = 15000;
// Max per-message operations (each one or two messenger.* calls) in flight across all requests.
const IPC_CONCURRENCY = 8;
const BASE64_CHUNK_SIZE = 0x8000;

let ws = null;
let reconnectTimer = null;
let reconnectDelay = RECONNECT_BASE_MS;
let ipcInFlight = 0;
const ipcQueue = [];

// ─── WebSocket Connection ───────────────────────────────────────────

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  let socket;
  try {
    socket = new WebSocket(WS_URL);
  } catch (err) {
    console.log("[tb-ai] WebSocket create failed:", err.message);
    scheduleReconnect();
    return;
  }
  ws = socket;

  socket.onopen = () => {
    console.log("[tb-ai] Connected to bridge");
    reconnectDelay = RECONNECT_BASE_MS;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  socket.onmessage = async (event) => {
    let request;
    try {
      request = JSON.parse(event.data);
    } catch (e) {
      return;
    }

    try {
      const result = await handleRequest(request);
      socket.send(JSON.stringify({ id: request.id, result }));
    } catch (err) {
      socket.send(JSON.stringify({
        id: request.id,
        error: { message: err.message, stack: err.stack },
      }));
    }
  };

  // Only clear `ws` if it is still this socket: a late event from a replaced socket must not
  // drop the current connection.
  socket.onclose = () => {
    console.log("[tb-ai] Disconnected from bridge");
    if (ws === socket) ws = null;
    scheduleReconnect();
  };

  socket.onerror = () => {
    console.log("[tb-ai] WebSocket error, will reconnect");
    if (ws === socket) ws = null;
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = reconnectDelay;
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

// Start connection
connect();

// Coming back from idle or sleep: retry right away instead of waiting out the backoff.
if (typeof messenger !== "undefined" && messenger.idle?.onStateChanged) {
  messenger.idle.onStateChanged.addListener((state) => {
    if (state !== "active") return;
    reconnectDelay = RECONNECT_BASE_MS;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    connect();
  });
}

// ─── Request Router ─────────────────────────────────────────────────

async function handleRequest({ method, path, body }) {
  // Health
  if (path === "/health") {
    return { status: "ok", version: messenger.runtime.getManifest().version, thunderbird: true };
  }

  // ─── Accounts ───────────────────────────────────────────────────

  if (path === "/accounts" && method === "GET") {
    const accounts = await messenger.accounts.list(true);
    return accounts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      identities: a.identities?.map((id) => ({
        email: id.email, name: id.name, id: id.id,
      })),
      rootFolder: a.rootFolder
        ? { id: a.rootFolder.id, name: a.rootFolder.name }
        : null,
    }));
  }

  // Account by ID
  const acctMatch = path.match(/^\/accounts\/([^/]+)$/);
  if (acctMatch && method === "GET") {
    const account = await messenger.accounts.get(acctMatch[1], true);
    if (!account) return { error: "Account not found" };
    return account;
  }

  // Account folders
  const foldersMatch = path.match(/^\/accounts\/([^/]+)\/folders$/);
  if (foldersMatch && method === "GET") {
    const account = await messenger.accounts.get(foldersMatch[1], true);
    if (!account) return { error: "Account not found" };
    return await flattenFolders(account.rootFolder);
  }

  // ─── Identities ────────────────────────────────────────────────

  if (path === "/identities" && method === "GET") {
    const accounts = await messenger.accounts.list(true);
    const identities = [];
    for (const acct of accounts) {
      for (const id of (acct.identities || [])) {
        identities.push({ id: id.id, email: id.email, name: id.name, accountId: acct.id });
      }
    }
    return identities;
  }

  // ─── Folders ────────────────────────────────────────────────────

  if (path === "/folders/info" && method === "POST") {
    const { folderId } = body || {};
    const folder = await messenger.folders.get(folderId, false);
    if (!folder) return { error: "Folder not found" };
    let info = {};
    try { info = await messenger.folders.getFolderInfo(folder); } catch {}
    return {
      id: folder.id, name: folder.name, path: folder.path, type: folder.type,
      unreadMessageCount: info.unreadMessageCount || 0,
      totalMessageCount: info.totalMessageCount || 0,
      newMessageCount: info.newMessageCount || 0,
      accountId: folder.accountId,
    };
  }

  if (path === "/folders/create" && method === "POST") {
    const { parentFolderId, name } = body || {};
    const parent = await messenger.folders.get(parentFolderId, false);
    const newFolder = await messenger.folders.create(parent, name);
    return { success: true, folder: { id: newFolder.id, name: newFolder.name, path: newFolder.path } };
  }

  if (path === "/folders/rename" && method === "POST") {
    const { folderId, newName } = body || {};
    const folder = await messenger.folders.get(folderId, false);
    const renamed = await messenger.folders.rename(folder, newName);
    return { success: true, folder: { id: renamed.id, name: renamed.name, path: renamed.path } };
  }

  if (path === "/folders/delete" && method === "POST") {
    const { folderId } = body || {};
    const folder = await messenger.folders.get(folderId, false);
    await messenger.folders.delete(folder);
    return { success: true };
  }

  // ─── Search ─────────────────────────────────────────────────────

  if (path === "/messages/search" && method === "POST") {
    const { query, accountId, fromAddress, toAddress, subject,
            unreadOnly, flagged, limit = 25, fromDate, toDate,
            folderId, tag, hasAttachment, sizeMin, sizeMax,
            includeJunk, headerMessageId, searchMode = "fulltext" } = body || {};
    const q = {};
    // fullText uses Thunderbird's global search index (subject, body, author) and is fast on
    // large mailboxes; body scans message bodies and can time out there.
    let mode = query ? (searchMode === "body" ? "body" : "fulltext") : null;
    if (mode === "fulltext") q.fullText = query;
    if (mode === "body") q.body = query;
    if (accountId) q.accountId = accountId;
    if (fromAddress) q.author = fromAddress;
    if (toAddress) q.recipients = toAddress;
    if (subject) q.subject = subject;
    if (headerMessageId) q.headerMessageId = stripAngleBrackets(headerMessageId);
    if (unreadOnly) q.unread = true;
    if (flagged !== undefined) q.flagged = flagged;
    if (fromDate) q.fromDate = new Date(fromDate);
    if (toDate) q.toDate = new Date(toDate);
    if (folderId) q.folderId = folderId;
    if (hasAttachment) q.attachment = true;
    if (!includeJunk) q.junk = false;

    let result;
    try {
      result = await collectMessages(() => messenger.messages.query(q), limit);
    } catch (e) {
      if (mode !== "fulltext") throw e;
      // Older Thunderbird without fullText support: fall back to a body scan.
      delete q.fullText;
      q.body = query;
      mode = "body";
      result = await collectMessages(() => messenger.messages.query(q), limit);
    }
    if (mode) result.searchMode = mode;

    // Client-side filtering for tag, sizeMin, sizeMax
    if (tag || sizeMin || sizeMax) {
      result.messages = result.messages.filter((msg) => {
        if (tag && !(msg.tags || []).includes(tag)) return false;
        if (sizeMin && (msg.size || 0) < sizeMin) return false;
        if (sizeMax && (msg.size || 0) > sizeMax) return false;
        return true;
      });
      result.total = result.messages.length;
    }

    return result;
  }

  // ─── List messages in folder ────────────────────────────────────

  if (path === "/messages/list" && method === "POST") {
    const { folderId, limit = 25, unreadOnly = false,
            offset = 0, sort, sortOrder = "desc", flagged } = body || {};
    const folder = await messenger.folders.get(folderId, false);
    if (!folder) return { error: "Folder not found" };
    const filters = { unreadOnly, flaggedOnly: flagged || false };

    if (!sort) {
      return await collectMessages(
        () => messenger.messages.list(folder), limit, { ...filters, offset }
      );
    }

    // Thunderbird lists messages in database order, not by date, so sorting has to see the
    // whole (filtered) folder before offset/limit are applied — otherwise the "newest" page
    // is just the first N messages re-ordered.
    const all = await collectMessages(
      () => messenger.messages.list(folder), Infinity, { ...filters, offset: 0 }
    );
    const dir = sortOrder === "asc" ? 1 : -1;
    all.messages.sort((a, b) => {
      if (sort === "date") return dir * (new Date(a.date) - new Date(b.date));
      if (sort === "from") return dir * (a.author || "").localeCompare(b.author || "");
      if (sort === "subject") return dir * (a.subject || "").localeCompare(b.subject || "");
      if (sort === "size") return dir * ((a.size || 0) - (b.size || 0));
      return 0;
    });
    const messages = all.messages.slice(offset, offset + limit);
    return { messages, total: messages.length, offset, hasMore: offset + limit < all.messages.length };
  }

  // ─── Read batch ─────────────────────────────────────────────────

  if (path === "/messages/read-batch" && method === "POST") {
    const { messageIds } = body || {};
    return await mapWithIpcLimit(messageIds || [], async (id) => {
      try {
        const [msg, full] = await Promise.all([
          messenger.messages.get(id),
          messenger.messages.getFull(id),
        ]);
        return { ...formatMessage(msg), parts: extractParts(full) };
      } catch (e) {
        return { id, error: e.message };
      }
    });
  }

  // ─── Fetch (force download) ─────────────────────────────────────

  if (path === "/messages/fetch" && method === "POST") {
    if (body.messageId) {
      const raw = await messenger.messages.getRaw(body.messageId);
      return { downloaded: true, size: typeof raw === "string" ? raw.length : 0 };
    }
    if (body.folderId) {
      const folder = await messenger.folders.get(body.folderId, false);
      const result = await collectMessages(() => messenger.messages.list(folder), body.limit || 100);
      const fetched = await fetchRawAll(result.messages);
      return { fetched, total: result.messages.length };
    }
    return { error: "Provide messageId or folderId" };
  }

  // ─── Archive ────────────────────────────────────────────────────

  if (path === "/messages/archive" && method === "POST") {
    const { messageIds } = body || {};
    await messenger.messages.archive(messageIds);
    return { success: true, archived: messageIds.length };
  }

  // ─── Move ───────────────────────────────────────────────────────

  if (path === "/messages/move" && method === "POST") {
    const { messageIds, destinationFolderId } = body;
    const folder = await messenger.folders.get(destinationFolderId, false);
    await messenger.messages.move(messageIds, folder);
    return { success: true, moved: messageIds.length };
  }

  // ─── Copy ───────────────────────────────────────────────────────

  if (path === "/messages/copy" && method === "POST") {
    const { messageIds, destinationFolderId } = body;
    const folder = await messenger.folders.get(destinationFolderId, false);
    await messenger.messages.copy(messageIds, folder);
    return { success: true, copied: messageIds.length };
  }

  // ─── Delete ─────────────────────────────────────────────────────

  if (path === "/messages/delete" && method === "POST") {
    const { messageIds, permanent = false } = body;
    await messenger.messages.delete(messageIds, permanent);
    return { success: true, deleted: messageIds.length };
  }

  // ─── Update (mark read/flagged/junk/tags) ───────────────────────

  if (path === "/messages/update" && method === "POST") {
    const { messageId, read, flagged, junk, tags } = body;
    const props = {};
    if (read !== undefined) props.read = read;
    if (flagged !== undefined) props.flagged = flagged;
    if (junk !== undefined) props.junk = junk;
    if (tags !== undefined) props.tags = tags;
    await messenger.messages.update(messageId, props);
    return { success: true };
  }

  // ─── Message sub-routes (order matters: specific before generic) ─

  // Raw message
  const rawMatch = path.match(/^\/messages\/(\d+)\/raw$/);
  if (rawMatch && method === "GET") {
    const raw = await messenger.messages.getRaw(parseInt(rawMatch[1]));
    return { raw };
  }

  // Headers only
  const headersMatch = path.match(/^\/messages\/(\d+)\/headers$/);
  if (headersMatch && method === "GET") {
    const msgId = parseInt(headersMatch[1]);
    const msg = await messenger.messages.get(msgId);
    return formatMessage(msg);
  }

  // Full read including HTML
  const fullMatch = path.match(/^\/messages\/(\d+)\/full$/);
  if (fullMatch && method === "GET") {
    const msgId = parseInt(fullMatch[1]);
    const msg = await messenger.messages.get(msgId);
    const full = await messenger.messages.getFull(msgId);
    const parts = extractParts(full);
    return { ...formatMessage(msg), parts };
  }

  // Check download state
  const checkDlMatch = path.match(/^\/messages\/(\d+)\/check-download$/);
  if (checkDlMatch && method === "GET") {
    const msgId = parseInt(checkDlMatch[1]);
    const msg = await messenger.messages.get(msgId);
    let downloadState = "unknown";
    try {
      const full = await messenger.messages.getFull(msgId);
      const parts = extractParts(full);
      downloadState = (parts.text || parts.html) ? "full" : "headers_only";
    } catch {
      downloadState = "headers_only";
    }
    return {
      id: msg.id, downloadState, size: msg.size,
      hasBody: downloadState === "full",
      hasAttachments: false,
    };
  }

  // Download status
  const dlStatusMatch = path.match(/^\/messages\/(\d+)\/download-status$/);
  if (dlStatusMatch && method === "GET") {
    const msgId = parseInt(dlStatusMatch[1]);
    const msg = await messenger.messages.get(msgId);
    let state = "headers_only";
    try {
      const full = await messenger.messages.getFull(msgId);
      const parts = extractParts(full);
      if (parts.text || parts.html) state = "full";
    } catch { /* headers_only */ }
    return { state, size: msg.size };
  }

  // Attachments list
  const attachmentsMatch = path.match(/^\/messages\/(\d+)\/attachments$/);
  if (attachmentsMatch && method === "GET") {
    const msgId = parseInt(attachmentsMatch[1]);
    const full = await messenger.messages.getFull(msgId);
    const parts = extractParts(full);
    return parts.attachments;
  }

  // Download specific attachment
  const attachmentMatch = path.match(/^\/messages\/(\d+)\/attachment$/);
  if (attachmentMatch && method === "POST") {
    const msgId = parseInt(attachmentMatch[1]);
    const { partName } = body || {};
    const file = await messenger.messages.getAttachmentFile(msgId, partName);
    const buffer = await file.arrayBuffer();
    const base64 = bytesToBase64(new Uint8Array(buffer));
    return { name: file.name, size: file.size, contentType: file.type, data: base64 };
  }

  // Thread
  const threadMatch = path.match(/^\/messages\/(\d+)\/thread$/);
  if (threadMatch && method === "GET") {
    const msgId = parseInt(threadMatch[1]);
    const msg = await messenger.messages.get(msgId);

    // getFull() does not reliably expose RFC 2822 headers; parse them from the raw source.
    let ids = new Set();
    try {
      const raw = await messenger.messages.getRaw(msgId);
      if (typeof raw === "string") ids = buildThreadIds(raw);
    } catch {}
    if (ids.size === 0) {
      try {
        const full = await messenger.messages.getFull(msgId);
        const header = (name) => full.headers?.[name]?.[0] || "";
        ids = new Set([
          ...parseReferences(header("references")),
          ...parseReferences(header("in-reply-to")),
          stripAngleBrackets(header("message-id")),
        ].filter(Boolean));
      } catch {}
    }
    // messages.query() matches headerMessageId without angle brackets
    if (msg?.headerMessageId) ids.add(stripAngleBrackets(msg.headerMessageId));

    const seen = new Set();
    const thread = [];
    const add = (m, threadMatch) => {
      if (seen.has(m.id)) return;
      seen.add(m.id);
      thread.push({ ...formatMessage(m), threadMatch });
    };

    // Upstream: every message named in References / In-Reply-To
    const pages = await mapWithIpcLimit([...ids], async (hdrId) => {
      try {
        return (await messenger.messages.query({ headerMessageId: hdrId }))?.messages || [];
      } catch {
        return [];
      }
    });
    for (const messages of pages) messages.forEach((m) => add(m, "references"));

    // Downstream: replies that don't reference this message yet share its normalized subject.
    // Thunderbird's subject query is a substring match, so keep exact matches only; these are
    // heuristic, so they are labelled and junk is excluded.
    const norm = normalizeSubject(msg?.subject || "");
    if (norm) {
      try {
        const r = await messenger.messages.query({ subject: norm, junk: false });
        for (const m of r?.messages || []) {
          if (normalizeSubject(m.subject || "").toLowerCase() === norm.toLowerCase()) add(m, "subject");
        }
      } catch {}
    }

    thread.sort((a, b) => new Date(a.date) - new Date(b.date));
    return { thread, count: thread.length };
  }

  // Read message (default — must be AFTER all /messages/:id/* sub-routes)
  const msgMatch = path.match(/^\/messages\/(\d+)$/);
  if (msgMatch && method === "GET") {
    const msgId = parseInt(msgMatch[1]);
    const msg = await messenger.messages.get(msgId);
    if (!msg) return { error: "Message not found" };
    const full = await messenger.messages.getFull(msgId);
    return { ...formatMessage(msg), parts: extractParts(full) };
  }

  // ─── Tags ───────────────────────────────────────────────────────

  if (path === "/tags" && method === "GET") {
    return await messenger.messages.listTags();
  }

  if (path === "/tags/create" && method === "POST") {
    const { key, tag, color } = body || {};
    await messenger.messages.createTag(key, tag, color);
    return { success: true, key, tag, color };
  }

  // ─── Compose ────────────────────────────────────────────────────

  if (path === "/compose" && method === "POST") {
    const { to, cc, bcc, subject, body: msgBody, isHTML = false,
            identityId, send = false, draft = false, open = false,
            priority } = body;
    const details = {};
    if (to) details.to = Array.isArray(to) ? to : [to];
    if (cc) details.cc = Array.isArray(cc) ? cc : [cc];
    if (bcc) details.bcc = Array.isArray(bcc) ? bcc : [bcc];
    if (subject) details.subject = subject;
    if (isHTML) { details.isPlainText = false; details.body = msgBody; }
    else { details.isPlainText = true; details.plainTextBody = msgBody; }
    if (identityId) details.identityId = identityId;
    if (priority) details.customHeaders = [{ name: "X-Priority", value: priorityToValue(priority) }];
    const tab = await messenger.compose.beginNew(null, details);
    if (send) {
      await messenger.compose.sendMessage(tab.id, { mode: "sendNow" });
      return { success: true, action: "sent" };
    }
    if (open) {
      return { success: true, action: "draft_opened", tabId: tab.id };
    }
    // Default: save as draft and close
    await messenger.compose.saveMessage(tab.id, { mode: "draft" });
    await messenger.tabs.remove(tab.id);
    return { success: true, action: "draft_saved" };
  }

  // ─── Reply ──────────────────────────────────────────────────────

  if (path === "/reply" && method === "POST") {
    const { messageId, body: replyBody, replyAll = false,
            send = false, draft = false, open = false } = body;
    const type = replyAll ? "replyToAll" : "replyToSender";
    const tab = await messenger.compose.beginReply(messageId, type, {
      isPlainText: true, plainTextBody: replyBody,
    });
    if (send) {
      await messenger.compose.sendMessage(tab.id, { mode: "sendNow" });
      return { success: true, action: "sent" };
    }
    if (open) {
      return { success: true, action: "draft_opened", tabId: tab.id };
    }
    // Default: save as draft and close
    await messenger.compose.saveMessage(tab.id, { mode: "draft" });
    await messenger.tabs.remove(tab.id);
    return { success: true, action: "draft_saved" };
  }

  // ─── Forward ────────────────────────────────────────────────────

  if (path === "/forward" && method === "POST") {
    const { messageId, to, body: fwdBody,
            send = false, draft = false, open = false } = body;
    const tab = await messenger.compose.beginForward(
      messageId, "forwardAsAttachment",
      { to: Array.isArray(to) ? to : [to], isPlainText: true, plainTextBody: fwdBody || "" }
    );
    if (send) {
      await messenger.compose.sendMessage(tab.id, { mode: "sendNow" });
      return { success: true, action: "sent" };
    }
    if (open) {
      return { success: true, action: "draft_opened", tabId: tab.id };
    }
    // Default: save as draft and close
    await messenger.compose.saveMessage(tab.id, { mode: "draft" });
    await messenger.tabs.remove(tab.id);
    return { success: true, action: "draft_saved" };
  }

  // ─── Stats (GET — legacy) ──────────────────────────────────────

  if (path === "/stats" && method === "GET") {
    const accounts = await messenger.accounts.list(true);
    const stats = [];
    for (const account of accounts) {
      const s = { id: account.id, name: account.name, type: account.type,
        email: account.identities?.[0]?.email || "unknown",
        folders: 0, unreadTotal: 0, messageTotal: 0 };
      if (account.rootFolder) await countFolder(account.rootFolder, s);
      stats.push(s);
    }
    return {
      totalAccounts: stats.length,
      totalUnread: stats.reduce((s, a) => s + a.unreadTotal, 0),
      totalMessages: stats.reduce((s, a) => s + a.messageTotal, 0),
      accounts: stats,
    };
  }

  // ─── Stats (POST — enhanced) ───────────────────────────────────

  if (path === "/stats" && method === "POST") {
    const accounts = await messenger.accounts.list(true);
    let accts = accounts;
    if (body && body.accountId) accts = accounts.filter((a) => a.id === body.accountId);
    const stats = [];
    for (const account of accts) {
      const s = { id: account.id, name: account.name, type: account.type,
        email: account.identities?.[0]?.email || "unknown",
        folders: 0, unreadTotal: 0, messageTotal: 0 };
      if (body && body.folders && account.rootFolder) {
        s.folderDetails = await flattenFolders(account.rootFolder);
      }
      if (account.rootFolder) await countFolder(account.rootFolder, s);
      stats.push(s);
    }
    return {
      totalAccounts: stats.length,
      totalUnread: stats.reduce((s, a) => s + a.unreadTotal, 0),
      totalMessages: stats.reduce((s, a) => s + a.messageTotal, 0),
      accounts: stats,
    };
  }

  // ─── Recent ─────────────────────────────────────────────────────

  if (path === "/recent" && method === "POST") {
    const { hours = 24, limit = 50, accountId, unreadOnly = false } = body || {};
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const result = await collectMessages(
      () => messenger.messages.query({ fromDate: since }), limit,
      { unreadOnly, accountId: accountId || null }
    );
    result.messages.sort((a, b) => new Date(b.date) - new Date(a.date));
    result.since = since.toISOString();
    return result;
  }

  // ─── Contacts search (must be before /contacts/:id) ─────────────

  if (path === "/contacts/search" && method === "POST") {
    const { query, book, limit: contactLimit } = body || {};
    const books = await messenger.addressBooks.list();
    const all = [];
    for (const b of books) {
      if (book && b.id !== book && b.name !== book) continue;
      const contacts = await messenger.contacts.list(b.id);
      for (const c of contacts) {
        const name = c.properties?.DisplayName || "";
        const email = c.properties?.PrimaryEmail || "";
        if (query) {
          const q = query.toLowerCase();
          if (!name.toLowerCase().includes(q) && !email.toLowerCase().includes(q)) continue;
        }
        all.push({ id: c.id, name, email, book: b.name });
        if (contactLimit && all.length >= contactLimit) break;
      }
      if (contactLimit && all.length >= contactLimit) break;
    }
    return all;
  }

  // ─── Contacts list ──────────────────────────────────────────────

  if (path === "/contacts" && method === "GET") {
    const books = await messenger.addressBooks.list();
    const all = [];
    for (const book of books) {
      const contacts = await messenger.contacts.list(book.id);
      for (const c of contacts) {
        all.push({
          id: c.id, name: c.properties?.DisplayName || "",
          email: c.properties?.PrimaryEmail || "", book: book.name,
        });
      }
    }
    return all;
  }

  // ─── Contact by ID ─────────────────────────────────────────────

  const contactMatch = path.match(/^\/contacts\/([^/]+)$/);
  if (contactMatch && method === "GET") {
    const contactId = contactMatch[1];
    const contact = await messenger.contacts.get(contactId);
    return { id: contact.id, properties: contact.properties };
  }

  // ─── Sync ───────────────────────────────────────────────────────

  if (path === "/sync" && method === "POST") {
    if (body && body.all) {
      const accounts = await messenger.accounts.list(true);
      for (const acct of accounts) {
        if (acct.rootFolder) await messenger.folders.getSubFolders(acct.rootFolder, false);
      }
      return { success: true, synced: "all" };
    }
    if (body && body.folderId) {
      const folder = await messenger.folders.get(body.folderId, false);
      await messenger.folders.getSubFolders(folder, false);
      return { success: true, synced: body.folderId };
    }
    return { error: "Provide folderId or all: true" };
  }

  if (path === "/sync/status" && method === "POST") {
    const folder = await messenger.folders.get(body.folderId, false);
    return {
      folderId: folder.id, totalMessages: folder.totalMessageCount,
      unread: folder.unreadMessageCount, type: folder.type, name: folder.name,
    };
  }

  // ─── Bulk operations ───────────────────────────────────────────

  if (path === "/bulk/delete" && method === "POST") {
    const folder = await messenger.folders.get(body.folderId, false);
    const result = await collectMessages(() => messenger.messages.list(folder), body.limit || 100);
    const filtered = filterBulkMessages(result.messages, body);
    if (filtered.length > 0) {
      await messenger.messages.delete(filtered.map((m) => m.id), false);
    }
    return { success: true, deleted: filtered.length };
  }

  if (path === "/bulk/tag" && method === "POST") {
    const folder = await messenger.folders.get(body.folderId, false);
    const result = await collectMessages(() => messenger.messages.list(folder), body.limit || 100);
    const toTag = filterBulkMessages(result.messages, body)
      .filter((msg) => !(msg.tags || []).includes(body.tagKey));
    await mapWithIpcLimit(toTag, (msg) =>
      messenger.messages.update(msg.id, { tags: [...(msg.tags || []), body.tagKey] })
    );
    return { success: true, tagged: toTag.length };
  }

  if (path === "/bulk/fetch" && method === "POST") {
    const folder = await messenger.folders.get(body.folderId, false);
    const result = await collectMessages(() => messenger.messages.list(folder), body.limit || 100);
    const fetched = await fetchRawAll(result.messages);
    return { success: true, fetched, total: result.messages.length };
  }

  // ─── Not found ─────────────────────────────────────────────────

  return { error: `Not found: ${method} ${path}` };
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatMessage(msg) {
  return {
    id: msg.id,
    date: msg.date?.toISOString(),
    author: msg.author,
    subject: msg.subject,
    read: msg.read,
    flagged: msg.flagged,
    junk: msg.junk,
    size: msg.size,
    tags: msg.tags || [],
    folder: msg.folder
      ? { accountId: msg.folder.accountId, path: msg.folder.path, name: msg.folder.name }
      : null,
    recipients: msg.recipients,
    ccList: msg.ccList,
    bccList: msg.bccList,
    headerMessageId: msg.headerMessageId,
  };
}

function extractParts(part, result = { text: "", html: "", attachments: [] }) {
  if (!part) return result;
  const ct = (part.contentType || "").toLowerCase();
  if (ct === "text/plain" && part.body) result.text += part.body;
  else if (ct === "text/html" && part.body) result.html += part.body;
  else if (part.name || (ct && !ct.startsWith("multipart/"))) {
    if (part.partName && ct !== "text/plain" && ct !== "text/html") {
      result.attachments.push({
        name: part.name || "unnamed", contentType: ct,
        partName: part.partName, size: part.size,
      });
    }
  }
  if (part.parts) for (const sub of part.parts) extractParts(sub, result);
  return result;
}

async function flattenFolders(folder, depth = 0) {
  let info = {};
  try { info = await messenger.folders.getFolderInfo(folder); } catch {}
  const result = [{
    id: folder.id, name: folder.name, path: folder.path,
    type: folder.type,
    unreadMessageCount: info.unreadMessageCount || 0,
    totalMessageCount: info.totalMessageCount || 0,
    depth,
  }];
  if (folder.subFolders) {
    for (const sub of folder.subFolders) {
      result.push(...await flattenFolders(sub, depth + 1));
    }
  }
  return result;
}

async function countFolder(folder, stats) {
  stats.folders++;
  let info = {};
  try { info = await messenger.folders.getFolderInfo(folder); } catch {}
  stats.unreadTotal += info.unreadMessageCount || 0;
  stats.messageTotal += info.totalMessageCount || 0;
  if (folder.subFolders) {
    for (const sub of folder.subFolders) await countFolder(sub, stats);
  }
}

async function collectMessages(queryFn, limit, { unreadOnly = false, flaggedOnly = false, offset = 0, accountId = null } = {}) {
  let page = await queryFn();
  const messages = [];
  let skipped = 0;
  while (page && messages.length < limit) {
    for (const msg of page.messages) {
      if (unreadOnly && msg.read) continue;
      if (flaggedOnly && !msg.flagged) continue;
      if (accountId && msg.folder?.accountId !== accountId) continue;
      if (skipped < offset) { skipped++; continue; }
      messages.push(formatMessage(msg));
      if (messages.length >= limit) break;
    }
    if (page.id && messages.length < limit) {
      page = await messenger.messages.continueList(page.id);
    } else break;
  }
  return { messages, total: messages.length, offset, hasMore: !!page?.id };
}

function filterBulkMessages(messages, filters) {
  let result = messages;
  if (filters.olderThan) {
    const cutoff = new Date(Date.now() - parseInt(filters.olderThan) * 86400000);
    result = result.filter((m) => new Date(m.date) < cutoff);
  }
  if (filters.from) {
    const from = filters.from.toLowerCase();
    result = result.filter((m) => (m.author || "").toLowerCase().includes(from));
  }
  if (filters.subject) {
    const subj = filters.subject.toLowerCase();
    result = result.filter((m) => (m.subject || "").toLowerCase().includes(subj));
  }
  return result;
}

function priorityToValue(priority) {
  const map = { highest: "1", high: "2", normal: "3", low: "4", lowest: "5" };
  return map[priority] || "3";
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK_SIZE));
  }
  return btoa(binary);
}

/** Force-download each message; resolves to how many succeeded. */
async function fetchRawAll(messages) {
  const results = await mapWithIpcLimit(messages, async (msg) => {
    try {
      await messenger.messages.getRaw(msg.id);
      return true;
    } catch {
      return false;
    }
  });
  return results.filter(Boolean).length;
}

/**
 * Map items through an async fn, preserving order, with at most IPC_CONCURRENCY calls in
 * flight across every concurrent request so bulk work can't flood Thunderbird.
 */
function mapWithIpcLimit(items, fn) {
  return Promise.all(items.map((item) => new Promise((resolve, reject) => {
    ipcQueue.push({ run: () => fn(item), resolve, reject });
    drainIpcQueue();
  })));
}

function drainIpcQueue() {
  while (ipcInFlight < IPC_CONCURRENCY && ipcQueue.length > 0) {
    const { run, resolve, reject } = ipcQueue.shift();
    ipcInFlight++;
    Promise.resolve()
      .then(run)
      .then(resolve, reject)
      .finally(() => {
        ipcInFlight--;
        drainIpcQueue();
      });
  }
}
