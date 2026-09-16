#!/usr/bin/env node

/**
 * Build thunderbird-cli.xpi from extension/ directory.
 *
 * Usage: npm run build:xpi
 * Output: dist/thunderbird-cli-<version>.xpi
 *
 * The .xpi file is a standard ZIP with manifest.json at the root.
 * Ready for submission to addons.thunderbird.net for signing.
 */

import AdmZip from "adm-zip";
import { readFileSync, writeFileSync, chmodSync, mkdirSync, existsSync, statSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { readdirSync } from "fs";
import { parseArgs } from "node:util";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const EXT_DIR = join(REPO_ROOT, "extension");
const DIST_DIR = join(REPO_ROOT, "dist");

const { values } = parseArgs({ options: {
  "access-config": { type: "string" }, "auth-file": { type: "string" },
  "addon-id": { type: "string" }, "addon-version": { type: "string" },
  output: { type: "string" },
} });
let token = "";
if (values["auth-file"]) {
  const match = readFileSync(values["auth-file"], "utf8").match(/^TB_AUTH_TOKEN=([a-f0-9]{64})\n$/);
  if (!match) throw new Error("Invalid auth file; expected one generated TB_AUTH_TOKEN entry");
  token = match[1];
}
const policyContext = vm.createContext({});
vm.runInContext(readFileSync(join(EXT_DIR, "src/access-config.js"), "utf8"), policyContext);
if (values["access-config"]) {
  policyContext.TB_ACCESS_CONFIG = JSON.parse(readFileSync(values["access-config"], "utf8"));
}
vm.runInContext(readFileSync(join(EXT_DIR, "src/access-control.js"), "utf8"), policyContext);
const policy = vm.runInContext("ACCESS_POLICY", policyContext);

// ─── Load manifest ─────────────────────────────────────────────────

const manifestPath = join(EXT_DIR, "manifest.json");
if (!existsSync(manifestPath)) {
  console.error(`✗ manifest.json not found at ${manifestPath}`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
if (values["addon-id"]) manifest.browser_specific_settings.gecko.id = values["addon-id"];
if (values["addon-version"]) manifest.version = values["addon-version"];
manifest.background.scripts.unshift("src/bridge-auth.js");
manifest.permissions = vm.runInContext("accessPermissions(ACCESS_POLICY)", policyContext);
const { name, version } = manifest;

if (!name || !version) {
  console.error("✗ manifest.json missing 'name' or 'version'");
  process.exit(1);
}

console.log(`Building ${name} v${version}`);
console.log(`  access policy:    ${JSON.stringify(policy)}`);
console.log(`  manifest_version: ${manifest.manifest_version}`);
console.log(
  `  min Thunderbird:  ${manifest.browser_specific_settings?.gecko?.strict_min_version || "unknown"}`
);
console.log(`  permissions:      ${(manifest.permissions || []).length} listed`);

// ─── Collect files ─────────────────────────────────────────────────

const EXCLUDE = new Set([".DS_Store", "node_modules", ".git", "package.json", "package-lock.json", "bridge-auth.js"]);

function walk(dir, base = "") {
  const results = [];
  for (const entry of readdirSync(dir)) {
    if (EXCLUDE.has(entry)) continue;
    const full = join(dir, entry);
    const rel = base ? `${base}/${entry}` : entry;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...walk(full, rel));
    } else {
      results.push({ path: full, rel, size: stat.size });
    }
  }
  return results;
}

const files = walk(EXT_DIR);
console.log(`\nFiles to include (${files.length}):`);
for (const f of files) {
  console.log(`  ${f.rel.padEnd(40)} ${f.size.toString().padStart(8)} bytes`);
}

// ─── Verify manifest is at root ────────────────────────────────────

if (!files.some((f) => f.rel === "manifest.json")) {
  console.error("\n✗ manifest.json not at root of extension/ — invalid XPI structure");
  process.exit(1);
}

// ─── Build the XPI ─────────────────────────────────────────────────

if (!existsSync(DIST_DIR)) mkdirSync(DIST_DIR, { recursive: true });

const xpiName = values.output ? basename(values.output) : `thunderbird-cli-${version}.xpi`;
const xpiPath = values.output || join(DIST_DIR, xpiName);
mkdirSync(dirname(xpiPath), { recursive: true });

const zip = new AdmZip();
zip.addFile("src/bridge-auth.js", Buffer.from(`globalThis.TB_BRIDGE_TOKEN = ${JSON.stringify(token)};\n`));
for (const f of files) {
  let data = readFileSync(f.path);
  if (f.rel === "manifest.json") data = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
  if (f.rel === "src/access-config.js") {
    data = Buffer.from(`globalThis.TB_ACCESS_CONFIG = Object.freeze(${JSON.stringify(policy)});\n`);
  }
  // Use forward-slash path separators (ZIP standard)
  const zipPath = f.rel.replace(/\\/g, "/");
  // Place files at the ZIP root (no leading directory)
  zip.addFile(zipPath, data);
}

// AdmZip.writeZip chmods the result to 0666, overriding the caller's umask.
writeFileSync(xpiPath, zip.toBuffer(), { mode: 0o600 });
chmodSync(xpiPath, 0o600);

const finalSize = statSync(xpiPath).size;
console.log(`\n✓ Built ${xpiName}`);
console.log(`  ${xpiPath}`);
console.log(`  ${finalSize} bytes`);

// ─── Verify the XPI ────────────────────────────────────────────────

console.log(`\nVerifying XPI structure...`);
const verify = new AdmZip(xpiPath);
const entries = verify.getEntries();
const entryNames = entries.map((e) => e.entryName).sort();

let hasManifest = false;
for (const entry of entries) {
  if (entry.entryName === "manifest.json") {
    hasManifest = true;
    // Verify the manifest is parseable after round-trip
    const roundTrip = JSON.parse(entry.getData().toString("utf-8"));
    if (roundTrip.version !== version) {
      console.error(`✗ Manifest version mismatch after zip: ${roundTrip.version} vs ${version}`);
      process.exit(1);
    }
  }
}

if (!hasManifest) {
  console.error("✗ manifest.json missing from XPI");
  process.exit(1);
}

console.log(`✓ XPI contains ${entries.length} files, manifest.json at root`);
console.log(`✓ manifest.json round-trip OK (version: ${version})`);
console.log(`\nNext steps:`);
console.log(`  1. Install locally for testing:`);
console.log(`     Thunderbird → Add-ons → ⚙️  → Install Add-on From File → ${xpiName}`);
if (token) console.log("  Private authenticated build: never publish or share this XPI.");
else console.log("  Public build: submit to https://addons.thunderbird.net/developers/addon/submit/");
