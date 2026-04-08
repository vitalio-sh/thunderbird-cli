/**
 * Minimal HTTP client for the thunderbird-cli bridge.
 *
 * This is a self-contained copy of the functions needed by the MCP server,
 * so that the mcp package has no runtime dependency on the cli package.
 * Keep in sync with cli/src/client.js.
 */

import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const CONFIG_PATHS = [
  join(homedir(), ".config", "thunderbird-cli", "config.json"),
  join(homedir(), ".config", "thunderbird-ai", "config.json"),
];

function loadConfig() {
  const defaults = { host: "127.0.0.1", port: 7700, authToken: null };
  const envHost = process.env.TB_BRIDGE_HOST;
  const envPort = process.env.TB_BRIDGE_PORT;
  const envToken = process.env.TB_AUTH_TOKEN;

  let fileConfig = {};
  for (const p of CONFIG_PATHS) {
    if (existsSync(p)) {
      try {
        fileConfig = JSON.parse(readFileSync(p, "utf-8"));
        break;
      } catch {}
    }
  }

  return {
    host: envHost || fileConfig.bridge?.host || fileConfig.host || defaults.host,
    port: parseInt(
      envPort || fileConfig.bridge?.httpPort || fileConfig.port || defaults.port
    ),
    authToken:
      envToken || fileConfig.bridge?.authToken || fileConfig.authToken || defaults.authToken,
  };
}

const config = loadConfig();
const BASE_URL = `http://${config.host}:${config.port}`;

/**
 * Make an HTTP call to the bridge daemon.
 */
export async function api(method, path, body = null, timeout = 30000) {
  const url = `${BASE_URL}${path}`;
  const headers = { "Content-Type": "application/json" };
  if (config.authToken) headers["Authorization"] = `Bearer ${config.authToken}`;

  const opts = { method, headers };
  if (body && (method === "POST" || method === "PUT")) {
    opts.body = JSON.stringify(body);
  }
  if (timeout) opts.signal = AbortSignal.timeout(timeout);

  let res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    if (err.name === "TimeoutError") {
      throw Object.assign(new Error("Request timed out"), { code: "TIMEOUT" });
    }
    if (err.code === "ECONNREFUSED" || err.cause?.code === "ECONNREFUSED") {
      throw Object.assign(
        new Error(
          "Cannot connect to Thunderbird bridge at " +
            BASE_URL +
            ". Is the bridge daemon running? See https://github.com/vitalio-sh/thunderbird-cli#quick-start"
        ),
        { code: "BRIDGE_UNREACHABLE" }
      );
    }
    throw err;
  }

  const data = await res.json();
  if (res.status >= 400) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.code =
      data.code || (res.status === 503 ? "EXTENSION_DISCONNECTED" : "THUNDERBIRD_ERROR");
    throw err;
  }
  return data;
}

/**
 * Parse relative date strings (7d, 2w, 3m, 1y, today, yesterday) to ISO dates.
 */
export function parseRelativeDate(input) {
  if (!input) return input;
  const now = new Date();
  const lower = input.toLowerCase().trim();
  if (lower === "today")
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  if (lower === "yesterday") {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    d.setDate(d.getDate() - 1);
    return d.toISOString();
  }
  const match = lower.match(/^(\d+)([dwmy])$/);
  if (match) {
    const n = parseInt(match[1]);
    const unit = match[2];
    const d = new Date(now);
    if (unit === "d") d.setDate(d.getDate() - n);
    else if (unit === "w") d.setDate(d.getDate() - n * 7);
    else if (unit === "m") d.setMonth(d.getMonth() - n);
    else if (unit === "y") d.setFullYear(d.getFullYear() - n);
    return d.toISOString();
  }
  return input;
}
