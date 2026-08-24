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

function parseTimeout(envValue, defaultValue) {
  const parsed = parseInt(envValue || String(defaultValue));
  return isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

const config = loadConfig();
const BASE_URL = `http://${config.host}:${config.port}`;
const DEFAULT_PREFLIGHT_TIMEOUT = parseTimeout(
  process.env.TB_BRIDGE_PREFLIGHT_TIMEOUT,
  3000
);
const SEARCH_TIMEOUT_MS = parseTimeout(process.env.TB_SEARCH_TIMEOUT, 5000);
const LIST_TIMEOUT_MS = parseTimeout(process.env.TB_LIST_TIMEOUT, 5000);

function getOperationTimeout(path, timeout) {
  if (path === "/messages/search") return Math.min(timeout, SEARCH_TIMEOUT_MS);
  if (path === "/messages/list") return Math.min(timeout, LIST_TIMEOUT_MS);
  return timeout;
}

function makeError(message, code) {
  return Object.assign(new Error(message), { code });
}

function mapTimeoutCode(path) {
  if (path === "/messages/search") return "SEARCH_UNHEALTHY";
  if (path === "/messages/list") return "LIST_UNHEALTHY";
  return "TIMEOUT";
}

function mapBridgeError(path, status, message) {
  if (status === 503 || /not connected/i.test(message)) {
    return makeError(message, "EXTENSION_DISCONNECTED");
  }
  if (/timed out/i.test(message)) {
    return makeError(message, mapTimeoutCode(path));
  }
  return makeError(message, "THUNDERBIRD_ERROR");
}

async function getBridgeStatus(timeout = DEFAULT_PREFLIGHT_TIMEOUT) {
  const url = `${BASE_URL}/bridge/status`;
  const headers = { "Content-Type": "application/json" };
  if (config.authToken) headers["Authorization"] = `Bearer ${config.authToken}`;
  const opts = { method: "GET", headers, signal: AbortSignal.timeout(timeout) };

  let res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    if (err.name === "TimeoutError") {
      throw makeError("Bridge status check timed out", "TIMEOUT");
    }
    if (err.code === "ECONNREFUSED" || err.cause?.code === "ECONNREFUSED") {
      throw makeError(
        "Cannot connect to Thunderbird bridge at " +
          BASE_URL +
          ". Is the bridge daemon running? See https://github.com/vitalio-sh/thunderbird-cli#quick-start",
        "BRIDGE_UNREACHABLE"
      );
    }
    throw err;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let errorMsg = `Bridge status check failed: HTTP ${res.status}`;
    try {
      const data = JSON.parse(text);
      if (data.error) errorMsg = data.error;
    } catch {}
    throw makeError(errorMsg, res.status === 401 || res.status === 403 ? "BRIDGE_UNREACHABLE" : "THUNDERBIRD_ERROR");
  }

  return await res.json();
}

async function ensureBridgeReady(path, timeout) {
  if (path === "/bridge/status") return;
  const status = await getBridgeStatus(Math.min(timeout, DEFAULT_PREFLIGHT_TIMEOUT));
  if (status.extension !== "connected") {
    throw makeError(
      "Thunderbird extension not connected. Is Thunderbird running?",
      "EXTENSION_DISCONNECTED"
    );
  }
}

/**
 * Make an HTTP call to the bridge daemon.
 */
export async function api(method, path, body = null, timeout = 30000) {
  const effectiveTimeout = getOperationTimeout(path, timeout);
  await ensureBridgeReady(path, effectiveTimeout);
  const url = `${BASE_URL}${path}`;
  const headers = { "Content-Type": "application/json" };
  if (config.authToken) headers["Authorization"] = `Bearer ${config.authToken}`;
  // Tell the bridge how long it should wait for Thunderbird before giving up.
  if (effectiveTimeout) headers["X-TB-Timeout"] = String(effectiveTimeout);

  const opts = { method, headers };
  if (body && (method === "POST" || method === "PUT")) {
    opts.body = JSON.stringify(body);
  }
  if (effectiveTimeout) opts.signal = AbortSignal.timeout(effectiveTimeout);

  let res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    if (err.name === "TimeoutError") {
      throw makeError("Request timed out", mapTimeoutCode(path));
    }
    if (err.code === "ECONNREFUSED" || err.cause?.code === "ECONNREFUSED") {
      throw makeError(
        "Cannot connect to Thunderbird bridge at " +
          BASE_URL +
          ". Is the bridge daemon running? See https://github.com/vitalio-sh/thunderbird-cli#quick-start",
        "BRIDGE_UNREACHABLE"
      );
    }
    throw err;
  }

  const data = await res.json();
  if (res.status >= 400) {
    throw mapBridgeError(path, res.status, data.error || `HTTP ${res.status}`);
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
