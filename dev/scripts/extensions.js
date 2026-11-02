import * as script from "../script.js";

const stored = script.loadSettings();
globalThis.__mockExtensionSettings = stored;

export const extension_settings = stored;

export function getContext() {
  return script.getContext();
}

export async function renderExtensionTemplateAsync() {
  return "";
}
