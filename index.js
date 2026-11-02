import { extension_settings, getContext } from "../../../extensions.js";
import {
  getCharacters,
  getRequestHeaders,
  saveSettingsDebounced,
  selectCharacterById,
} from "../../../../script.js";
import { createDatacatClient } from "./src/api.js";
import { createHost } from "./src/host.js";
import { setup } from "./src/ui.js";

const MODULE = "datacat";
const VERSION = "1.0.0";
const DEFAULTS = {
  clientId: "datacat_sillytavern",
  clientName: "SillyTavern",
  installationId: "",
  accessToken: "",
  verificationLease: null,
  pending: {},
};

const CAT_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5.2 8.3 7 3.9l4.1 2.2c.6-.1 1.2-.1 1.8 0L17 3.9l1.8 4.4c1.3 1.4 2 3.2 2 5.1 0 4.3-3.9 7.6-8.8 7.6s-8.8-3.3-8.8-7.6c0-1.9.7-3.7 2-5.1Z" fill="currentColor"/>
    <circle cx="8.6" cy="12.2" r="1.15" fill="#17101f"/>
    <circle cx="15.4" cy="12.2" r="1.15" fill="#17101f"/>
    <path d="M9.4 16c1.7 1 3.5 1 5.2 0" fill="none" stroke="#17101f" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`;

let host = null;
let teardown = null;
let settingsElement = null;

function getSettings() {
  const store = extension_settings[MODULE];
  if (!store || typeof store !== "object") {
    extension_settings[MODULE] = structuredClone(DEFAULTS);
  } else {
    for (const [key, value] of Object.entries(DEFAULTS)) {
      if (!(key in store)) store[key] = structuredClone(value);
    }
  }
  return extension_settings[MODULE];
}

function saveSettings() {
  saveSettingsDebounced();
}

function renderSettingsPanel() {
  if (settingsElement || !host) return;
  const settingsHost = document.getElementById("extensions_settings2");
  if (!settingsHost) {
    setTimeout(renderSettingsPanel, 500);
    return;
  }
  const settings = getSettings();
  const container = document.createElement("div");
  container.className = "datacat-settings";
  container.innerHTML = `
    <div class="inline-drawer">
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>Datacat</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
      </div>
      <div class="inline-drawer-content">
        <div class="dc-settings-copy">
          Browse the Datacat catalogue and import characters straight into SillyTavern.
        </div>
        <label class="dc-settings-label" for="datacat-client-id">Datacat Client ID</label>
        <input id="datacat-client-id" class="text_pole" type="text" autocomplete="off" spellcheck="false">
        <div class="dc-settings-hint">
          Must be a Client ID approved at
          <a href="https://datacat.run/creatortools/api-access" target="_blank" rel="noopener noreferrer">datacat.run → Creator Management → API Access</a>.
        </div>
        <div class="dc-settings-actions">
          <div id="datacat-open" class="menu_button menu_button_icon">
            <span class="dc-settings-button-icon">${CAT_ICON}</span>
            <span>Open Datacat</span>
          </div>
          <div id="datacat-forget" class="menu_button">Forget local session</div>
        </div>
        <div id="datacat-settings-status" class="dc-settings-status" role="status"></div>
      </div>
    </div>`;

  settingsHost.append(container);
  settingsElement = container;

  const input = container.querySelector("#datacat-client-id");
  input.value = settings.clientId || DEFAULTS.clientId;
  input.addEventListener("change", () => {
    const value = String(input.value || "").trim();
    getSettings().clientId = value || DEFAULTS.clientId;
    input.value = getSettings().clientId;
    saveSettings();
    updateSettingsStatus();
  });

  container.querySelector("#datacat-open")?.addEventListener("click", () => host?.open());
  container.querySelector("#datacat-forget")?.addEventListener("click", () => {
    const store = getSettings();
    delete store.accessToken;
    delete store.verificationLease;
    store.pending = {};
    saveSettings();
    updateSettingsStatus("Local Datacat session cleared. Reload SillyTavern to apply.");
  });
  updateSettingsStatus();
}

function updateSettingsStatus(message) {
  const status = settingsElement?.querySelector("#datacat-settings-status");
  if (!status) return;
  const store = getSettings();
  const connected = Boolean(store.accessToken);
  status.textContent =
    message ||
    `Client ID: ${store.clientId || DEFAULTS.clientId} · ${
      connected ? "Datacat account connected" : "anonymous access"
    }`;
}

function addWandButton() {
  if (document.getElementById("datacat-wand-button")) return;
  const menu = document.getElementById("extensionsMenu");
  if (!menu) {
    if (host) setTimeout(addWandButton, 500);
    return;
  }
  const item = document.createElement("div");
  item.id = "datacat-wand-button";
  item.className = "list-group-item flex-container flexGap5 interactable";
  item.tabIndex = 0;
  item.title = "Browse Datacat";
  item.innerHTML = `<div class="dc-wand-icon" aria-hidden="true">${CAT_ICON}</div><span>Datacat</span>`;
  const activate = () => host?.open();
  item.addEventListener("click", activate);
  item.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate();
    }
  });
  menu.prepend(item);
}

export async function init() {
  if (teardown) return;
  try {
    const client = createDatacatClient({
      getSettings,
      saveSettings,
      version: VERSION,
    });
    host = createHost({
      client,
      getContext,
      getRequestHeaders,
      selectCharacterById,
      refreshCharacters: getCharacters,
      version: VERSION,
    });
    teardown = setup(host);
    renderSettingsPanel();
    addWandButton();
    console.log("[Datacat] SillyTavern extension ready");
  } catch (error) {
    console.error("[Datacat] Failed to start", error);
    globalThis.toastr?.error?.(
      "The Datacat extension could not start. Check the browser console.",
      "Datacat",
    );
  }
}

export function disable() {
  try {
    host?.dispose?.();
    teardown?.();
  } catch (error) {
    console.error("[Datacat] Failed to clean up", error);
  }
  teardown = null;
  host = null;
  settingsElement?.remove();
  settingsElement = null;
  document.getElementById("datacat-wand-button")?.remove();
  document.getElementById("datacat-st-shell")?.remove();
}
