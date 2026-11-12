/**
 * Outgoing attachments — safe folder flow (#23).
 *
 * Agents may only attach files the user has deliberately placed in ONE attachments folder:
 *   TB_ATTACH_DIR, default ~/thunderbird-cli-attachments
 *
 * Callers pass file NAMES, never paths. A name containing a path separator, "..", a leading dot
 * or a control character is rejected; symlinks are refused (O_NOFOLLOW + realpath check), and only
 * regular files are read. This keeps a prompt-injected agent from attaching ~/.ssh/id_rsa or any
 * other file on the drive: the worst it can reach is what the user put in the folder.
 *
 * Keep this file identical in cli/src/ and mcp/src/ (the packages are published separately).
 */

import { closeSync, constants as fsc, fstatSync, lstatSync, openSync, readdirSync, readSync, realpathSync } from "fs";
import { homedir } from "os";
import { extname, join, resolve, sep } from "path";

export const MAX_ATTACHMENTS = 20;
export const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

const MIME_TYPES = {
  ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".txt": "text/plain", ".csv": "text/csv",
  ".json": "application/json", ".zip": "application/zip", ".ics": "text/calendar",
  ".doc": "application/msword", ".xls": "application/vnd.ms-excel",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".html": "text/html", ".htm": "text/html", ".md": "text/markdown",
};

function fail(message, code = "INVALID_ARGS") {
  return Object.assign(new Error(message), { code });
}

/** The single folder attachments may come from. */
export function attachDir() {
  return resolve(process.env.TB_ATTACH_DIR || join(homedir(), "thunderbird-cli-attachments"));
}

function realDir() {
  const dir = attachDir();
  try {
    return realpathSync(dir);
  } catch {
    throw fail(`Attachments folder ${dir} does not exist. Create it and put the files to send there (or set TB_ATTACH_DIR).`, "NOT_FOUND");
  }
}

/** A plain file name inside the folder: no separators, no "..", no dotfiles, no control chars. */
export function checkName(name) {
  if (typeof name !== "string" || !name || name.length > 255 || name === "." || name === ".." ||
      name.startsWith(".") || /[\/\\\x00-\x1f\x7f]/.test(name)) {
    throw fail(`Invalid attachment name ${JSON.stringify(name)}: give a file name from the attachments folder, not a path`);
  }
  return name;
}

/** Files available to attach (regular, non-hidden, not symlinks). */
export function listAttachable() {
  const dir = realDir();
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && !e.name.startsWith("."))
    .map((e) => ({ name: e.name, size: lstatSync(join(dir, e.name)).size }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Read the named files from the folder → [{ name, contentType, data (base64) }]. */
export function loadAttachments(names) {
  if (names === undefined || names === null) return undefined;
  if (!Array.isArray(names)) throw fail("attachments must be a list of file names");
  if (names.length === 0) return undefined;
  if (names.length > MAX_ATTACHMENTS) throw fail(`At most ${MAX_ATTACHMENTS} attachments`);
  if (new Set(names).size !== names.length) throw fail("Duplicate attachment names");
  const dir = realDir();
  let total = 0;
  return names.map((raw) => {
    const name = checkName(raw);
    const path = join(dir, name);
    let fd;
    try {
      // O_NOFOLLOW: a symlink in the folder cannot point the read at another file.
      fd = openSync(path, fsc.O_RDONLY | (fsc.O_NOFOLLOW ?? 0));
    } catch (e) {
      if (e.code === "ENOENT") throw fail(`No file named ${JSON.stringify(name)} in the attachments folder ${dir}`, "NOT_FOUND");
      if (e.code === "ELOOP") throw fail(`${JSON.stringify(name)} is a symlink; only regular files can be attached`);
      throw e;
    }
    try {
      const st = fstatSync(fd);
      if (!st.isFile()) throw fail(`${JSON.stringify(name)} is not a regular file`);
      if (lstatSync(path).isSymbolicLink()) throw fail(`${JSON.stringify(name)} is a symlink; only regular files can be attached`);
      if (!realpathSync(path).startsWith(dir + sep)) throw fail(`${JSON.stringify(name)} resolves outside the attachments folder`);
      total += st.size;
      if (total > MAX_TOTAL_BYTES) throw fail(`Attachments exceed ${MAX_TOTAL_BYTES / 1024 / 1024} MiB in total`);
      const buf = Buffer.alloc(st.size);
      let off = 0;
      while (off < st.size) {
        const n = readSync(fd, buf, off, st.size - off, off);
        if (n === 0) break;
        off += n;
      }
      return {
        name,
        contentType: MIME_TYPES[extname(name).toLowerCase()] || "application/octet-stream",
        data: buf.subarray(0, off).toString("base64"),
      };
    } finally {
      closeSync(fd);
    }
  });
}
