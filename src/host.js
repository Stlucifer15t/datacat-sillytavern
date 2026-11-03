/**
 * SillyTavern host adapter.
 *
 * The Datacat UI was written against Lumiverse's "Spindle" extension host. That
 * host surface is small: a drawer tab, a modal factory, a style injector,
 * backend messages, character reads and permission checks. This module
 * implements the same surface on top of SillyTavern so the original UI can run
 * with only host-specific call sites replaced.
 */

const SHELL_ID = "datacat-st-shell";

function toast(tone, message, title) {
  const text = String(message || "").trim();
  if (!text) return;
  const t = globalThis.toastr;
  if (t && typeof t[tone] === "function") {
    t[tone](text, title || "Datacat");
    return;
  }
  console[tone === "error" ? "error" : "log"]("[Datacat]", title || "", text);
}

function readDatacatExtension(row) {
  if (!row || typeof row !== "object") return null;
  const candidates = [
    row?.data?.extensions?.datacat,
    row?.extensions?.datacat,
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object") {
      const id = String(
        candidate.datacatCharacterId ||
          candidate.datacat_character_id ||
          candidate.characterId ||
          candidate.character_id ||
          "",
      )
        .trim()
        .toLowerCase();
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
        return { ...candidate, datacatCharacterId: id };
      }
    }
  }
  return null;
}

function normalizeTimestamp(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const numeric = Number(raw);
  const ms = Number.isFinite(numeric)
    ? Math.abs(numeric) < 10_000_000_000
      ? numeric * 1000
      : numeric
    : Date.parse(raw);
  const date = new Date(ms);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function normalizeCharacter(row) {
  const data = row?.data && typeof row.data === "object" ? row.data : {};
  return {
    id: String(row?.avatar || data.avatar || ""),
    avatar: String(row?.avatar || ""),
    name: String(row?.name || data.name || "Character"),
    creator: String(data.creator || row?.creator || ""),
    creator_notes: String(data.creator_notes || ""),
    tags: Array.isArray(data.tags) ? data.tags : Array.isArray(row?.tags) ? row.tags : [],
    description: String(data.description ?? row?.description ?? ""),
    personality: String(data.personality ?? row?.personality ?? ""),
    scenario: String(data.scenario ?? row?.scenario ?? ""),
    first_mes: String(data.first_mes ?? row?.first_mes ?? ""),
    mes_example: String(data.mes_example ?? row?.mes_example ?? ""),
    alternate_greetings: Array.isArray(data.alternate_greetings)
      ? data.alternate_greetings
      : [],
    avatar_url: row?.avatar ? `/characters/${encodeURIComponent(row.avatar)}` : "",
  };
}

async function imageToPng(blob) {
  if (!blob) return null;
  if (String(blob.type || "").toLowerCase() === "image/png") return blob;
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    bitmap.close?.();
    const converted = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (converted) return converted;
  } catch (_) {
    // Fall back to an <img> decode below.
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d").drawImage(image, 0, 0);
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function readPngResponse(response, label) {
  if (!response.ok) {
    let detail = "";
    try {
      detail = String(await response.text() || "").slice(0, 160);
    } catch (_) {}
    throw new Error(
      `${label} failed (${response.status})${detail ? `: ${detail}` : "."}`,
    );
  }
  const type = String(response.headers.get("content-type") || "").toLowerCase();
  if (!type.includes("image/png") && !type.includes("application/octet-stream")) {
    throw new Error(`${label} did not return a PNG card.`);
  }
  const blob = await response.blob();
  if (!blob.size) throw new Error(`${label} returned an empty file.`);
  return blob;
}

export function toSillyTavernCard(rawCard, extraExtensions = {}) {
  const raw = rawCard && typeof rawCard === "object" ? rawCard : {};
  const container =
    raw.card && typeof raw.card === "object"
      ? raw.card
      : raw.character && typeof raw.character === "object"
        ? raw.character
        : raw;
  const data =
    container.data && typeof container.data === "object" ? { ...container.data } : { ...container };
  delete data.avatar;
  delete data.chat;
  delete data.json_data;

  const inheritedExtensions =
    container.extensions && typeof container.extensions === "object"
      ? { ...container.extensions }
      : raw.extensions && typeof raw.extensions === "object"
        ? { ...raw.extensions }
        : {};
  const extensions =
    data.extensions && typeof data.extensions === "object"
      ? { ...inheritedExtensions, ...data.extensions }
      : inheritedExtensions;
  for (const [key, value] of Object.entries(extraExtensions || {})) {
    if (!value || typeof value !== "object") continue;
    extensions[key] = {
      ...(extensions[key] && typeof extensions[key] === "object" ? extensions[key] : {}),
      ...value,
    };
  }
  data.extensions = extensions;
  if (!data.name) data.name = container.name || raw.name || "Character";
  if (!Array.isArray(data.tags)) data.tags = [];
  if (!data.creator) data.creator = container.creator || raw.creator || "";

  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    name: data.name,
    data,
  };
}

export function createHost({ client, getContext, getRequestHeaders, selectCharacterById, refreshCharacters, version }) {
  const ctx = {};
  const backendListeners = new Set();
  const linkCache = { links: [], loadedAt: 0, promise: null };
  const characterListCache = { rows: [], loadedAt: 0, promise: null };
  let overlay = null;
  let activeTab = null;
  const sources = new Map();
  let activeSource = "";

  const context = () => getContext();

  async function fetchAllCharacters({ force = false } = {}) {
    if (!force && characterListCache.rows.length && Date.now() - characterListCache.loadedAt < 5000) {
      return characterListCache.rows;
    }
    if (characterListCache.promise) return characterListCache.promise;
    characterListCache.promise = (async () => {
      const response = await fetch("/api/characters/all", {
        method: "POST",
        headers: getRequestHeaders(),
        body: "{}",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Could not read the SillyTavern character library.");
      const rows = await response.json();
      characterListCache.rows = Array.isArray(rows) ? rows : [];
      characterListCache.loadedAt = Date.now();
      return characterListCache.rows;
    })().finally(() => {
      characterListCache.promise = null;
    });
    return characterListCache.promise;
  }

  async function fetchCharacterRow(avatar) {
    const response = await fetch("/api/characters/get", {
      method: "POST",
      headers: getRequestHeaders(),
      body: JSON.stringify({ avatar_url: avatar }),
      cache: "no-store",
    });
    if (!response.ok) return null;
    return response.json();
  }

  function listContextCharacters() {
    const chars = context()?.characters;
    return Array.isArray(chars) ? chars : [];
  }

  function matchRow(row, key) {
    const wanted = String(key || "").trim().toLowerCase();
    if (!wanted) return false;
    if (String(row?.avatar || "").toLowerCase() === wanted) return true;
    const link = readDatacatExtension(row);
    return Boolean(link && link.datacatCharacterId === wanted);
  }

  function findContextCharacter(key) {
    return listContextCharacters().find((row) => matchRow(row, key)) || null;
  }

  async function resolveCharacter(key) {
    const fromContext = findContextCharacter(key);
    if (fromContext) return fromContext;
    const rows = await fetchAllCharacters();
    const direct = rows.find((row) => matchRow(row, key));
    if (direct) return direct;
    const wanted = String(key || "").toLowerCase();
    if (wanted.endsWith(".png")) {
      const full = await fetchCharacterRow(wanted);
      if (full) return full;
    }
    // Last resort: the key may be a Datacat id known from a previous scan.
    const known = linkCache.links.find((link) => link.datacatCharacterId === wanted);
    if (known) return fetchCharacterRow(known.lumiverseCharacterId);
    return null;
  }

  async function scanLinks({ force = false } = {}) {
    if (!force && linkCache.links.length && Date.now() - linkCache.loadedAt < 60_000) {
      return {
        links: linkCache.links,
        total: linkCache.links.length,
        scanned: linkCache.scanned || 0,
      };
    }
    if (linkCache.promise) return linkCache.promise;
    linkCache.promise = (async () => {
      const rows = await fetchAllCharacters({ force: true });
      let scanned = 0;
      const links = [];
      const seen = new Map();

      async function linkForRow(row) {
        let link = readDatacatExtension(row);
        if (!link && row?.shallow) {
          const full = await fetchCharacterRow(row.avatar);
          link = readDatacatExtension(full);
        }
        if (!link) return null;
        return {
          datacatCharacterId: link.datacatCharacterId,
          lumiverseCharacterId: String(row.avatar || ""),
          name: String(row.name || "Imported Datacat character").slice(0, 240),
          importedAt: normalizeTimestamp(
            link.importedAt || link.imported_at || row.create_date || row.date_added,
          ),
        };
      }

      // Lazy-loaded libraries can require one /get per character; keep a small
      // pool so large libraries finish well inside the UI's 45s budget.
      let cursor = 0;
      const workers = Array.from({ length: Math.min(6, rows.length || 1) }, async () => {
        while (cursor < rows.length) {
          const row = rows[cursor++];
          scanned += 1;
          const record = await linkForRow(row);
          if (!record) continue;
          const previous = seen.get(record.datacatCharacterId);
          if (
            !previous ||
            (Date.parse(record.importedAt || "") || 0) >
              (Date.parse(previous.importedAt || "") || 0)
          ) {
            seen.set(record.datacatCharacterId, record);
          }
        }
      });
      await Promise.all(workers);

      for (const record of seen.values()) links.push(record);
      links.sort(
        (a, b) =>
          (Date.parse(b.importedAt || "") || 0) - (Date.parse(a.importedAt || "") || 0),
      );

      linkCache.links = links;
      linkCache.loadedAt = Date.now();
      linkCache.scanned = scanned;
      return { links, total: links.length, scanned };
    })().finally(() => {
      linkCache.promise = null;
    });
    return linkCache.promise;
  }

  function emitBackend(payload) {
    for (const listener of backendListeners) {
      try {
        listener(payload);
      } catch (error) {
        console.error("[Datacat] backend listener failed", error);
      }
    }
  }

  async function handleBackendMessage(payload) {
    const type = String(payload?.type || "");
    const requestId = String(payload?.requestId || "");

    if (type === "datacat_toast") {
      toast(payload.tone, payload.message, payload.title);
      return;
    }
    if (type === "datacat_secure_state_request") {
      try {
        emitBackend({
          type: "datacat_secure_state_result",
          requestId,
          state: await client.secureState(),
        });
      } catch (error) {
        emitBackend({ type: "datacat_secure_state_error", requestId, error: String(error) });
      }
      return;
    }
    if (type === "datacat_clear_verification_request") {
      try {
        client.clearVerification();
        emitBackend({ type: "datacat_clear_verification_result", requestId });
      } catch (error) {
        emitBackend({ type: "datacat_clear_verification_error", requestId, error: String(error) });
      }
      return;
    }
    if (type === "datacat_api_request") {
      try {
        const response = await client.runRequest(payload.request || {});
        emitBackend({ type: "datacat_api_result", requestId, response });
      } catch (error) {
        console.warn("[Datacat] API request failed", payload?.request?.path, error);
        emitBackend({
          type: "datacat_api_error",
          requestId,
          error: error?.message || "Datacat request failed.",
        });
      }
      return;
    }
    if (type === "datacat_link_index_request") {
      try {
        const result = await scanLinks({ force: payload.force === true });
        emitBackend({
          type: "datacat_link_index_result",
          requestId,
          links: result.links,
          total: result.total,
          scanned: result.scanned,
        });
      } catch (error) {
        emitBackend({
          type: "datacat_link_index_error",
          requestId,
          error: error?.message || "Could not inspect the SillyTavern character library.",
        });
      }
      return;
    }
    if (type === "datacat_character_link_request") {
      try {
        let row = await resolveCharacter(payload.lumiverseCharacterId);
        let extension = readDatacatExtension(row);
        if (!extension && row?.avatar) {
          const full = await fetchCharacterRow(row.avatar);
          if (full) {
            row = full;
            extension = readDatacatExtension(full);
          }
        }
        const link = extension
          ? {
              datacatCharacterId: extension.datacatCharacterId,
              lumiverseCharacterId: String(row?.avatar || ""),
              name: String(row?.name || ""),
              ...(normalizeTimestamp(extension.importedAt)
                ? { importedAt: normalizeTimestamp(extension.importedAt) }
                : {}),
            }
          : null;
        emitBackend({ type: "datacat_character_link_result", requestId, link });
      } catch (error) {
        emitBackend({
          type: "datacat_character_link_error",
          requestId,
          error: "Could not inspect the active SillyTavern character.",
        });
      }
    }
  }

  // ---------------------------------------------------------------------
  // Drawer shell
  // ---------------------------------------------------------------------

  function buildOverlay() {
    if (overlay) return overlay;
    const shell = document.createElement("div");
    shell.id = SHELL_ID;
    shell.className = "dc-st-shell";
    shell.dataset.open = "false";
    shell.setAttribute("aria-hidden", "true");
    shell.innerHTML = `
      <header class="dc-st-header">
        <div class="dc-st-title">
          <span class="dc-st-cat" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M5.2 8.3 7 3.9l4.1 2.2c.6-.1 1.2-.1 1.8 0L17 3.9l1.8 4.4c1.3 1.4 2 3.2 2 5.1 0 4.3-3.9 7.6-8.8 7.6s-8.8-3.3-8.8-7.6c0-1.9.7-3.7 2-5.1Z" fill="currentColor"/><circle cx="8.6" cy="12.2" r="1.15" fill="#17101f"/><circle cx="15.4" cy="12.2" r="1.15" fill="#17101f"/><path d="M9.4 16c1.7 1 3.5 1 5.2 0" fill="none" stroke="#17101f" stroke-width="1.5" stroke-linecap="round"/></svg>
          </span>
          <h2>Datacat</h2>
        </div>
        <button type="button" class="dc-st-close" aria-label="Close Datacat" title="Close Datacat">&#10005;</button>
      </header>
      <div class="dc-source-bar" data-source-bar hidden>
        <div class="dc-source-tabs" data-source-tabs role="tablist"></div>
        <button class="dc-source-close" type="button" data-close-drawer aria-label="Close browser" title="Close">&#10005;</button>
      </div>
      <div class="dc-st-content"></div>`;
    document.body.append(shell);
    shell.querySelector(".dc-st-close")?.addEventListener("click", () => closeOverlay());
    overlay = shell;
    return shell;
  }

  function setSource(id, { activate = true } = {}) {
    if (!sources.has(id)) return;
    activeSource = id;
    for (const [key, source] of sources) {
      source.root.hidden = key !== id;
      const button = overlay?.querySelector(
        `.dc-source-tab[data-source="${key}"]`,
      );
      button?.classList.toggle("active", key === id);
      button?.setAttribute("aria-selected", String(key === id));
    }
    try {
      localStorage.setItem("datacat:source", id);
    } catch (_) {}
    if (activate) {
      try {
        sources.get(id).onActivate?.();
      } catch (error) {
        console.error("[Datacat] source activate failed", error);
      }
    }
  }

  function registerSource(options = {}) {
    const id = String(options.id || "").trim();
    if (!id || !options.root) return () => {};
    const shell = buildOverlay();
    const content = shell.querySelector(".dc-st-content");
    const bar = shell.querySelector("[data-source-bar]");
    const tabs = shell.querySelector("[data-source-tabs]");
    const root = options.root;
    root.classList.add("dc-source-panel");
    root.dataset.sourcePanel = id;
    root.hidden = true;
    content.append(root);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "dc-source-tab";
    button.dataset.source = id;
    button.setAttribute("role", "tab");
    button.textContent = String(options.label || id);
    button.addEventListener("click", () => setSource(id));
    tabs.append(button);

    sources.set(id, { id, root, onActivate: options.onActivate });
    bar.hidden = sources.size < 2;

    const saved = (() => {
      try {
        return localStorage.getItem("datacat:source");
      } catch (_) {
        return "";
      }
    })();
    if (!activeSource || saved === id) setSource(id, { activate: false });

    return () => {
      sources.delete(id);
      root.remove();
      button.remove();
      bar.hidden = sources.size < 2;
      if (activeSource === id) {
        activeSource = "";
        const next = sources.keys().next().value;
        if (next) setSource(next, { activate: false });
      }
    };
  }

  function openOverlay() {
    const shell = buildOverlay();
    shell.dataset.open = "true";
    shell.setAttribute("aria-hidden", "false");
    document.body.classList.add("dc-st-open");
    if (!activeSource) {
      const first = sources.keys().next().value;
      if (first) setSource(first);
    } else {
      setSource(activeSource);
    }
  }

  function closeOverlay() {
    if (!overlay) return;
    overlay.dataset.open = "false";
    overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("dc-st-open");
  }

  const onKeyDown = (event) => {
    if (event.key === "Escape" && overlay?.dataset.open === "true") {
      const modalOpen = document.querySelector(".dc-modal-backdrop[data-open='true']");
      if (!modalOpen) closeOverlay();
    }
  };
  const onDocumentClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-close-drawer]") && overlay?.dataset.open === "true") {
      closeOverlay();
    }
  };
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("click", onDocumentClick, true);

  ctx.dom = {
    addStyle(css) {
      const style = document.createElement("style");
      style.dataset.datacat = "ui";
      style.textContent = String(css || "");
      document.head.append(style);
      return () => style.remove();
    },
    createElement(tag, attributes = {}) {
      const element = document.createElement(tag);
      for (const [key, value] of Object.entries(attributes || {})) {
        if (key === "class") element.className = value;
        else if (key === "text") element.textContent = value;
        else element.setAttribute(key, value);
      }
      return element;
    },
  };

  ctx.ui = {
    registerDrawerTab(options = {}) {
      const root = document.createElement("div");
      root.className = "dc-st-tab-root";
      const listeners = new Set();
      let unregisterSource = null;
      const runListeners = () => {
        for (const callback of listeners) {
          try {
            callback();
          } catch (error) {
            console.error("[Datacat] activate listener failed", error);
          }
        }
      };
      activeTab = {
        root,
        listeners,
        activate() {
          setSource("datacat");
          openOverlay();
        },
        onActivate(callback) {
          if (typeof callback !== "function") return () => {};
          listeners.add(callback);
          return () => listeners.delete(callback);
        },
        destroy() {
          listeners.clear();
          unregisterSource?.();
          activeTab = null;
          if (overlay && !overlay.querySelector(".dc-source-panel")) {
            overlay.remove();
            overlay = null;
            document.body.classList.remove("dc-st-open");
          }
        },
        title: options.title || "Datacat",
      };
      root.dataset.drawer = String(options.id || "datacat");
      unregisterSource = registerSource({
        id: "datacat",
        label: options.title || "Datacat",
        root,
        onActivate: runListeners,
      });
      return activeTab;
    },

    registerSourcePanel(options = {}) {
      return registerSource(options);
    },

    showModal(options = {}) {
      const backdrop = document.createElement("div");
      backdrop.className = "dc-modal-backdrop";
      backdrop.dataset.open = "true";
      const container = document.createElement("div");
      container.className = "dc-modal-container";
      if (options.width) container.style.width = `min(${Number(options.width)}px, calc(100vw - 24px))`;
      const header = document.createElement("header");
      header.className = "dc-modal-header";
      const title = document.createElement("h2");
      title.textContent = String(options.title || "Datacat");
      const close = document.createElement("button");
      close.type = "button";
      close.className = "dc-modal-close";
      close.setAttribute("aria-label", "Close");
      close.innerHTML = "&#10005;";
      header.append(title, close);
      const body = document.createElement("div");
      body.className = "dc-modal-body";
      if (options.maxHeight) body.style.maxHeight = `${Number(options.maxHeight)}px`;
      container.append(header, body);
      backdrop.append(container);
      document.body.append(backdrop);

      let dismissed = false;
      const dismissListeners = new Set();
      const api = {
        root: body,
        setTitle(value) {
          title.textContent = String(value || "Datacat");
        },
        onDismiss(callback) {
          if (typeof callback === "function") dismissListeners.add(callback);
        },
        dismiss() {
          if (dismissed) return;
          dismissed = true;
          backdrop.dataset.open = "false";
          for (const callback of dismissListeners) {
            try {
              callback();
            } catch (error) {
              console.error("[Datacat] modal dismiss listener failed", error);
            }
          }
          backdrop.remove();
        },
      };
      close.addEventListener("click", () => api.dismiss());
      backdrop.addEventListener("pointerdown", (event) => {
        if (event.target === backdrop) api.dismiss();
      });
      return api;
    },

    registerInputBarAction(options = {}) {
      const listeners = new Set();
      let destroyed = false;
      const item = document.createElement("div");
      item.className = "list-group-item flex-container flexGap5 interactable dc-wand-item";
      item.tabIndex = 0;
      item.dataset.datacatAction = String(options.id || "datacat");
      item.innerHTML = `
        <div class="fa-solid fa-heart dc-wand-icon" aria-hidden="true"></div>
        <span>${String(options.label || "Datacat")}</span>`;
      if (options.iconSvg) {
        item.querySelector(".dc-wand-icon").innerHTML = options.iconSvg;
      }
      const trigger = () => {
        for (const listener of listeners) {
          try {
            listener();
          } catch (error) {
            console.error("[Datacat] action listener failed", error);
          }
        }
      };
      item.addEventListener("click", trigger);
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          trigger();
        }
      });

      const attach = () => {
        if (destroyed) return;
        const menu = document.getElementById("extensionsMenu");
        if (menu) menu.append(item);
        else setTimeout(attach, 500);
      };
      attach();

      return {
        onClick(callback) {
          if (typeof callback === "function") listeners.add(callback);
          return () => listeners.delete(callback);
        },
        destroy() {
          destroyed = true;
          listeners.clear();
          item.remove();
        },
      };
    },
  };

  ctx.permissions = {
    async getGranted() {
      return ["characters", "cors_proxy"];
    },
    async request(permissions) {
      return Array.isArray(permissions) ? permissions : ["characters", "cors_proxy"];
    },
  };

  ctx.sendToBackend = (payload) => {
    void handleBackendMessage(payload);
  };

  ctx.onBackendMessage = (callback) => {
    if (typeof callback !== "function") return () => {};
    backendListeners.add(callback);
    return () => backendListeners.delete(callback);
  };

  ctx.getActiveChat = () => {
    const current = context();
    const index = current?.characterId;
    if (index === undefined || index === null) return null;
    const row = listContextCharacters()[index];
    return row ? { characterId: String(row.avatar || "") } : null;
  };

  ctx.events = {
    emit(name, detail) {
      document.dispatchEvent(new CustomEvent(`datacat:${name}`, { detail }));
    },
  };

  ctx.characters = {
    async get(key) {
      const row = await resolveCharacter(key);
      return row ? normalizeCharacter(row) : null;
    },
    avatarUrl(key) {
      const value = String(key || "");
      if (!value) return "";
      const exact = listContextCharacters().find(
        (row) => String(row?.avatar || "").toLowerCase() === value.toLowerCase(),
      );
      if (exact?.avatar) return `/characters/${encodeURIComponent(exact.avatar)}`;
      if (value.toLowerCase().endsWith(".png")) return `/characters/${encodeURIComponent(value)}`;
      const row = findContextCharacter(value);
      if (row?.avatar) return `/characters/${encodeURIComponent(row.avatar)}`;
      const link = linkCache.links.find((entry) => entry.datacatCharacterId === value.toLowerCase());
      if (link?.lumiverseCharacterId) {
        return `/characters/${encodeURIComponent(link.lumiverseCharacterId)}`;
      }
      return "";
    },
    extensionIds(key) {
      const ids = new Set();
      for (const row of listContextCharacters()) {
        const extension =
          row?.data?.extensions?.[key] || row?.extensions?.[key] || null;
        const id = String(
          extension?.id || extension?.characterId || extension?.character_id || "",
        ).trim();
        if (id) ids.add(id);
      }
      return ids;
    },
    async downloadFromLink(url) {
      const response = await fetch("/api/content/importURL", {
        method: "POST",
        headers: getRequestHeaders(),
        body: JSON.stringify({ url: String(url || "") }),
        cache: "no-store",
      });
      return readPngResponse(response, "SillyTavern link import");
    },
    async downloadFromUuid(value) {
      const response = await fetch("/api/content/importUUID", {
        method: "POST",
        headers: getRequestHeaders(),
        body: JSON.stringify({ url: String(value || "") }),
        cache: "no-store",
      });
      return readPngResponse(response, "SillyTavern UUID import");
    },
    async import({ card, avatarFile, extensions }) {
      const stCard = toSillyTavernCard(card, extensions);
      const json = new Blob([JSON.stringify(stCard)], { type: "application/json" });
      const form = new FormData();
      form.append(
        "avatar",
        new File([json], `${String(stCard.data.name || "character").slice(0, 60)}.json`, {
          type: "application/json",
        }),
      );
      form.append("file_type", "json");
      form.append("user_name", String(context()?.name1 || "User"));

      const imported = await fetch("/api/characters/import", {
        method: "POST",
        body: form,
        headers: getRequestHeaders({ omitContentType: true }),
        cache: "no-store",
      });
      const payload = await imported.json().catch(() => ({}));
      if (!imported.ok || payload?.error || !payload?.file_name) {
        throw new Error("SillyTavern rejected the character card.");
      }

      let avatarName = `${payload.file_name}.png`;
      if (avatarFile) {
        try {
          // SillyTavern converts the uploaded image to PNG with Jimp, which
          // already understands webp and avif. Skip the browser canvas step
          // unless the host image is in a format Jimp cannot read.
          const supported = [
            "image/png",
            "image/webp",
            "image/avif",
            "image/jpeg",
            "image/jpg",
            "image/gif",
            "image/bmp",
            "image/tiff",
          ];
          const type = String(avatarFile.type || "").toLowerCase();
          const upload = supported.includes(type) ? avatarFile : await imageToPng(avatarFile);
          if (upload) {
            const avatarForm = new FormData();
            avatarForm.append("avatar", upload, upload.name || "avatar.png");
            avatarForm.append("avatar_url", avatarName);
            const uploaded = await fetch("/api/characters/edit-avatar", {
              method: "POST",
              body: avatarForm,
              headers: getRequestHeaders({ omitContentType: true }),
              cache: "no-store",
            });
            if (!uploaded.ok) {
              toast("warning", "The character was imported, but its Datacat image could not be attached.", "Datacat");
            }
          }
        } catch (error) {
          console.error("[Datacat] avatar upload failed", error);
          toast("warning", "The character was imported, but its Datacat image could not be attached.", "Datacat");
        }
      }

      characterListCache.loadedAt = 0;
      linkCache.loadedAt = 0;
      if (typeof refreshCharacters === "function") {
        try {
          await refreshCharacters();
        } catch (error) {
          console.warn("[Datacat] character list refresh failed", error);
        }
      }
      const row = (await fetchCharacterRow(avatarName)) || {
        avatar: avatarName,
        name: String(stCard.data.name || "Character"),
        data: stCard.data,
      };
      avatarName = row.avatar || avatarName;
      const character = normalizeCharacter(row);
      character.id = avatarName;
      return character;
    },
    async openChat(key) {
      const row = await resolveCharacter(key);
      if (!row?.avatar) {
        throw new Error("Import this character into SillyTavern before opening a chat.");
      }
      const chars = listContextCharacters();
      let index = chars.findIndex((entry) => entry.avatar === row.avatar);
      if (index < 0) {
        try {
          if (typeof refreshCharacters === "function") await refreshCharacters();
          else await fetchAllCharacters({ force: true });
        } catch (error) {
          console.warn("[Datacat] character list refresh failed", error);
        }
        index = listContextCharacters().findIndex((entry) => entry.avatar === row.avatar);
      }
      if (index < 0) {
        throw new Error("SillyTavern has not loaded this character yet. Reload and try again.");
      }
      closeOverlay();
      await selectCharacterById(index);
    },
  };

  ctx.version = version;
  ctx.open = openOverlay;
  ctx.openSource = (id) => {
    if (!sources.has(id)) return;
    setSource(id);
    openOverlay();
  };
  ctx.close = closeOverlay;
  ctx.dispose = () => {
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("click", onDocumentClick, true);
  };
  return ctx;
}
