import { uuidv7 } from "./uuidv7.js";

/**
 * Datacat Client API access for SillyTavern.
 *
 * This is a direct, in-page port of the Lumiverse extension's backend bridge.
 * The Lumiverse version delegates every request to a host process so that
 * secrets never touch page code. SillyTavern has no equivalent enclave API, so
 * the same values (installation id, account token, verification lease) are
 * persisted into `extension_settings.datacat`, which SillyTavern stores
 * server-side in `settings.json` rather than in browser storage.
 *
 * Everything else is kept identical on purpose: the same path allowlist, the
 * same header set, the same token exchanges, and the same error surface. Only
 * `clientId`, `clientName` and `clientVersion` are configurable.
 */

const DEFAULT_ORIGIN = "https://datacat.run";
const API_PREFIX = "/api/client/v1";
const INSTALLATION_ID_PATTERN = /^[A-Za-z0-9._:-]{16,160}$/;
const PENDING_TTL_MS = 20 * 60_000;
const REQUEST_TIMEOUT_MS = 45_000;

const ALLOWED_GET = [
  /^\/capabilities$/,
  /^\/characters(?:\?.*)?$/,
  /^\/fresh(?:\?.*)?$/,
  /^\/tags(?:\?.*)?$/,
  /^\/creators\/[A-Za-z0-9:%_-]+\/(?:bootstrap|characters)(?:\?.*)?$/,
  /^\/characters\/[0-9a-f-]{36}(?:\?.*)?$/i,
  /^\/characters\/[0-9a-f-]{36}\/(?:card|avatar)(?:\?.*)?$/i,
  /^\/characters\/[0-9a-f-]{36}\/community(?:\?.*)?$/i,
  /^\/account(?:\/status)?$/,
  /^\/verifications\/[0-9a-f-]{36}$/i,
];

const ALLOWED_POST = [
  /^\/account-links$/,
  /^\/account-links\/[0-9a-f-]{36}\/token$/i,
  /^\/verifications$/,
  /^\/verifications\/[0-9a-f-]{36}\/token$/i,
  /^\/characters\/[0-9a-f-]{36}\/community\/(?:kudos|comments)$/i,
];

const PASSTHROUGH_ERROR_CODES = [
  "CLIENT_VERIFICATION_REQUIRED",
  "VERIFICATION_PENDING",
  "LINK_PENDING",
  "CLIENT_API_SCHEMA_REQUIRED",
  "CLIENT_API_CLIENT_NOT_APPROVED",
  "CLIENT_API_SCOPE_REQUIRED",
];

function isAllowedPath(path, method) {
  const safePath = String(path || "");
  const verb = String(method || "GET").toUpperCase();
  if (!safePath.startsWith("/") || safePath.includes("\\")) return false;
  if (verb === "GET") return ALLOWED_GET.some((pattern) => pattern.test(safePath));
  if (verb === "POST") return ALLOWED_POST.some((pattern) => pattern.test(safePath));
  return verb === "DELETE" && safePath === "/account";
}

function parseJson(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function headerRecord(headers) {
  const record = {};
  if (!headers) return record;
  for (const [key, value] of headers.entries()) {
    record[key] = value;
  }
  return record;
}

export function createDatacatClient({ getSettings, saveSettings, version }) {
  function settings() {
    return getSettings();
  }

  function pending() {
    const store = settings();
    if (!store.pending || typeof store.pending !== "object") store.pending = {};
    const now = Date.now();
    for (const [key, entry] of Object.entries(store.pending)) {
      const createdAt = Number(entry?.createdAt || 0);
      if (!createdAt || now - createdAt > PENDING_TTL_MS) delete store.pending[key];
    }
    return store.pending;
  }

  function rememberPending(kind, id, deviceCode) {
    const store = pending();
    store[`${kind}:${String(id).toLowerCase()}`] = {
      deviceCode: String(deviceCode),
      createdAt: Date.now(),
    };
    saveSettings();
  }

  function peekPending(kind, id) {
    const store = pending();
    const key = `${kind}:${String(id).toLowerCase()}`;
    return String(store[key]?.deviceCode || "");
  }

  function forgetPending(kind, id) {
    const store = pending();
    const key = `${kind}:${String(id).toLowerCase()}`;
    if (!store[key]) return;
    delete store[key];
    saveSettings();
  }

  function clientId() {
    const value = String(settings().clientId || "").trim();
    return value || "datacat_sillytavern";
  }

  function clientName() {
    return String(settings().clientName || "").trim() || "SillyTavern";
  }

  function installationId() {
    const store = settings();
    let value = String(store.installationId || "");
    if (!INSTALLATION_ID_PATTERN.test(value)) {
      value = `sillytavern-${uuidv7()}`;
      store.installationId = value;
      saveSettings();
    }
    return value;
  }

  function accessToken() {
    return String(settings().accessToken || "").trim();
  }

  function readLease() {
    const store = settings();
    const record = store.verificationLease || {};
    const token = String(record.token || "");
    const expiresAt = Date.parse(String(record.expiresAt || ""));
    if (
      !token.startsWith("dcv1v_") ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now() + 5000
    ) {
      if (store.verificationLease) {
        delete store.verificationLease;
        saveSettings();
      }
      return null;
    }
    return { token, expiresAt };
  }

  function storeLease(leaseToken, expiresAt) {
    const store = settings();
    store.verificationLease = {
      token: String(leaseToken),
      expiresAt: new Date(expiresAt).toISOString(),
    };
    saveSettings();
  }

  function clearVerification() {
    const store = settings();
    if (store.verificationLease) {
      delete store.verificationLease;
      saveSettings();
    }
  }

  function clearAccount() {
    const store = settings();
    delete store.accessToken;
    delete store.verificationLease;
    saveSettings();
  }

  async function runRequest(payload = {}) {
    const path = String(payload.path || "").trim();
    const method = String(payload.method || "GET").trim().toUpperCase();
    if (!isAllowedPath(path, method)) {
      throw new Error("This Datacat request is not available to the extension.");
    }

    const installId = installationId();
    const token = accessToken();
    const wantsBinary = payload.responseType === "arraybuffer";
    const headers = {
      Accept: wantsBinary
        ? "image/avif,image/webp,image/png,image/jpeg,image/gif"
        : "application/json",
      "X-Datacat-Client": `SillyTavern/${version}`,
      "X-Datacat-Client-Id": clientId(),
      "X-Datacat-Installation-Id": installId,
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    let body = parseJson(payload.body);

    const accountExchange = path.match(/^\/account-links\/([0-9a-f-]{36})\/token$/i);
    const verificationExchange = path.match(/^\/verifications\/([0-9a-f-]{36})\/token$/i);

    if (path === "/account-links" || path === "/verifications") {
      body = {
        ...body,
        installationId: installId,
        clientId: clientId(),
        clientName: clientName(),
        clientVersion: version,
      };
    }
    if (accountExchange) {
      const deviceCode = peekPending("link", accountExchange[1]);
      if (!deviceCode) throw new Error("The Datacat account-link request expired.");
      body = { ...body, deviceCode, installationId: installId, clientId: clientId() };
    }
    if (verificationExchange) {
      const deviceCode = peekPending("verification", verificationExchange[1]);
      if (!deviceCode) throw new Error("The Datacat security-check request expired.");
      body = { ...body, deviceCode, installationId: installId, clientId: clientId() };
    }
    if (method !== "GET" && method !== "DELETE") {
      headers["Content-Type"] = "application/json";
    }
    if (/^\/characters\/[0-9a-f-]{36}\/(?:card|avatar)(?:\?.*)?$/i.test(path)) {
      const lease = readLease();
      if (lease) headers["X-Datacat-Verification-Lease"] = lease.token;
    }

    const requestUrl = `${DEFAULT_ORIGIN}${API_PREFIX}${path}`;
    const requestInit = {
      method,
      headers,
      body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify(body),
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
    };

    // Mobile networks and cold Cloudflare edges occasionally drop the first
    // connection of a burst. A single retry for idempotent GETs keeps the
    // catalogue usable without hiding real failures.
    const response = await (async () => {
      const attempts = method === "GET" ? 2 : 1;
      let lastError = null;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
          return await fetch(requestUrl, { ...requestInit, signal: controller.signal });
        } catch (error) {
          lastError = error;
          if (attempt + 1 < attempts) {
            await new Promise((resolve) => setTimeout(resolve, 700));
          }
        } finally {
          clearTimeout(timer);
        }
      }
      if (lastError?.name === "AbortError") {
        throw new Error("Datacat did not answer in time. Please try again.");
      }
      throw new Error("Could not reach Datacat. Check the connection and try again.");
    })();

    const result = {
      status: response.status,
      statusText: response.statusText,
      headers: headerRecord(response.headers),
      body: "",
      encoding: null,
    };

    if (wantsBinary) {
      const buffer = new Uint8Array(await response.arrayBuffer());
      if (response.ok) {
        return { ...result, body: buffer };
      }
      // Protected transfers answer with JSON even for binary routes.
      const text = new TextDecoder().decode(buffer);
      return { ...result, body: text || "{}" };
    }

    const text = await response.text();
    const responseBody = parseJson(text);

    if (response.ok) {
      if (path === "/account-links" && responseBody.linkId && responseBody.deviceCode) {
        rememberPending("link", responseBody.linkId, responseBody.deviceCode);
        delete responseBody.deviceCode;
      }
      if (path === "/verifications" && responseBody.verificationId && responseBody.deviceCode) {
        rememberPending("verification", responseBody.verificationId, responseBody.deviceCode);
        delete responseBody.deviceCode;
      }
      if (accountExchange && responseBody.accessToken) {
        settings().accessToken = String(responseBody.accessToken);
        forgetPending("link", accountExchange[1]);
        delete responseBody.accessToken;
        responseBody.accessTokenSaved = true;
        clearVerification();
        saveSettings();
      }
      if (verificationExchange && responseBody.leaseToken && responseBody.expiresAt) {
        storeLease(responseBody.leaseToken, responseBody.expiresAt);
        forgetPending("verification", verificationExchange[1]);
        delete responseBody.leaseToken;
        responseBody.leaseAvailable = true;
      }
      if (method === "DELETE" && path === "/account") {
        clearAccount();
      }
      return { ...result, body: JSON.stringify(responseBody) };
    }

    if (response.status === 401 && token) {
      clearAccount();
    }

    const rawCode = String(responseBody?.error || "");
    const publicBody = {
      success: false,
      error: PASSTHROUGH_ERROR_CODES.includes(rawCode) ? rawCode : "DATACAT_REQUEST_FAILED",
      verificationRequired:
        responseBody?.verificationRequired === true ||
        responseBody?.securityCheckRequired === true,
      securityCheckRequired: responseBody?.securityCheckRequired === true,
    };
    return { ...result, body: JSON.stringify(publicBody) };
  }

  async function secureState() {
    const lease = readLease();
    return {
      hasAccessToken: Boolean(accessToken()),
      verificationExpiresAt: lease ? new Date(lease.expiresAt).toISOString() : null,
    };
  }

  return {
    clientId,
    clientName,
    installationId,
    runRequest,
    secureState,
    clearVerification,
    readLease,
  };
}
