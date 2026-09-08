#!/usr/bin/env node
/**
 * Live smoke test against a real Betterbird/Thunderbird instance.
 * Read-only checks only: bridge status, health, accounts, folders, stats, recent.
 */

import { api } from "../cli/src/client.js";

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    const details = await fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}${details ? ` — ${details}` : ""}`);
  } catch (err) {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    ${err.message}`);
  }
}

console.log("\n\x1b[1m=== thunderbird-cli Live Smoke Test ===\x1b[0m\n");

let accounts = [];
let firstAccount = null;

await check("Bridge status", async () => {
  const status = await api("GET", "/bridge/status");
  if (status.bridge !== "running") throw new Error(`bridge=${status.bridge}`);
  if (status.extension !== "connected") throw new Error(`extension=${status.extension}`);
  return `bridge=${status.bridge}, extension=${status.extension}`;
});

await check("Health", async () => {
  const health = await api("GET", "/health");
  if (health.status !== "ok") throw new Error(`status=${health.status}`);
  if (!health.thunderbird) throw new Error("thunderbird=false");
  return `version=${health.version}`;
});

await check("Accounts", async () => {
  accounts = await api("GET", "/accounts");
  if (!Array.isArray(accounts)) throw new Error("accounts response was not an array");
  if (accounts.length === 0) throw new Error("no accounts found");
  firstAccount = accounts[0];
  return `${accounts.length} account(s), first=${firstAccount.name || firstAccount.id}`;
});

await check("Folders for first account", async () => {
  if (!firstAccount) throw new Error("accounts check did not produce an account");
  const folders = await api("GET", `/accounts/${firstAccount.id}/folders`);
  if (!Array.isArray(folders)) throw new Error("folders response was not an array");
  return `${folders.length} folder(s)`;
});

await check("Stats overview", async () => {
  const stats = await api("GET", "/stats");
  if (typeof stats.totalAccounts !== "number") throw new Error("missing totalAccounts");
  if (typeof stats.totalUnread !== "number") throw new Error("missing totalUnread");
  if (typeof stats.totalMessages !== "number") throw new Error("missing totalMessages");
  return `${stats.totalAccounts} account(s), ${stats.totalUnread} unread, ${stats.totalMessages} messages`;
});

await check("Recent messages", async () => {
  const recent = await api("POST", "/recent", { hours: 24, limit: 5 });
  if (!recent || !Array.isArray(recent.messages)) throw new Error("recent response missing messages array");
  return `${recent.messages.length} message(s) returned`;
});

console.log(`\n\x1b[1m${"─".repeat(40)}\x1b[0m`);
console.log(`\x1b[1m${passed} passed, ${failed} failed, ${passed + failed} total\x1b[0m\n`);

process.exit(failed > 0 ? 1 : 0);
