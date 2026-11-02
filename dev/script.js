// Minimal SillyTavern API mock for local UI testing.
// This file is NOT part of the extension.

const STORAGE_KEY = "mock-st-characters";
const SETTINGS_KEY = "mock-st-extension-settings";

const seed = [
  {
    avatar: "Aria.png",
    name: "Aria",
    date_added: Date.now() - 86400000,
    create_date: new Date(Date.now() - 86400000).toISOString(),
    data: {
      name: "Aria",
      creator: "Mock Creator",
      description: "A test character already linked to Datacat.",
      tags: ["Fantasy", "OC"],
      extensions: {
        datacat: {
          datacatCharacterId: "11111111-1111-4111-8111-111111111111",
          importedAt: new Date(Date.now() - 86400000).toISOString(),
        },
      },
    },
  },
  {
    avatar: "Borin.png",
    name: "Borin",
    date_added: Date.now() - 172800000,
    create_date: new Date(Date.now() - 172800000).toISOString(),
    data: {
      name: "Borin",
      creator: "Someone",
      description: "A plain SillyTavern character with no Datacat link.",
      tags: ["Adventure"],
    },
  },
];

function loadCharacters() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
  return structuredClone(seed);
}

function saveCharacters(rows) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
}

export const characters = loadCharacters();
export let currentCharacterId = undefined;

export function setCurrentCharacterId(value) {
  currentCharacterId = value;
}

export function getContext() {
  return {
    characters,
    characterId: currentCharacterId,
    name1: "User",
    groups: [],
    chat: [],
    chatId: "mock-chat",
  };
}

export function getRequestHeaders() {
  return {
    "Content-Type": "application/json",
    "X-CSRF-Token": "mock-csrf",
  };
}

export function saveSettingsDebounced() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(globalThis.__mockExtensionSettings || {}));
}

export async function getCharacters() {
  const rows = loadCharacters();
  characters.splice(0, characters.length, ...rows);
  return characters;
}

export async function selectCharacterById(id) {
  currentCharacterId = id;
  const row = characters[id];
  if (row) {
    globalThis.toastr?.success?.(`Opened chat with ${row.name}`, "SillyTavern");
    document.getElementById("mock-current-character").textContent = row.name;
  }
}

export function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch (_) {
    return {};
  }
}

export function persistCharacters() {
  saveCharacters(characters);
}
