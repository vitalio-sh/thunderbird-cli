/**
 * User settings from the add-on's options page. No bridge route can write them.
 *
 * Per-account access (#18).
 *
 * The user chooses, on the add-on's options page in Thunderbird, whether agents see all accounts
 * or only selected ones. The setting lives in storage.local and no bridge route can change it.
 * Accounts outside the selection are invisible to every request: they behave as "not found".
 *
 * Stored value (key "accountAccess"):
 *   missing / { mode: "all" }                       → every account (default, backward compatible)
 *   { mode: "selected", accounts: ["account1", …] } → only these account IDs
 *   anything else                                    → fail closed: no account is visible
 *
 * Loaded by both the background script and options/options.html.
 */

const ACCOUNT_ACCESS_KEY = "accountAccess";

function parseAccountAccess(value) {
  if (value === undefined || value === null) return { mode: "all", accounts: null };
  if (value && typeof value === "object" && value.mode === "all") return { mode: "all", accounts: null };
  if (value && typeof value === "object" && value.mode === "selected" && Array.isArray(value.accounts) &&
      value.accounts.every((id) => typeof id === "string" && id)) {
    return { mode: "selected", accounts: new Set(value.accounts) };
  }
  return { mode: "invalid", accounts: new Set() };
}

async function loadAccountAccess() {
  try {
    const stored = await messenger.storage.local.get(ACCOUNT_ACCESS_KEY);
    return parseAccountAccess(stored?.[ACCOUNT_ACCESS_KEY]);
  } catch {
    return { mode: "invalid", accounts: new Set() }; // unreadable setting: fail closed
  }
}

/**
 * Send policy. Default: agents cannot send directly; they get drafts or an open compose window
 * for the user to review. Stored value (key "sendPolicy"): { allowSend: true } enables direct
 * sending; missing or anything else keeps it off (fail closed).
 */
const SEND_POLICY_KEY = "sendPolicy";

function parseSendPolicy(value) {
  return { allowSend: !!(value && typeof value === "object" && value.allowSend === true) };
}

async function loadSendPolicy() {
  try {
    const stored = await messenger.storage.local.get(SEND_POLICY_KEY);
    return parseSendPolicy(stored?.[SEND_POLICY_KEY]);
  } catch {
    return { allowSend: false };
  }
}
