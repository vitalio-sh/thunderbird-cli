// Shared by the add-on and XPI builder (via Node's vm); no client-side policy.
const ACCESS_DEFAULTS = Object.freeze({
  downloadAttachments: true,
  compose: true,
  send: false,
  move: false,
  copy: false,
  archive: false,
  mark: false,
  tag: false,
  tagCreate: false,
  folderCreate: false,
  folderRename: false,
});

function normalizeAccessPolicy(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("INVALID_ARGS: access config must be a JSON object");
  }
  for (const [key, value] of Object.entries(config)) {
    if (!Object.hasOwn(ACCESS_DEFAULTS, key)) throw new Error(`INVALID_ARGS: unknown access setting '${key}'`);
    if (typeof value !== "boolean") throw new Error(`INVALID_ARGS: access setting '${key}' must be boolean`);
  }
  const policy = { ...ACCESS_DEFAULTS, ...config };
  if (policy.send && !policy.compose) throw new Error("INVALID_ARGS: send requires compose=true");
  return Object.freeze(policy);
}

const ACCESS_POLICY = normalizeAccessPolicy(globalThis.TB_ACCESS_CONFIG);

function accessPermissions(policy) {
  const permissions = ["accountsRead", "addressBooks", "messagesRead", "idle", "tabs"];
  if (policy.compose) permissions.push("compose", "compose.save");
  if (policy.send) permissions.push("compose.send");
  if (policy.move || policy.copy || policy.archive) permissions.push("messagesMove");
  if (policy.mark || policy.tag) permissions.push("messagesUpdate");
  if (policy.tagCreate) permissions.push("messagesTags");
  if (policy.folderCreate || policy.folderRename) permissions.push("accountsFolders");
  return permissions;
}

const READ_POST_PATHS = new Set([
  "/folders/info", "/messages/search", "/messages/list", "/messages/read-batch",
  "/messages/fetch", "/stats", "/recent", "/contacts/search", "/sync/status", "/bulk/fetch",
]);
const WRITE_PATHS = Object.freeze({
  "/messages/move": "move", "/messages/copy": "copy", "/messages/archive": "archive",
  "/bulk/tag": "tag",
  "/tags/create": "tagCreate", "/folders/create": "folderCreate",
  "/folders/rename": "folderRename",
});

function authorizeRequest(method, path, body = {}) {
  const requireAccess = key => {
    if (!ACCESS_POLICY[key]) throw Object.assign(new Error(`FORBIDDEN: access setting '${key}' is disabled`), { code: "FORBIDDEN" });
  };
  if (method === "GET" && /^\/compose\/\d+$/.test(path)) {
    requireAccess("compose");
    return;
  }
  if (method === "GET" && /^\/(health|access|accounts(?:\/[^/]+(?:\/folders)?)?|identities|stats|tags|contacts(?:\/[^/]+)?|messages\/\d+(?:\/(raw|headers|full|check-download|download-status|attachments|thread))?)$/.test(path)) return;
  if (method === "POST" && READ_POST_PATHS.has(path)) return;
  if (method === "POST" && /^\/messages\/\d+\/attachment$/.test(path)) {
    requireAccess("downloadAttachments");
    return;
  }
  // Sync has no implementation and must report that, not suggest a permission can enable it.
  if (method === "POST" && path === "/sync") return;
  if (method === "POST" && ["/compose", "/reply", "/forward"].includes(path)) {
    requireAccess("compose");
    if (body?.send) requireAccess("send");
    return;
  }
  if (method === "POST" && path === "/messages/update") {
    if (body?.tags !== undefined) requireAccess("tag");
    if (["read", "flagged", "junk"].some(key => body?.[key] !== undefined)) requireAccess("mark");
    if (!["read", "flagged", "junk", "tags"].some(key => body?.[key] !== undefined)) {
      throw new Error("INVALID_ARGS: no message properties to update");
    }
    return;
  }
  if (method === "POST" && Object.hasOwn(WRITE_PATHS, path)) {
    requireAccess(WRITE_PATHS[path]);
    return;
  }
  // Newly added handlers stay inaccessible until explicitly classified here.
  throw Object.assign(new Error(`FORBIDDEN: unclassified operation ${method} ${path}`), { code: "FORBIDDEN" });
}
