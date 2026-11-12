// Options page for per-account access (#18). Uses DOM APIs only (no innerHTML).

async function render() {
  const access = await loadAccountAccess();
  const accounts = await messenger.accounts.list(false);
  const mode = access.mode === "all" ? "all" : "selected";
  document.querySelector(`input[name=mode][value=${mode}]`).checked = true;
  const box = document.getElementById("accounts");
  box.replaceChildren();
  for (const account of accounts) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = account.id;
    input.checked = access.accounts ? access.accounts.has(account.id) : true;
    const email = account.identities?.[0]?.email;
    label.append(input, ` ${account.name}${email && email !== account.name ? ` (${email})` : ""}`);
    box.append(label);
  }
  if (access.mode === "invalid") {
    setStatus("The saved setting was unreadable, so all accounts were blocked. Choose and save again.");
  }
  syncDisabled();
}

function syncDisabled() {
  const all = document.querySelector("input[name=mode][value=all]").checked;
  for (const input of document.querySelectorAll("#accounts input")) input.disabled = all;
}

function setStatus(text) {
  document.getElementById("status").textContent = text;
}

async function save() {
  const all = document.querySelector("input[name=mode][value=all]").checked;
  let value;
  if (all) {
    value = { mode: "all" };
  } else {
    const accounts = [...document.querySelectorAll("#accounts input:checked")].map((i) => i.value);
    if (accounts.length === 0) {
      setStatus("Check at least one account, or choose All accounts.");
      return;
    }
    value = { mode: "selected", accounts };
  }
  await messenger.storage.local.set({ [ACCOUNT_ACCESS_KEY]: value });
  setStatus("Saved. Applies to the next request.");
}

document.addEventListener("change", (e) => { if (e.target.name === "mode") syncDisabled(); });
document.getElementById("save").addEventListener("click", () => save().catch((e) => setStatus(`Error: ${e.message}`)));
render().catch((e) => setStatus(`Error: ${e.message}`));
