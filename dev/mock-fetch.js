// Fetch shim that emulates the SillyTavern server endpoints used by the
// Datacat extension. Loaded before the extension module.
(function () {
  const STORE_KEY = "mock-st-characters";
  const AVATAR_KEY = "mock-avatar-store";
  const MOCK_PNG_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  const originalFetch = window.fetch.bind(window);

  function readStore() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    } catch (_) {
      return [];
    }
  }

  function writeStore(rows) {
    localStorage.setItem(STORE_KEY, JSON.stringify(rows));
  }

  function readAvatars() {
    try {
      return JSON.parse(localStorage.getItem(AVATAR_KEY) || "{}");
    } catch (_) {
      return {};
    }
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  function dataUrlToBlob(dataUrl) {
    const [header, data] = String(dataUrl).split(",");
    const mime = /:(.*?);/.exec(header)?.[1] || "image/png";
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  function mockPng() {
    const binary = atob(MOCK_PNG_BASE64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: "image/png" });
  }

  window.fetch = async function (input, init = {}) {
    const url = typeof input === "string" ? input : input.url;
    const method = String(init.method || (typeof input !== "string" ? input.method : "GET") || "GET").toUpperCase();

    if (url.startsWith("/api/characters/all")) {
      return jsonResponse(readStore());
    }

    if (url.startsWith("/api/characters/get")) {
      const body = JSON.parse(String(init.body || "{}"));
      const row = readStore().find((entry) => entry.avatar === body.avatar_url);
      return row ? jsonResponse(row) : new Response("Not found", { status: 404 });
    }

    if (url.startsWith("/api/characters/import")) {
      const form = init.body;
      const file = form.get("avatar");
      const text = await readFileAsText(file);
      const card = JSON.parse(text);
      const data = card.data || card;
      let baseName = String(data.name || "character").replace(/[^\w\- ]+/g, "").trim() || "character";
      const rows = readStore();
      let fileName = baseName;
      let suffix = 1;
      while (rows.some((row) => row.avatar === `${fileName}.png`)) {
        fileName = `${baseName}_${suffix++}`;
      }
      const row = {
        avatar: `${fileName}.png`,
        name: data.name || baseName,
        date_added: Date.now(),
        create_date: new Date().toISOString(),
        data: {
          name: data.name || baseName,
          creator: data.creator || "",
          description: data.description || "",
          personality: data.personality || "",
          scenario: data.scenario || "",
          first_mes: data.first_mes || "",
          mes_example: data.mes_example || "",
          tags: data.tags || [],
          extensions: data.extensions || {},
        },
      };
      rows.push(row);
      writeStore(rows);
      return jsonResponse({ file_name: fileName });
    }

    if (url.startsWith("/api/characters/edit-avatar")) {
      const form = init.body;
      const file = form.get("avatar");
      const avatarName = form.get("avatar_url");
      const avatars = readAvatars();
      avatars[avatarName] = await readFileAsDataUrl(file);
      localStorage.setItem(AVATAR_KEY, JSON.stringify(avatars));
      return new Response("OK", { status: 200 });
    }

    if (url.startsWith("/characters/")) {
      const name = decodeURIComponent(url.slice("/characters/".length));
      const avatars = readAvatars();
      if (avatars[name]) {
        return new Response(dataUrlToBlob(avatars[name]), {
          status: 200,
          headers: { "Content-Type": "image/png" },
        });
      }
      return new Response(mockPng(), {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    }

    // Datacat protected transfers require a hosted verification in production.
    // The mock bypasses that step so the import pipeline can be exercised.
    const cardMatch = url.match(/^https:\/\/datacat\.run\/api\/client\/v1\/characters\/([0-9a-f-]{36})\/card/);
    if (cardMatch) {
      return jsonResponse({
        spec: "chara_card_v2",
        spec_version: "2.0",
        data: {
          name: "Mock Imported Character",
          description: "Imported through the Datacat mock harness.",
          personality: "Friendly and helpful.",
          scenario: "A test chat.",
          first_mes: "Hello from Datacat!",
          mes_example: "<START>",
          creator: "Mock Creator",
          tags: ["Fantasy", "Test"],
          alternate_greetings: ["A second greeting.", "A third greeting."],
          extensions: {},
        },
      });
    }
    const avatarMatch = url.match(/^https:\/\/datacat\.run\/api\/client\/v1\/characters\/([0-9a-f-]{36})\/avatar/);
    if (avatarMatch) {
      return new Response(mockPng(), {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    }

    return originalFetch(input, init);
  };
})();
