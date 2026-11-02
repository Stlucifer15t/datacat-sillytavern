/**
 * JannyAI source panel.
 *
 * JannyAI has no official public API and its card download endpoint is behind
 * Cloudflare. This panel therefore covers what is reliably available to a
 * browser extension: the public Meilisearch catalogue (search, tags, sorting,
 * avatars) plus a manual PNG import path:
 *
 *   1. Open the character on JannyAI.
 *   2. Use JannyAI's Download button.
 *   3. Pick the downloaded PNG here; the embedded V2 card is read from the
 *      PNG and imported through SillyTavern's normal character import.
 *
 * The Meilisearch key below is a public read-only key served by JannyAI's own
 * frontend. It can rotate; the extension shows a clear error if it does.
 */

const SEARCH_URL = "https://search.jannyai.com/multi-search";
const SEARCH_TOKEN = "88a6463b66e04fb07ba87ee3db06af337f492ce511d93df6e2d2968cb2ff2b30";
const SITE_BASE = "https://jannyai.com";
const IMAGE_BASE = "https://image.jannyai.com/bot-avatars/";
const IMPORTED_KEY = "datacat:janny-imported";

const JANNY_CSS = `
.dj-root {
  width: 100%; height: 100%; min-height: 0; overflow-y: auto;
  background: #100c17; color: #fff8e8; font: inherit;
}
.dj-root *, .dj-root *::before, .dj-root *::after { box-sizing: border-box; }
.dj-toolbar {
  position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap;
  align-items: center; gap: 8px; padding: 10px 12px;
  background: #17101f; border-bottom: 1px solid rgba(246, 200, 76, .18);
}
.dj-brand { font-weight: 700; letter-spacing: .02em; color: #f6c84c; }
.dj-search {
  flex: 1 1 220px; min-width: 0; padding: 8px 11px;
  border: 1px solid rgba(246, 200, 76, .22); border-radius: 9px;
  background: #100c17; color: #fff8e8; font: inherit;
}
.dj-search:focus { outline: none; border-color: #f6c84c; }
.dj-select {
  padding: 8px 10px; border: 1px solid rgba(246, 200, 76, .22); border-radius: 9px;
  background: #100c17; color: #fff8e8; font: inherit;
}
.dj-toggle {
  display: inline-flex; align-items: center; gap: 5px;
  color: #b9adbf; font-size: 13px; white-space: nowrap;
}
.dj-button {
  padding: 7px 12px; border: 1px solid rgba(246, 200, 76, .25); border-radius: 9px;
  background: rgba(246, 200, 76, .08); color: #fff8e8; font: inherit;
  font-size: 13px; font-weight: 600; cursor: pointer;
}
.dj-button:hover, .dj-button:focus-visible { border-color: #f6c84c; outline: none; }
.dj-button.primary { background: #f6c84c; border-color: #f6c84c; color: #17101f; }
.dj-button.secondary { opacity: .65; }
.dj-import-button { flex: 0 0 auto; }
.dj-tag-row {
  display: flex; gap: 6px; padding: 8px 12px 2px; overflow-x: auto;
  scrollbar-width: none;
}
.dj-tag-row::-webkit-scrollbar { display: none; }
.dj-tag {
  flex: 0 0 auto; padding: 4px 10px; border: 1px solid rgba(246, 200, 76, .18);
  border-radius: 999px; background: transparent; color: #b9adbf;
  font-size: 12px; cursor: pointer;
}
.dj-tag.active { background: rgba(246, 200, 76, .18); border-color: #f6c84c; color: #fff8e8; }
.dj-howto {
  padding: 2px 12px 6px; color: #b9adbf; font-size: 11.5px;
}
.dj-status { padding: 8px 12px; color: #b9adbf; font-size: 12px; }
.dj-status[data-error="true"] { color: #ff9b9b; }
.dj-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 12px; padding: 4px 12px 16px;
}
.dj-card {
  display: flex; flex-direction: column; overflow: hidden;
  border: 1px solid rgba(246, 200, 76, .18); border-radius: 12px; background: #191221;
}
.dj-cover { display: block; width: 100%; padding: 0; border: 0; background: #0f0b16; cursor: pointer; }
.dj-cover img { display: block; width: 100%; aspect-ratio: 3 / 4; object-fit: cover; }
.dj-card-copy { display: flex; flex: 1 1 auto; flex-direction: column; gap: 5px; padding: 10px; }
.dj-card-title {
  padding: 0; border: 0; background: transparent; color: #fff8e8;
  font: inherit; font-size: 14px; font-weight: 700; text-align: left; cursor: pointer;
}
.dj-card-title:hover { color: #f6c84c; }
.dj-meta { color: #b9adbf; font-size: 11px; }
.dj-description {
  display: -webkit-box; margin: 0; overflow: hidden; color: #d8cfdf;
  font-size: 12px; line-height: 1.35; -webkit-box-orient: vertical; -webkit-line-clamp: 4;
}
.dj-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.dj-tags span {
  padding: 2px 7px; border-radius: 999px; background: rgba(156, 107, 210, .16);
  color: #cdb7e3; font-size: 10px;
}
.dj-card-actions { display: flex; gap: 6px; margin-top: auto; padding-top: 6px; }
.dj-card-actions .dj-button { flex: 1 1 auto; padding: 6px 8px; text-align: center; }
.dj-more-row { display: flex; justify-content: center; padding: 0 12px 24px; }
.dj-detail { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 14px; }
.dj-detail-avatar { width: 100%; border-radius: 10px; object-fit: cover; }
.dj-detail-copy p {
  margin: 0 0 10px; color: #e6dfea; font-size: 13px; line-height: 1.45; white-space: pre-wrap;
}
.dj-hint { color: #b9adbf !important; font-size: 12px !important; }
@media (max-width: 560px) {
  .dj-detail { grid-template-columns: 1fr; }
  .dj-detail-avatar { max-width: 180px; }
  .dj-grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
}
`;

const TAG_MAP = {
  1: "Male", 2: "Female", 3: "Non-binary", 4: "Celebrity", 5: "OC",
  6: "Fictional", 7: "Real", 8: "Game", 9: "Anime", 10: "Historical",
  11: "Royalty", 12: "Detective", 13: "Hero", 14: "Villain", 15: "Magical",
  16: "Non-human", 17: "Monster", 18: "Monster Girl", 19: "Alien", 20: "Robot",
  21: "Politics", 22: "Vampire", 23: "Giant", 24: "OpenAI", 25: "Elf",
  26: "Multiple", 27: "VTuber", 28: "Dominant", 29: "Submissive", 30: "Scenario",
  31: "Pokemon", 32: "Assistant", 34: "Non-English", 36: "Philosophy",
  38: "RPG", 39: "Religion", 41: "Books", 42: "AnyPOV", 43: "Angst",
  44: "Demi-Human", 45: "Enemies to Lovers", 46: "Smut", 47: "MLM",
  48: "WLW", 49: "Action", 50: "Romance", 51: "Horror", 52: "Slice of Life",
  53: "Fantasy", 54: "Drama", 55: "Comedy", 56: "Mystery", 57: "Sci-Fi",
  59: "Yandere", 60: "Furry", 61: "Movies/TV",
};

const FILTER_TAGS = [2, 1, 42, 53, 50, 46, 59, 16, 26, 52, 55, 57, 9, 18];

const SORTS = [
  { value: "relevance", label: "Relevance" },
  { value: "newest", label: "Newest" },
  { value: "tokens", label: "Most tokens" },
];

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

function slugify(value) {
  return String(value || "character")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "character";
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

function pageUrl(hit) {
  const id = String(hit?.id || "").trim();
  if (!id) return SITE_BASE;
  return `${SITE_BASE}/characters/${id}_character-${slugify(hit?.name)}`;
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

function base64ToBytes(value) {
  const binary = atob(String(value || "").replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function readTextChunk(keyword, data) {
  if (keyword !== "chara") return "";
  return new TextDecoder("latin1").decode(data);
}

export async function readCardFromPng(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (signature.some((value, index) => bytes[index] !== value)) {
    throw new Error("That file is not a PNG.");
  }
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
    const length = view.getUint32(0);
    if (offset + 12 + length > bytes.length) break;
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    const data = bytes.subarray(offset + 8, offset + 8 + length);

    if (type === "tEXt") {
      const zero = data.indexOf(0);
      if (zero > 0) {
        const keyword = new TextDecoder("latin1").decode(data.subarray(0, zero));
        const text = readTextChunk(keyword, data.subarray(zero + 1));
        if (text) {
          return JSON.parse(new TextDecoder().decode(base64ToBytes(text)));
        }
      }
    }

    if (type === "iTXt") {
      const zero = data.indexOf(0);
      if (zero > 0) {
        const keyword = new TextDecoder("latin1").decode(data.subarray(0, zero));
        if (keyword === "chara") {
          let cursor = zero + 1;
          const compressed = data[cursor] === 1;
          cursor += 2;
          const languageEnd = data.indexOf(0, cursor);
          cursor = languageEnd >= 0 ? languageEnd + 1 : cursor;
          const translatedEnd = data.indexOf(0, cursor);
          cursor = translatedEnd >= 0 ? translatedEnd + 1 : cursor;
          if (!compressed) {
            const text = new TextDecoder().decode(data.subarray(cursor));
            return JSON.parse(text);
          }
        }
      }
    }

    offset += 12 + length;
  }
  throw new Error("This PNG has no embedded character card. Use the card PNG from JannyAI, not the avatar image.");
}

export function createJannyView({ ctx, getToken }) {
  const searchToken = () => String(getToken?.() || "").trim() || SEARCH_TOKEN;
  const state = {
    query: "",
    sort: "relevance",
    showNsfw: true,
    tags: new Set(),
    page: 1,
    hits: [],
    total: 0,
    loading: false,
    error: "",
    imported: readImported(),
  };

  const root = document.createElement("section");
  root.className = "dj-root";
  const removeStyle = ctx.dom.addStyle(JANNY_CSS);
  root.innerHTML = `
    <header class="dj-toolbar">
      <div class="dj-brand">JannyAI</div>
      <input class="dj-search" type="search" placeholder="Search JannyAI characters…" autocomplete="off" data-search>
      <select class="dj-select" data-sort aria-label="Sort">
        ${SORTS.map((sort) => `<option value="${sort.value}">${sort.label}</option>`).join("")}
      </select>
      <label class="dj-toggle"><input type="checkbox" data-nsfw checked> NSFW</label>
      <button class="dj-button dj-import-button" type="button" data-import-file>Import PNG</button>
    </header>
    <div class="dj-tag-row" data-tags></div>
    <div class="dj-howto">Import: <b>Open</b> a card on JannyAI → <b>Download</b> → <b>Import PNG</b> here.</div>
    <div class="dj-status" data-status>Search JannyAI or pick a tag.</div>
    <div class="dj-grid" data-grid></div>
    <div class="dj-more-row">
      <button class="dj-button" type="button" data-more hidden>Load more</button>
    </div>
    <input type="file" accept="image/png,.png" hidden data-file>
  `;

  const searchInput = root.querySelector("[data-search]");
  const sortSelect = root.querySelector("[data-sort]");
  const nsfwInput = root.querySelector("[data-nsfw]");
  const tagRow = root.querySelector("[data-tags]");
  const status = root.querySelector("[data-status]");
  const grid = root.querySelector("[data-grid]");
  const moreButton = root.querySelector("[data-more]");
  const fileInput = root.querySelector("[data-file]");
  let searchTimer = 0;
  let pendingSearch = null;
  let pendingImport = null;

  function toast(tone, message, title = "JannyAI") {
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

  function renderTags() {
    tagRow.innerHTML = FILTER_TAGS.map((id) => {
      const active = state.tags.has(id);
      return `<button class="dj-tag${active ? " active" : ""}" type="button" data-tag="${id}" aria-pressed="${active}">${escapeHtml(TAG_MAP[id] || id)}</button>`;
    }).join("");
  }

  function render() {
    if (!state.hits.length) {
      grid.innerHTML = "";
      moreButton.hidden = true;
      if (!state.loading && !state.error) {
        setStatus(state.query ? "No characters match that search." : "Search JannyAI or pick a tag.");
      }
      return;
    }
    grid.innerHTML = state.hits
      .map((hit) => {
        const id = String(hit.id || "");
        const tags = (Array.isArray(hit.tagIds) ? hit.tagIds : [])
          .slice(0, 4)
          .map((tagId) => TAG_MAP[tagId])
          .filter(Boolean);
        const imported = Boolean(state.imported[id]);
        const description = stripHtml(hit.description || "").slice(0, 220);
        return `
          <article class="dj-card" data-id="${escapeHtml(id)}">
            <button class="dj-cover" type="button" data-detail="${escapeHtml(id)}" aria-label="Open details">
              <img src="${escapeHtml(IMAGE_BASE + String(hit.avatar || ""))}" alt="" loading="lazy">
            </button>
            <div class="dj-card-copy">
              <button class="dj-card-title" type="button" data-detail="${escapeHtml(id)}">${escapeHtml(hit.name || "Unnamed")}</button>
              <div class="dj-meta">${escapeHtml(formatDate(hit.createdAt))} · ${formatNumber(hit.totalToken)} tokens</div>
              <p class="dj-description">${escapeHtml(description || "No description.")}</p>
              <div class="dj-tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
              <div class="dj-card-actions">
                <button class="dj-button" type="button" data-open="${escapeHtml(id)}">Open</button>
                <button class="dj-button ${imported ? "secondary" : "primary"}" type="button" data-import="${escapeHtml(id)}" title="Download the card PNG on JannyAI, then choose it here">${imported ? "Imported" : "Import PNG"}</button>
              </div>
            </div>
          </article>`;
      })
      .join("");
    moreButton.hidden = state.hits.length >= state.total || state.total === 0;
    if (state.loading) setStatus("Loading…");
    else if (state.error) setStatus(state.error, true);
    else {
      setStatus(
        `${state.hits.length.toLocaleString()} of ${state.total.toLocaleString()} characters`,
      );
    }
  }

  function buildFilter() {
    const filters = ["isLowQuality = false"];
    if (!state.showNsfw) filters.push("isNsfw = false");
    if (state.tags.size) filters.push(`tagIds IN [${[...state.tags].join(", ")}]`);
    return filters.join(" AND ");
  }

  function buildSort() {
    if (state.sort === "newest") return ["createdAtStamp:desc"];
    if (state.sort === "tokens") return ["totalToken:desc"];
    return [];
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
      const response = await fetch(SEARCH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${searchToken()}`,
        },
        body: JSON.stringify({
          queries: [
            {
              indexUid: "janny-characters",
              q: state.query,
              filter: buildFilter(),
              sort: buildSort(),
              hitsPerPage: 24,
              page: state.page,
            },
          ],
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.results?.[0]?.error) {
        const message = String(payload?.message || payload?.results?.[0]?.error || "");
        if (/api key|authorization|invalid_api_key/i.test(message)) {
          throw new Error(
            "JannyAI's public search key has expired. Update the extension to the latest version.",
          );
        }
        throw new Error(message || `JannyAI search failed (${response.status}).`);
      }
      const result = payload.results[0];
      const hits = Array.isArray(result.hits) ? result.hits : [];
      state.hits = reset ? hits : [...state.hits, ...hits];
      state.total = Number(result.totalHits || 0);
      state.page += 1;
      state.error = "";
    } catch (error) {
      state.error = error?.message || "Could not search JannyAI.";
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
    return state.hits.find((hit) => String(hit.id) === String(id)) || null;
  }

  function openDetail(id) {
    const hit = findHit(id);
    if (!hit) return;
    const modal = ctx.ui.showModal({
      title: hit.name || "JannyAI character",
      width: 720,
      maxHeight: Math.max(420, window.innerHeight - 32),
    });
    const tags = (Array.isArray(hit.tagIds) ? hit.tagIds : [])
      .map((tagId) => TAG_MAP[tagId])
      .filter(Boolean);
    modal.root.innerHTML = `
      <div class="dj-detail">
        <img class="dj-detail-avatar" src="${escapeHtml(IMAGE_BASE + String(hit.avatar || ""))}" alt="">
        <div class="dj-detail-copy">
          <div class="dj-meta">${escapeHtml(formatDate(hit.createdAt))} · ${formatNumber(hit.totalToken)} tokens</div>
          <p>${escapeHtml(stripHtml(hit.description || "")) || "No description."}</p>
          <div class="dj-tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
          <div class="dj-card-actions">
            <button class="dj-button" type="button" data-modal-open="${escapeHtml(String(hit.id))}">Open on JannyAI</button>
            <button class="dj-button primary" type="button" data-modal-import="${escapeHtml(String(hit.id))}">Import downloaded PNG</button>
          </div>
          <p class="dj-hint">On JannyAI, tap Download, then return here and choose the PNG. Only the downloaded card PNG contains the character definition.</p>
        </div>
      </div>`;
    modal.root.querySelector("[data-modal-open]")?.addEventListener("click", () => {
      openExternal(pageUrl(hit));
    });
    modal.root.querySelector("[data-modal-import]")?.addEventListener("click", () => {
      modal.dismiss();
      chooseFile(hit);
    });
  }

  function chooseFile(hit = null) {
    pendingImport = hit;
    fileInput.dataset.hitId = String(hit?.id || "");
    fileInput.value = "";
    fileInput.click();
  }

  async function importFile(file) {
    if (!file) return;
    const hit =
      pendingImport || findHit(fileInput.dataset.hitId || "") || null;
    setStatus("Reading character card…");
    const card = await readCardFromPng(file);
    const id = String(hit?.id || "").trim();
    const name = String(card?.data?.name || card?.name || file.name.replace(/\.png$/i, ""));
    const extensions = {};
    if (id) {
      extensions.jannyai = {
        id,
        name,
        pageUrl: hit ? pageUrl(hit) : "",
        importedAt: new Date().toISOString(),
        source: "jannyai",
      };
    }
    const character = await ctx.characters.import({
      card,
      avatarFile: file,
      extensions,
    });
    if (id) {
      state.imported[id] = String(character?.name || name);
      saveImported(state.imported);
    }
    toast("success", `${character?.name || name} imported`, "JannyAI");
    setStatus(`Imported ${character?.name || name}.`);
    render();
  }

  root.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const tag = target.closest("[data-tag]");
    if (tag) {
      const id = Number(tag.getAttribute("data-tag"));
      if (state.tags.has(id)) state.tags.delete(id);
      else state.tags.add(id);
      renderTags();
      void search({ reset: true });
      return;
    }
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
      chooseFile(findHit(importButton.getAttribute("data-import")));
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
      toast("error", message, "JannyAI import failed");
      setStatus(message, true);
      render();
    });
  });

  renderTags();
  render();

  return {
    root,
    activate() {
      const known = ctx.characters.extensionIds?.("jannyai");
      if (known) {
        let changed = false;
        for (const id of known) {
          if (!state.imported[id]) {
            state.imported[id] = "Imported";
            changed = true;
          }
        }
        if (changed) saveImported(state.imported);
      }
      if (!state.hits.length && !state.loading) void search({ reset: true });
      else if (state.hits.length) render();
    },
    destroy() {
      window.clearTimeout(searchTimer);
      root.remove();
      removeStyle();
    },
  };
}
