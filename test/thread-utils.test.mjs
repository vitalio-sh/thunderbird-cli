#!/usr/bin/env node
/**
 * Unit tests for extension/src/thread-utils.js
 *
 * Tests the pure functions that fix the tb thread command:
 * - RFC 2822 header parsing via getRaw() (replaces unreliable getFull().headers)
 * - Angle-bracket stripping for headerMessageId queries
 * - Subject normalization for downstream thread discovery
 */

import { parseHeader, stripAngleBrackets, parseReferences, normalizeSubject, buildThreadIds } from "../extension/src/thread-utils.js";

let passed = 0, failed = 0;
function test(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    expected: ${JSON.stringify(expected)}`);
    console.log(`    actual:   ${JSON.stringify(actual)}`);
  }
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SIMPLE_RAW = [
  "Message-ID: <abc123@ipp.mpg.de>",
  "References: <root@ipp.mpg.de> <mid@ipp.mpg.de>",
  "In-Reply-To: <mid@ipp.mpg.de>",
  "Subject: Re: [All-ipp-intern] Call for Participants",
  "From: daniel@ipp.mpg.de",
  "",
  "Body text here.",
].join("\r\n");

// Folded References header (RFC 2822 multi-line continuation)
const FOLDED_RAW = [
  "Message-ID: <abc123@ipp.mpg.de>",
  "References: <root@ipp.mpg.de>",
  " <mid@ipp.mpg.de>",
  " <other@ipp.mpg.de>",
  "Subject: AW: Topic",
  "",
  "Body.",
].join("\r\n");

// Raw with embedded forwarded message (second set of headers after blank line)
const FORWARDED_RAW = [
  "Message-ID: <outer@ipp.mpg.de>",
  "References: <first@ipp.mpg.de>",
  "In-Reply-To: <first@ipp.mpg.de>",
  "Subject: WG: Original",
  "",
  "---------- Forwarded message ----------",
  "Message-ID: <embedded@other.com>",
  "Subject: Original",
  "",
  "Forwarded body.",
].join("\r\n");

// ─── parseHeader ─────────────────────────────────────────────────────────────

console.log("\n\x1b[1m=== thread-utils unit tests ===\x1b[0m\n");
console.log("\x1b[1mparsHeader\x1b[0m");

test("extracts Message-ID",
  parseHeader(SIMPLE_RAW, "Message-ID"),
  "<abc123@ipp.mpg.de>");

test("extracts References",
  parseHeader(SIMPLE_RAW, "References"),
  "<root@ipp.mpg.de> <mid@ipp.mpg.de>");

test("extracts In-Reply-To",
  parseHeader(SIMPLE_RAW, "In-Reply-To"),
  "<mid@ipp.mpg.de>");

test("case-insensitive header name",
  parseHeader(SIMPLE_RAW, "message-id"),
  "<abc123@ipp.mpg.de>");

test("returns empty string for missing header",
  parseHeader(SIMPLE_RAW, "X-Nonexistent"),
  "");

test("unfolds multi-line References header",
  parseHeader(FOLDED_RAW, "References"),
  "<root@ipp.mpg.de> <mid@ipp.mpg.de> <other@ipp.mpg.de>");

test("does not bleed into embedded forwarded headers",
  parseHeader(FORWARDED_RAW, "Message-ID"),
  "<outer@ipp.mpg.de>");

// ─── stripAngleBrackets ───────────────────────────────────────────────────────

console.log("\n\x1b[1mstripAngleBrackets\x1b[0m");

test("strips brackets from <id@host>",
  stripAngleBrackets("<abc123@ipp.mpg.de>"),
  "abc123@ipp.mpg.de");

test("no-op when already stripped",
  stripAngleBrackets("abc123@ipp.mpg.de"),
  "abc123@ipp.mpg.de");

test("trims surrounding whitespace",
  stripAngleBrackets("  <id@host>  "),
  "id@host");

test("empty string stays empty",
  stripAngleBrackets(""),
  "");

// ─── parseReferences ─────────────────────────────────────────────────────────

console.log("\n\x1b[1mparseReferences\x1b[0m");

test("parses multiple IDs from References header value",
  parseReferences("<root@ipp.mpg.de> <mid@ipp.mpg.de>"),
  ["root@ipp.mpg.de", "mid@ipp.mpg.de"]);

test("parses single ID",
  parseReferences("<only@host.com>"),
  ["only@host.com"]);

test("returns empty array for empty string",
  parseReferences(""),
  []);

test("handles folded (already unfolded) References",
  parseReferences("<root@ipp.mpg.de> <mid@ipp.mpg.de> <other@ipp.mpg.de>"),
  ["root@ipp.mpg.de", "mid@ipp.mpg.de", "other@ipp.mpg.de"]);

// ─── normalizeSubject ─────────────────────────────────────────────────────────

console.log("\n\x1b[1mnormalizeSubject\x1b[0m");

test("strips Re:",
  normalizeSubject("Re: Topic"),
  "Topic");

test("strips WG: (German forward prefix)",
  normalizeSubject("WG: Topic"),
  "Topic");

test("strips AW: (German reply prefix)",
  normalizeSubject("AW: Topic"),
  "Topic");

test("strips Fwd:",
  normalizeSubject("Fwd: Topic"),
  "Topic");

test("strips FW:",
  normalizeSubject("FW: Topic"),
  "Topic");

test("strips stacked prefixes",
  normalizeSubject("Re: WG: AW: Topic"),
  "Topic");

test("strips [list-name] prefix",
  normalizeSubject("[All-ipp-intern] Call for Participants"),
  "Call for Participants");

test("strips [list-name] after reply prefix",
  normalizeSubject("Re: [All-ipp-intern] Call for Participants"),
  "Call for Participants");

test("strips complex stacked prefixes",
  normalizeSubject("AW: WG: [All-ipp-intern] Call for Participants"),
  "Call for Participants");

test("no-op on plain subject",
  normalizeSubject("Digital Twin kickoff"),
  "Digital Twin kickoff");

test("trims whitespace",
  normalizeSubject("  Re: Topic  "),
  "Topic");

// ─── buildThreadIds ──────────────────────────────────────────────────────────

console.log("\n\x1b[1mbuildThreadIds\x1b[0m");

test("collects Message-ID + References + In-Reply-To without brackets",
  [...buildThreadIds(SIMPLE_RAW)].sort(),
  ["abc123@ipp.mpg.de", "mid@ipp.mpg.de", "root@ipp.mpg.de"].sort());

test("deduplicates IDs appearing in both References and In-Reply-To",
  [...buildThreadIds(SIMPLE_RAW)].filter(id => id === "mid@ipp.mpg.de").length,
  1);

test("does not bleed embedded forwarded Message-ID",
  [...buildThreadIds(FORWARDED_RAW)].includes("embedded@other.com"),
  false);

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n\x1b[1m${"─".repeat(40)}\x1b[0m`);
console.log(`\x1b[1m${passed} passed, ${failed} failed, ${passed + failed} total\x1b[0m\n`);
process.exit(failed > 0 ? 1 : 0);
