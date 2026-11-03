/**
 * CharArc source panel.
 *
 * CharArc (chararc.bernkastel.pictures) is an archive of AI character cards
 * scraped from multiple sources (chub.ai, booru, nyaime, risuai, webring,
 * char-tavern, generic). It exposes a clean public API:
 *
 *   GET /api/archive/v3/search/query?query=...&page=N&count=N
 *   GET /api/archive/v1/${source}/node/${type}/${author}/${id}
 *   GET /api/archive/v1/${source}/image/character/${path}
 *   GET /api/archive/v1/download/${source}/${id_or_path}
 *   GET /api/archive/v1/info
 *
 * Cards are imported as JSONV2 characters through SillyTavern's normal
 * character import. Images are fetched from CharArc's avatar API and attached
 * as the character avatar.
 *
 * Because CharArc cards may come from external sources, avatar URLs sometimes
 * point outside chararc.bernkastel.pictures. Those are fetched directly when
 * the host permits cross-origin image loads.
 */

const SEARCH_URL = "https://chararc.bernkastel.pictures/api/archive/v3/search/query";
const AVATAR_BASE = "https://chararc.bernkastel.pictures/api/archive/v1";
const NODE_BASE = "https://chararc.bernkastel.pictures/api/archive/v1";
const IMPORTED_KEY = "datacat:chararc-imported";

import { readCardFromPng } from "./janny.js";

const SOURCE_LABELS = {
  chub: "Chub.ai",
  booru: "Booru",
  nyaime: "Nyaime",
  risuai: "RisuAI",
  webring: "Webring",
  "char-tavern": "CharTavern",
  generic: "Generic",
};

const TAG_MAP = {
  sfw: "SFW",
  nsfw: "NSFW",
  male: "Male",
  female: "Female",
  anypov: "AnyPOV",
  maleonly: "Male Only",
  femaleonly: "Female Only",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function stripHtml(value) {
  const template = document.createElement("template");
  template.innerHTML = String(value || "");
  return String(template.content.textContent || "").replace(/\s+/g, " ").trim();
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}m`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(1)}k`;
  return String(number);
}

function formatDate(value) {
  const date = new Date(String(value || "").replace(" ", "T"));
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function readImported() {
  try {
    const parsed = JSON.parse(localStorage.getItem(IMPORTED_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function saveImported(map) {
  try {
    localStorage.setItem(IMPORTED_KEY, JSON.stringify(map));
  } catch (_) {}
}

function sourceLabel(source) {
  return SOURCE_LABELS[source] || source;
}

function pageUrl(hit) {
  const source = String(hit?.source || "generic").toLowerCase();
  const author = String(hit?.author || "unknown");
  const id = String(hit?.id || "");
  return `https://chararc.bernkastel.pictures/${source}/${encodeURIComponent(author)}/${encodeURIComponent(id)}`;
}

function avatarUrl(hit, size = 200) {
  const source = String(hit?.source || "").toLowerCase();
  const path = hit?.chub?.fullPath
    ? hit.chub.fullPath.join("/")
    : hit?.author && hit?.id
      ? `${encodeURIComponent(hit.author)}/${encodeURIComponent(hit.id)}`
      : "";
  if (!path) return "";
  return `${AVATAR_BASE}/${source}/image/character/${path}?max=${size}&optimize=true`;
}

export function createCharArcView({ ctx }) {
  const state = {
    query: "",
    sort: "newest",
    showNsfw: true,
    page: 1,
    hits: [],
    total: 0,
    loading: false,
    error: "",
    imported: readImported(),
  };

  const root = document.createElement("section");
  root.className = "ca-root";
  root.innerHTML = `
    <header class="ca-toolbar">
      <div class="ca-brand">CharArc</div>
      <input class="ca-search" type="search" placeholder="Search CharArc…" autocomplete="off" data-search>
      <select class="ca-select" data-sort aria-label="Sort">
        <option value="newest">Newest</option>
        <option value="tokens">Most tokens</option>
        <option value="relevance">Relevance</option>
      </select>
      <label class="ca-toggle"><input type="checkbox" data-nsfw checked> NSFW</label>
      <button class="ca-button ca-import-button" type="button" data-import-file>Import PNG</button>
    </header>
    <div class="ca-status" data-status>Search CharArc or pick a character.</div>
    <div class="ca-grid" data-grid></div>
    <div class="ca-more-row">
      <button class="ca-button" type="button" data-more hidden>Load more</button>
    </div>
    <input type="file" accept="image/png,.png" hidden data-file>
  `;

  const searchInput = root.querySelector("[data-search]");
  const sortSelect = root.querySelector("[data-sort]");
  const nsfwInput = root.querySelector("[data-nsfw]");
  const status = root.querySelector("[data-status]");
  const grid = root.querySelector("[data-grid]");
  const moreButton = root.querySelector("[data-more]");
  const fileInput = root.querySelector("[data-file]");
  let searchTimer = 0;
  let pendingSearch = null;
  let pendingImport = null;

  function toast(tone, message, title = "CharArc") {
    ctx.sendToBackend?.({
      type: "datacat_toast",
      tone,
      title,
      message,
    });
  }

  function setStatus(message, error = false) {
    status.textContent = message;
    status.dataset.error = String(error);
  }

  function render() {
    if (!state.hits.length) {
      grid.innerHTML = "";
      moreButton.hidden = true;
      if (!state.loading && !state.error) {
        setStatus(state.query ? "No characters match that search." : "Search CharArc or pick a character.");
      }
      return;
    }
    grid.innerHTML = state.hits
      .map((hit) => {
        const id = String(hit.id || hit?.chub?.id || "");
        const source = String(hit.source || "generic").toLowerCase();
        const imported = Boolean(state.imported[id]);
        const description = stripHtml(hit.description || hit.tagline || "").slice(0, 220);
        const tags = [];
        if (hit.type) tags.push(hit.type);
        if (hit.tags) tags.push(...hit.tags);
        if (hit.source) tags.push(sourceLabel(source));
        if (hit.token_count) tags.push(`${formatNumber(hit.token_count)} tokens`);
        return `
          <article class="ca-card" data-id="${escapeHtml(id)}">
            <button class="ca-cover" type="button" data-detail="${escapeHtml(id)}" aria-label="Open details">
              <img src="${escapeHtml(avatarUrl(hit))}" alt="" loading="lazy">
            </button>
            <div class="ca-card-copy">
              <button class="ca-card-title" type="button" data-detail="${escapeHtml(id)}">${escapeHtml(hit.name || "Unnamed")}</button>
              <div class="ca-meta">${escapeHtml(formatDate(hit.createdAt || hit.added))}</div>
              <p class="ca-description">${escapeHtml(description || "No description.")}</p>
              <div class="ca-tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
              <div class="ca-card-actions">
                <button class="ca-button" type="button" data-open="${escapeHtml(id)}">Open page</button>
                <button class="ca-button ${imported ? "secondary" : "primary"}" type="button" data-import="${escapeHtml(id)}">${imported ? "Imported" : "Import"}</button>
              </div>
            </div>
          </article>`;
      })
      .join("");
    moreButton.hidden = state.hits.length >= state.total || state.total === 0;
    if (state.loading) setStatus("Loading…");
    else if (state.error) setStatus(state.error, true);
    else {
      setStatus(`${state.hits.length.toLocaleString()} of ${state.total.toLocaleString()} characters`);
    }
  }

  async function search({ reset = false } = {}) {
    if (state.loading) {
      pendingSearch = { reset };
      return;
    }
    if (reset) {
      state.page = 1;
      state.hits = [];
      state.total = 0;
      state.error = "";
      render();
    }
    state.loading = true;
    render();
    try {
      const params = new URLSearchParams({
        query: state.query || "",
        page: String(state.page),
        count: "20",
      });
      const response = await fetch(`${SEARCH_URL}?${params}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });
      console.log("[CharArc] search response, status:", response.status, "ok:", response.ok);
      const payload = await response.json().catch(() => ({}));
      console.log("[CharArc] search payload keys:", Object.keys(payload || {}));
      if (!response.ok || payload?.error) {
        throw new Error(String(payload?.error || `CharArc search failed (${response.status}).`));
      }
      const results = Array.isArray(payload.result) ? payload.result : [];
      const total = Number(payload.totalPages || payload.total || 0) * 24;
      state.hits = reset ? results : [...state.hits, ...results];
      state.total = Math.max(total, state.hits.length);
      state.page += 1;
      state.error = "";
    } catch (error) {
      state.error = error?.message || "Could not search CharArc.";
    } finally {
      state.loading = false;
      render();
      if (pendingSearch) {
        const next = pendingSearch;
        pendingSearch = null;
        void search(next);
      }
    }
  }

  function findHit(id) {
    return state.hits.find((hit) => String(hit.id || hit?.chub?.id) === String(id)) || null;
  }

  async function openDetail(id) {
    const hit = findHit(id);
    if (!hit) return;
    const source = String(hit.source || "generic").toLowerCase();
    const path = hit?.chub?.fullPath
      ? hit.chub.fullPath.join("/")
      : hit?.author && hit?.id
        ? `${encodeURIComponent(hit.author)}/${encodeURIComponent(hit.id)}`
        : "";
    let character = hit;
    if (path) {
      try {
        const type = hit.type || "character";
        const response = await fetch(`${NODE_BASE}/${source}/node/${type}/${path}`);
        if (response.ok) {
          const node = await response.json();
          if (node && typeof node === "object") {
            character = { ...hit, ...node };
          }
        }
      } catch (_) {
        // Keep search result data if node fetch fails.
      }
    }
    const modal = ctx.ui.showModal({
      title: character.name || "CharArc character",
      width: 720,
      maxHeight: Math.max(420, window.innerHeight - 32),
    });
    const tags = [];
    if (character.type) tags.push(character.type);
    if (character.tags) tags.push(...character.tags);
    if (character.source) tags.push(sourceLabel(String(character.source).toLowerCase()));
    if (character.token_count) tags.push(`${formatNumber(character.token_count)} tokens`);
    modal.root.innerHTML = `
      <div class="ca-detail">
        <img class="ca-detail-avatar" src="${escapeHtml(avatarUrl(character))}" alt="">
        <div class="ca-detail-copy">
          <div class="ca-meta">${escapeHtml(formatDate(character.createdAt || character.added))}</div>
          <p>${escapeHtml(stripHtml(character.description || character.tagline || "")).slice(0, 500) || "No description."}</p>
          <div class="ca-tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
          <div class="ca-card-actions">
            <button class="ca-button" type="button" data-modal-open="${escapeHtml(String(id))}">Open on CharArc</button>
            <button class="ca-button primary" type="button" data-modal-auto="${escapeHtml(String(id))}">Import via SillyTavern</button>
            <button class="ca-button" type="button" data-modal-import="${escapeHtml(String(id))}">Import downloaded PNG</button>
          </div>
          <p class="ca-hint">"Import via SillyTavern" asks the app to fetch the card. If blocked, download the card PNG and use "Import downloaded PNG".</p>
        </div>
      </div>`;
    modal.root.querySelector("[data-modal-open]")?.addEventListener("click", () => {
      openExternal(pageUrl(character));
    });
    modal.root.querySelector("[data-modal-auto]")?.addEventListener("click", () => {
      modal.dismiss();
      void importFromLinkWithFeedback(character);
    });
    modal.root.querySelector("[data-modal-import]")?.addEventListener("click", () => {
      modal.dismiss();
      chooseFile(character);
    });
  }

  function openExternal(url) {
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.style.display = "none";
    document.body.append(link);
    link.click();
    link.remove();
  }

  function chooseFile(hit = null) {
    pendingImport = hit;
    fileInput.value = "";
    fileInput.click();
  }

  async function importCardBlob(blob, hit, fallbackName = "character") {
    setStatus("Reading character card…");
    const card = await readCardFromPng(blob);
    const id = String(hit?.id || hit?.chub?.id || "").trim();
    const name = String(
      card?.data?.name || card?.name || fallbackName || "character",
    );
    const extensions = {};
    if (id) {
      extensions.chararc = {
        id,
        name,
        pageUrl: hit ? pageUrl(hit) : "",
        importedAt: new Date().toISOString(),
        source: "chararc",
      };
    }
    const avatarFile =
      blob instanceof File
        ? blob
        : new File([blob], `${name.replace(/[^\w.-]+/g, "_").slice(0, 60) || "character"}.png`, {
            type: "image/png",
          });
    const character = await ctx.characters.import({
      card,
      avatarFile,
      extensions,
    });
    if (id) {
      state.imported[id] = String(character?.name || name);
      saveImported(state.imported);
    }
    toast("success", `${character?.name || name} imported`, "CharArc");
    render();
    setStatus(`Imported ${character?.name || name}.`);
    return character;
  }

  async function importFile(file) {
    if (!file) return;
    const hit =
      pendingImport || findHit(fileInput.dataset.hitId || "") || null;
    return importCardBlob(file, hit, file.name.replace(/\.png$/i, ""));
  }

  async function importFromLink(hit) {
    const source = String(hit.source || "generic").toLowerCase();
    const path = hit?.chub?.fullPath
      ? hit.chub.fullPath.join("/")
      : hit?.author && hit?.id
        ? `${encodeURIComponent(hit.author)}/${encodeURIComponent(hit.id)}`
        : "";
    const candidates = [
      pageUrl(hit),
      `${NODE_BASE}/${source}/node/${hit.type || "character"}/${path}`,
    ];
    let lastError = null;
    for (const url of candidates) {
      try {
        const blob = await ctx.characters.downloadFromLink(url);
        return await importCardBlob(blob, hit);
      } catch (error) {
        lastError = error;
      }
    }
    try {
      const blob = await ctx.characters.downloadFromUuid(`${id}_character`);
      return await importCardBlob(blob, hit);
    } catch (error) {
      lastError = error;
    }
    throw lastError || new Error("SillyTavern could not import this CharArc card.");
  }

  async function importFromLinkWithFeedback(hit) {
    const id = String(hit.id || hit?.chub?.id || "").trim();
    if (!id || state.imported[id]) return;
    const button = root.querySelector(`[data-import="${escapeHtml(id)}"]`);
    if (button) {
      button.disabled = true;
      button.textContent = "Importing…";
    }
    try {
      await importFromLink(hit);
    } catch (error) {
      const message = String(error?.message || "Automatic import failed.");
      toast(
        "error",
        `${message} Use Open page → Download → Import PNG instead.`,
        "CharArc import failed",
      );
      setStatus(`${message} Use Open page → Download → Import PNG.`, true);
      openDetail(id);
    } finally {
      if (button?.isConnected) {
        button.disabled = false;
        button.textContent = state.imported[id] ? "Imported" : "Import";
      }
    }
  }

  root.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const detail = target.closest("[data-detail]");
    if (detail) {
      openDetail(detail.getAttribute("data-detail"));
      return;
    }
    const open = target.closest("[data-open]");
    if (open) {
      const hit = findHit(open.getAttribute("data-open"));
      if (hit) openExternal(pageUrl(hit));
      return;
    }
    const importButton = target.closest("[data-import]");
    if (importButton) {
      const hit = findHit(importButton.getAttribute("data-import"));
      if (hit) void importFromLinkWithFeedback(hit);
      return;
    }
    if (target.closest("[data-import-file]")) {
      chooseFile(null);
      return;
    }
    if (target.closest("[data-more]")) {
      void search();
    }
  });

  searchInput.addEventListener("input", () => {
    state.query = String(searchInput.value || "").trim();
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      void search({ reset: true });
    }, 350);
  });

  searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    window.clearTimeout(searchTimer);
    state.query = String(searchInput.value || "").trim();
    void search({ reset: true });
  });

  sortSelect.addEventListener("change", () => {
    state.sort = sortSelect.value;
    void search({ reset: true });
  });

  nsfwInput.addEventListener("change", () => {
    state.showNsfw = nsfwInput.checked;
    void search({ reset: true });
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    void importFile(file).catch((error) => {
      const message = error?.message || "Could not import that PNG.";
      toast("error", message, "CharArc import failed");
      setStatus(message, true);
    });
  });

  render();

  return {
    root,
    activate() {
      console.log("[CharArc] activate called, hits:", state.hits.length, "loading:", state.loading);
      if (!state.hits.length && !state.loading) void search({ reset: true });
      else if (state.hits.length) render();
    },
    destroy() {
      window.clearTimeout(searchTimer);
      root.remove();
    },
  };
}
