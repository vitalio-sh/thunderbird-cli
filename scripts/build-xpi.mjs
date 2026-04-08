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
import { readFileSync, mkdirSync, existsSync, statSync } from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";
import { readdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const EXT_DIR = join(REPO_ROOT, "extension");
const DIST_DIR = join(REPO_ROOT, "dist");

// ─── Load manifest ─────────────────────────────────────────────────

const manifestPath = join(EXT_DIR, "manifest.json");
if (!existsSync(manifestPath)) {
  console.error(`✗ manifest.json not found at ${manifestPath}`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
const { name, version } = manifest;

if (!name || !version) {
  console.error("✗ manifest.json missing 'name' or 'version'");
  process.exit(1);
}

console.log(`Building ${name} v${version}`);
console.log(`  manifest_version: ${manifest.manifest_version}`);
console.log(
  `  min Thunderbird:  ${manifest.browser_specific_settings?.gecko?.strict_min_version || "unknown"}`
);
console.log(`  permissions:      ${(manifest.permissions || []).length} listed`);

// ─── Collect files ─────────────────────────────────────────────────

const EXCLUDE = new Set([".DS_Store", "node_modules", ".git", "package.json", "package-lock.json"]);

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

const xpiName = `thunderbird-cli-${version}.xpi`;
const xpiPath = join(DIST_DIR, xpiName);

const zip = new AdmZip();
for (const f of files) {
  const data = readFileSync(f.path);
  // Use forward-slash path separators (ZIP standard)
  const zipPath = f.rel.replace(/\\/g, "/");
  // Place files at the ZIP root (no leading directory)
  zip.addFile(zipPath, data);
}

zip.writeZip(xpiPath);

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
console.log(`  2. Submit to ATN for signing:`);
console.log(`     https://addons.thunderbird.net/developers/addon/submit/`);
console.log(`     Choose: "On your own" (self-distributed)`);
