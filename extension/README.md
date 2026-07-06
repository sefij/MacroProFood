# MacPro MyFitnessPal Companion (browser extension)

A tiny Manifest V3 extension that lets the MacroPro web app read your **remaining
macros** and fill a **Quick Add** meal using your *existing* MyFitnessPal login —
no password is ever entered or stored, and nothing is sent to any server.

## Why an extension (vs. the bookmarklets)

A page served from `*.pages.dev` can't touch `myfitnesspal.com`'s cookies — the
browser's Same-Origin Policy forbids it. This extension is granted
`host_permissions` for `myfitnesspal.com`, so it can act with your logged-in
session on your behalf. It's the only way to get a true one-click experience
without storing a credential.

The web app's bookmarklet flow still works as a zero-install fallback when the
extension isn't present.

## How it works

```
web app  ──postMessage──►  bridge.js (content script on the app's pages)
                               │ chrome.runtime
                               ▼
                         background.js (service worker)
                               │ chrome.scripting.executeScript
                               ▼
                       your MyFitnessPal tab (live session)
```

- **bridge.js** runs only on the MacroPro app origins (see `manifest.json`) and
  relays messages; the app never needs the extension's ID.
- **background.js** finds/opens your MFP diary tab and injects a self-contained
  function to read the *Remaining* row (`pull`) or fill Quick Add (`track`). The
  injected DOM logic mirrors the Playwright client in
  [`../src/mfp/client.ts`](../src/mfp/client.ts).
- It **never auto-submits** a meal — it fills the fields and brings the tab
  forward so you review and click *Add to Diary*.

## Install (developer / unpacked)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this `extension/` folder.
4. Make sure you're logged in to MyFitnessPal in the same browser.
5. Open the MacroPro app — the "From MyFitnessPal" panel should show
   **✓ extension connected**.

## Configure for your deployment

`manifest.json` lists the origins the bridge is allowed to run on:

```json
"matches": [
  "http://localhost:5173/*",
  "http://127.0.0.1:5173/*",
  "https://*.pages.dev/*"
]
```

Replace/extend with your real domain (e.g. `https://macropro.app/*`) before
publishing, and narrow the `*.pages.dev` wildcard to your project's subdomain.

## Permissions, explained

| Permission | Why |
| --- | --- |
| `host_permissions: myfitnesspal.com` | Read the diary and fill Quick Add using your session |
| `scripting` | Inject the read/fill functions into your MFP tab on demand |
| `tabs` | Find or open your MFP diary tab |
| content script on the app origin | Bridge messages between the app and the extension |

No analytics, no remote code, no storage of credentials or session tokens.

## Limitations

- The **track/fill** flow automates MyFitnessPal's own UI, which can change; if a
  field isn't found it reports an error and you can fall back to the bookmarklet
  or manual entry. **Pull remaining** is a simple read and is robust.
- Not yet published to the web stores — load it unpacked for now.
