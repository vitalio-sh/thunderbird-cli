#!/usr/bin/env node
/**
 * Live smoke test for attachment download integrity.
 * Focuses on the chunked bytesToBase64() path in the Thunderbird extension.
 */

import { Buffer } from "node:buffer";
import { api } from "../cli/src/client.js";

const MIN_CHUNKED_ATTACHMENT_SIZE = 0x8000 + 1;
const SEARCH_LIMIT = 200;
const FOLDER_SCAN_LIMIT = 10;
const ATTACHMENT_FOLDER_HINT = /(anlag|attach)/i;

let passed = 0;
let failed = 0;

function pass(name, details = "") {
  passed += 1;
  console.log(`  \x1b[32m✓\x1b[0m ${name}${details ? ` — ${details}` : ""}`);
}

function fail(name, err) {
  failed += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${name}`);
  console.log(`    ${err.message || err}`);
}

function normalizeBase64(base64) {
  return Buffer.from(base64, "base64").toString("base64");
}

function detectMagic(buffer) {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-") return "pdf";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "jpeg";
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString("ascii") === "PK\u0003\u0004") return "zip";
  if (buffer.length >= 6 && (buffer.subarray(0, 6).toString("ascii") === "GIF87a" || buffer.subarray(0, 6).toString("ascii") === "GIF89a")) return "gif";
  return null;
}

async function findAttachmentCandidate() {
  const accounts = await api("GET", "/accounts");
  const folders = [];
  for (const account of accounts || []) {
    const accountFolders = await api("GET", `/accounts/${account.id}/folders`);
    folders.push(...(accountFolders || []));
  }

  const hintedFolders = folders.filter((folder) =>
    ATTACHMENT_FOLDER_HINT.test(`${folder.name || ""} ${folder.path || ""}`)
  );

  for (const folder of hintedFolders) {
    const listing = await api("POST", "/messages/list", {
      folderId: folder.id,
      limit: FOLDER_SCAN_LIMIT,
    }, 120000);
    const candidate = await scanMessagesForAttachment(listing.messages || []);
    if (candidate) {
      return {
        ...candidate,
        sourceFolder: { id: folder.id, path: folder.path, name: folder.name },
      };
    }
  }

  try {
    const search = await api("POST", "/messages/search", {
      hasAttachment: true,
      includeJunk: true,
      limit: SEARCH_LIMIT,
    }, 120000);

    const candidate = await scanMessagesForAttachment(search.messages || []);
    if (candidate) return candidate;
  } catch (error) {
    if (error.code !== "TIMEOUT") throw error;
  }

  throw new Error(
    `no attachment found via global search or hinted folders after scanning ${hintedFolders.length} folder(s)`
  );
}

async function scanMessagesForAttachment(messages) {
  let fallback = null;

  for (const message of messages) {
    let attachments = [];
    try {
      attachments = await api("GET", `/messages/${message.id}/attachments`, null, 120000);
    } catch {
      continue;
    }

    for (const attachment of attachments) {
      const candidate = { message, attachment };
      if (!fallback) fallback = candidate;
      if ((attachment.size || 0) >= MIN_CHUNKED_ATTACHMENT_SIZE) {
        return { ...candidate, chunked: true };
      }
    }
  }

  return fallback ? { ...fallback, chunked: false } : null;
}

console.log("\n\x1b[1m=== thunderbird-cli Live Attachment Smoke Test ===\x1b[0m\n");

try {
  const bridge = await api("GET", "/bridge/status");
  if (bridge.extension !== "connected") throw new Error(`extension=${bridge.extension}`);
  pass("Bridge status", `extension=${bridge.extension}`);
} catch (err) {
  fail("Bridge status", err);
}

let candidate = null;
  try {
    candidate = await findAttachmentCandidate();
    const { message, attachment, chunked } = candidate;
    pass(
      "Attachment candidate",
      `message=${message.id}, attachment=${attachment.name}, size=${attachment.size}, chunked=${chunked ? "yes" : "no"}${
        candidate.sourceFolder ? `, folder=${candidate.sourceFolder.path}` : ""
      }`
    );
  } catch (err) {
  fail("Attachment candidate", err);
}

if (candidate) {
  try {
    const result = await api("POST", `/messages/${candidate.message.id}/attachment`, {
      partName: candidate.attachment.partName,
    });

    if (!result?.data) throw new Error("attachment response missing base64 data");
    const decoded = Buffer.from(result.data, "base64");
    if (decoded.length !== result.size) {
      throw new Error(`decoded length ${decoded.length} did not match reported size ${result.size}`);
    }

    pass("Attachment decode length", `${decoded.length} bytes`);

    const normalized = normalizeBase64(result.data);
    if (normalized !== result.data.replace(/\s+/g, "")) {
      throw new Error("base64 payload did not round-trip cleanly");
    }
    pass("Attachment base64 round-trip");

    const magic = detectMagic(decoded);
    if (magic) {
      pass("Attachment magic bytes", magic);
    } else {
      pass("Attachment magic bytes", "generic binary");
    }

    if (candidate.chunked && decoded.length <= MIN_CHUNKED_ATTACHMENT_SIZE - 1) {
      throw new Error("expected multi-chunk attachment but decoded payload was smaller than threshold");
    }
  } catch (err) {
    fail("Attachment download integrity", err);
  }
}

console.log(`\n\x1b[1m${"─".repeat(40)}\x1b[0m`);
console.log(`\x1b[1m${passed} passed, ${failed} failed, ${passed + failed} total\x1b[0m\n`);

process.exit(failed > 0 ? 1 : 0);
