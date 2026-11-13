#!/usr/bin/env node
/**
 * CLI regression tests: runs the real `tb` CLI against a stub bridge that records requests.
 * Covers input validation, error payloads, bulk move filtering, reply --html, attachment
 * export safety and --max-body truncation.
 */

import { createServer } from "http";
import { spawn } from "child_process";
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync, existsSync, mkdirSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 19760;
const HOME = mkdtempSync(join(tmpdir(), "tb-cli-test-"));
let passed = 0, failed = 0;
function test(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`); }
}

const requests = [];
let listResponse = { messages: [], total: 0, bulkFiltersApplied: true };
const server = createServer(async (req, res) => {
  let raw = "";
  for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : null;
  requests.push({ method: req.method, path: req.url, body });
  res.setHeader("Content-Type", "application/json");
  const reply = (data, status = 200) => { res.writeHead(status); res.end(JSON.stringify(data)); };
  if (req.url === "/folders/info") return reply({ error: "Folder not found" });
  if (req.url === "/messages/list") return reply(listResponse);
  if (req.url === "/messages/move") return reply({ success: true, moved: body.messageIds.length });
  if (req.url === "/reply") return reply({ success: true, action: "draft_saved" });
  if (req.url === "/compose" || req.url === "/forward") return reply({ success: true, action: "draft_saved" });
  if (req.url === "/messages/7/attachments") return reply([{ name: "../../evil.txt", partName: "1.2" }]);
  if (req.url === "/messages/7/attachment") return reply({ name: "x", size: 5, data: Buffer.from("hello").toString("base64") });
  if (req.url === "/messages/7/full") return reply({ id: 7, parts: { text: "t".repeat(50), html: "h".repeat(50) } });
  if (req.url === "/messages/7/raw") return reply({ raw: "r".repeat(50) });
  return reply({ error: `Not found: ${req.method} ${req.url}` });
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

function tb(...args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [join(ROOT, "cli/src/cli.js"), ...args], {
      env: { ...process.env, HOME, TB_BRIDGE_HOST: "127.0.0.1", TB_BRIDGE_PORT: String(PORT), TB_AUTH_TOKEN: "",
        TB_ATTACH_DIR: join(HOME, "outbox") },
    });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => {
      let json = null;
      try { json = JSON.parse(out || err); } catch {}
      resolve({ code, out, err, json });
    });
  });
}
const since = () => { const n = requests.length; return () => requests.slice(n); };

console.log("\n\x1b[1mInput validation\x1b[0m");
for (const bad of ["abc", "1.5", "-3", "0", "1/../compose"]) {
  const seen = since();
  const r = await tb("read", bad);
  test(`read rejects message ID ${JSON.stringify(bad)} without a request`, r.code !== 0 && seen().length === 0, r.out + r.err);
}
const seenIds = since();
const mixed = await tb("mark", "1,x", "--read");
test("comma-separated IDs are validated", mixed.code !== 0 && seenIds().length === 0);
const badLimit = await tb("bulk", "move", "f1", "f2", "--limit", "ten");
test("bulk --limit must be an integer", badLimit.code !== 0);

console.log("\n\x1b[1mError payloads\x1b[0m");
const notFound = await tb("folder-info", "nope");
test("HTTP-200 error payload exits non-zero", notFound.code !== 0, notFound.out);
test("…and is reported as NOT_FOUND", /NOT_FOUND/.test(notFound.out + notFound.err), notFound.out + notFound.err);

console.log("\n\x1b[1mBulk move\x1b[0m");
listResponse = { messages: [{ id: 11 }, { id: 12 }], total: 2, bulkFiltersApplied: true };
let seen = since();
const moved = await tb("bulk", "move", "f1", "f2", "--older-than", "0", "--from", "x@y", "--subject", "^Re", "--limit", "2");
const listReq = seen().find((q) => q.path === "/messages/list");
test("filters are sent to the extension", listReq?.body.olderThan === 0 && listReq.body.from === "x@y" &&
  listReq.body.subjectPattern === "^Re" && listReq.body.limit === 2, JSON.stringify(listReq?.body));
test("returned matches are moved", moved.json?.data?.moved === 2 || moved.json?.moved === 2, moved.out);
listResponse = { messages: [{ id: 11 }], total: 1 };
seen = since();
const legacy = await tb("bulk", "move", "f1", "f2", "--from", "x@y");
test("refuses to move when the extension does not confirm filtering",
  legacy.code !== 0 && !seen().some((q) => q.path === "/messages/move"), legacy.out + legacy.err);

console.log("\n\x1b[1mReply\x1b[0m");
seen = since();
await tb("reply", "5", "--body", "<b>hi</b>", "--html");
test("reply --html sends isHTML", seen().find((q) => q.path === "/reply")?.body.isHTML === true);

console.log("\n\x1b[1mAttachment export\x1b[0m");
const dir = join(HOME, "dl");
const first = await tb("attachment-download", "7", "--all", "--output-dir", dir);
const saved = join(dir, "evil.txt");
test("sender path segments are stripped", first.code === 0 && existsSync(saved) && !existsSync(join(HOME, "evil.txt")), first.out + first.err);
test("saved file is private (0600)", existsSync(saved) && (statSync(saved).mode & 0o777) === 0o600);
writeFileSync(saved, "keep me");
const second = await tb("attachment-download", "7", "--all", "--output-dir", dir);
test("existing files are not overwritten", second.code !== 0 && readFileSync(saved, "utf8") === "keep me");

console.log("\n\x1b[1m--max-body\x1b[0m");
const full = await tb("--max-body", "10", "read", "7", "--full");
const fullData = full.json?.data ?? full.json;
test("HTML part is truncated", fullData?.parts?.htmlTruncated === true && fullData.parts.html.startsWith("hhhhhhhhhh\n"), full.out.slice(0, 200));
const raw = await tb("--max-body", "10", "read", "7", "--raw");
const rawData = raw.json?.data ?? raw.json;
test("raw source is truncated", rawData?.rawTruncated === true || /\.\.\.\[truncated\]/.test(raw.out), raw.out.slice(0, 200));

console.log("\n\x1b[1mOutgoing attachments (safe folder)\x1b[0m");
const outbox = join(HOME, "outbox");
const missingDir = await tb("compose", "--to", "a@b.c", "--body", "x", "--attach", "report.pdf");
test("missing attachments folder is reported, nothing sent", missingDir.code !== 0 && /does not exist/.test(missingDir.out + missingDir.err));
mkdirSync(join(outbox, "sub"), { recursive: true });
writeFileSync(join(outbox, "report.pdf"), "%PDF-1.4 test");
writeFileSync(join(outbox, ".secret"), "hidden");
writeFileSync(join(HOME, "outside.txt"), "private");
symlinkSync(join(HOME, "outside.txt"), join(outbox, "link.txt"));
seen = since();
const okAttach = await tb("compose", "--to", "a@b.c", "--body", "x", "--attach", "report.pdf");
const sent = seen().find((q) => q.path === "/compose")?.body.attachments;
test("attaches a file from the folder by name", okAttach.code === 0 && sent?.length === 1 && sent[0].name === "report.pdf" &&
  sent[0].contentType === "application/pdf" && Buffer.from(sent[0].data, "base64").toString() === "%PDF-1.4 test", okAttach.out + okAttach.err);
for (const [label, name] of [["a path outside the folder", join(HOME, "outside.txt")], ["parent traversal", "../outside.txt"],
  ["a subfolder path", "sub/x.txt"], ["a dotfile", ".secret"], ["a symlink", "link.txt"], ["a directory", "sub"], ["a missing file", "nope.pdf"]]) {
  seen = since();
  const r = await tb("reply", "5", "--body", "x", "--attach", name);
  test(`rejects ${label} without contacting the bridge`, r.code !== 0 && seen().length === 0, r.out + r.err);
}
seen = since();
await tb("forward", "5", "--to", "x@y.z", "--attach", "report.pdf");
test("forward carries attachments", seen().find((q) => q.path === "/forward")?.body.attachments?.[0]?.name === "report.pdf");
test("forward remains attachment-based by default", seen().find((q) => q.path === "/forward")?.body.inline !== true);
seen = since();
const inlineForward = await tb("forward", "5", "--to", "x@y.z", "--inline", "--body", "FYI\nnext line", "--attach", "report.pdf");
const inlinePayload = seen().find((q) => q.path === "/forward")?.body;
test("forward --inline keeps the note, attachments and draft default", inlineForward.code === 0 &&
  inlinePayload?.inline === true && inlinePayload.body === "FYI\nnext line" && inlinePayload.draft === true &&
  inlinePayload.attachments?.[0]?.name === "report.pdf");
const listing = await tb("attachable");
const listed = (listing.json?.data ?? listing.json)?.files?.map((f) => f.name);
test("attachable lists only regular, visible files", JSON.stringify(listed) === '["report.pdf"]', listing.out);

server.close();
rmSync(HOME, { recursive: true, force: true });
console.log(`\n\x1b[1m${"─".repeat(40)}\x1b[0m`);
console.log(`\x1b[1m${passed} passed, ${failed} failed, ${passed + failed} total\x1b[0m\n`);
process.exit(failed > 0 ? 1 : 0);
