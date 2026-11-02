# Datacat Browser for SillyTavern

Bring the [Datacat](https://datacat.run) character catalogue into SillyTavern.
Browse Fresh, search the full catalogue, explore tags and creators, import a
character in one click, and open a chat without leaving the app.

This is a port of the
[Datacat Browser for Lumiverse](https://github.com/datacat-run/datacat-lumiverse)
to SillyTavern's third-party extension API.

## Features

- Fresh feed, full catalogue search, sorting and pagination.
- Tag browser with list/cloud modes and multi-tag filtering.
- Character profiles and creator pages.
- One-click import into SillyTavern (character card + Datacat image).
- "Added" state across the library, and an Imports tab with recent imports.
- Datacat account linking (anonymous or logged-in) and community actions
  (kudos, comments) from the wand menu while chatting.
- Hosted Datacat security check for protected card and image transfers.

## Requirements

- SillyTavern 1.13.x or newer.
- An approved **Datacat Client ID** with catalogue scopes.
- A browser with `createImageBitmap` or standard canvas image decoding
  (current Chrome, Firefox, Safari and Edge all work).

## Install

### From a Git repository

1. Open SillyTavern → **Extensions** → **Install extension**.
2. Paste the repository URL of this project.
3. Enable **Datacat Browser** if it is not enabled automatically.
4. Open **Extensions settings** and set your Datacat Client ID (see below).
5. Click **Open Datacat**, or use **Datacat** in the wand menu.

### Manually

```bash
cd SillyTavern/public/scripts/extensions/third-party
git clone <this-repository> datacat-sillytavern
```

The folder must contain `manifest.json`, `index.js` and `style.css` at its root.

## Datacat Client ID

Datacat requires each integration to register a Client ID. The extension ships
with the placeholder `datacat_sillytavern`, which will not work until it has
been approved for the right scopes.

1. Open [Datacat → Creator Management → API Access](https://datacat.run/creatortools/api-access).
2. Create a client for SillyTavern and request the catalogue and import scopes
   (at minimum `characters:read` and `characters:import`; add the community and
   account scopes if you want kudos, comments and account linking).
3. Copy the approved Client ID.
4. Paste it into **SillyTavern → Extensions → Datacat → Datacat Client ID**.

The value is stored in `extension_settings.datacat` and sent as
`X-Datacat-Client-Id` on every request. It is not a secret; never put a
Datacat account token or password in this field.

If Datacat answers `CLIENT_API_CLIENT_NOT_APPROVED` or
`CLIENT_API_SCOPE_REQUIRED`, the client exists but is not approved for the
requested route — check the API Access page for the pending scope approval.

## Usage

- **Wand menu → Datacat** opens the full-screen browser.
- **Extensions settings → Open Datacat** does the same.
- **Fresh** shows the latest catalogue additions in 24-hour and weekly windows.
- **Catalog** supports text search, sorting, infinite scroll and tag filters.
- **Character card → Import** downloads the card and Datacat-mirrored image,
  then creates a normal SillyTavern character with Datacat metadata attached.
- **Imports** lists characters already linked to Datacat and can reopen their
  chat in SillyTavern.
- **Wand menu → Kudos / Comment** works while a Datacat-linked character is
  selected; it opens the Datacat account flow if needed.

Imported characters carry this metadata inside the card:

```json
{
  "data": {
    "extensions": {
      "datacat": {
        "datacatCharacterId": "…",
        "importedAt": "…",
        "source": "datacat"
      }
    }
  }
}
```

The "Added" badges and the Imports tab are built by scanning your SillyTavern
character library for that metadata; nothing is written to Datacat when you
scan.

## Privacy and storage

- Discovery requests are anonymous unless you link a Datacat account.
- Account tokens and the short-lived verification lease are stored in
  SillyTavern's `extension_settings` (server-side `settings.json`), never in
  `localStorage` or page cookies.
- No Datacat credentials are bundled with the extension.
- Images are loaded from Datacat's media host; character cards and avatars are
  fetched through the Datacat Client API.

## How it works

The Lumiverse extension talks to a small host process that holds secrets and
performs allowlisted requests. SillyTavern has no equivalent enclave, so this
port replaces that host with two browser modules:

| Module        | Responsibility                                                              |
| ------------- | --------------------------------------------------------------------------- |
| `src/api.js`  | Allowlisted Datacat Client API calls, client headers, token/lease exchanges |
| `src/host.js` | SillyTavern adapter: full-screen drawer, modals, toasts, character reads     |
| `src/ui.js`   | The catalogue UI, ported from the Lumiverse extension with minimal changes   |

Only these call sites differ from the original:

- the import step, which posts a V2 card to `/api/characters/import` and then
  uploads a PNG avatar to `/api/characters/edit-avatar`;
- the "Chat" action, which selects the matching SillyTavern character instead
  of creating a Lumiverse chat;
- local avatar URLs, which point at SillyTavern's `/characters/<file>` route;
- host chrome (drawer, modal, wand menu).
- All other UI code (discovery, tags, creators, verification, account, kudos,
  comments) is shared with the Lumiverse version.

## Development

The `dev/` folder is a mock SillyTavern used to exercise the extension without
a full SillyTavern install. It emulates the character endpoints, the import
flow and authenticated image uploads, and proxies Datacat discovery to the real
API.

```bash
node dev/server.mjs
# open http://localhost:8099
```

Add `?client=datacat_lumiverse` to test against the approved Lumiverse client
while developing the UI; keep the default `datacat_sillytavern` for realistic
error handling.

There is no build step: SillyTavern loads `index.js` as an ES module and the
`sources` are plain JavaScript.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| "This Client ID is missing Datacat scopes" | Client ID not approved for `characters:read` / `characters:import` |
| "This Client ID is not approved by Datacat" | Client ID is wrong, revoked or not registered |
| Import succeeds but the image is missing | Datacat image transfer failed; the character card is still imported |
| "Allow pop-ups for SillyTavern" | The browser blocked the Datacat verification or account popup |
| "Datacat is busy" | Rate limit (429). Wait for the `Retry-After` window |
| No characters in "Imports" | Characters were imported by another tool and lack `extensions.datacat` metadata |

## Credits

The UI, API integration and import flow are based on
[datacat-lumiverse](https://github.com/datacat-run/datacat-lumiverse) by
Datacat. This port keeps the same behaviour and API surface for SillyTavern.
