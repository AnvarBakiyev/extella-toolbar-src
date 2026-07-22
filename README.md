# Extella Toolbar Suite

Monorepo for the **Extella Desktop toolbar** and the modules it embeds.

The toolbar (`toolbar.js`) is injected into the Extella Desktop (Electron)
renderer. It draws a top bar and opens each **module** — a self-contained,
single-file SPA — in a full-screen blob: iframe overlay. Modules develop
independently and are inlined into `toolbar.js` at build time.

```
extella-toolbar-suite/
├── toolbar/                 # HOST — builds the injectable toolbar.js
│   ├── build.js             #   inlines each module's dist/index.html + a credential shim
│   ├── src/core/            #   auth, api, tabs, theme, router, registry
│   ├── src/panels/          #   library.js, marketplace.js, … (one opener per embeddable)
│   └── public/              #   marketplace / plugin-chat templates
├── modules/
│   └── library/             # MODULE — admin-panel SPA (@extella/library)
│   # future: modules/video-studio/, modules/design/, …
└── package.json             # npm workspaces root
```

## Build

```sh
npm install                  # once, sets up workspaces

npm run build:library        # → modules/library/dist/index.html
npm run build:toolbar        # → toolbar/build/toolbar.js (inlines the library build)
npm run build                # both, in order
```

The toolbar build reads each module's `dist/index.html`, so **build the
module(s) before the toolbar**. `npm run build` does this in order.

## Package and deploy

Extella Desktop loads `toolbar.js` from its user-data directory and injects it
into the web view. Marketplace, plugin chat, and plugin forms are embedded in
that artifact at build time.

This repository deliberately does **not** provide a standalone installer.
`install.sh` is a fail-closed compatibility stub so old instructions cannot
silently deploy only part of the product. A release must be assembled and
installed by the signed, versioned Extella Client transaction, which installs
the toolbar, verified Catalog payload, Activity Center runtime, and account
state together and can roll the whole change back.

Supported release targets are exactly:

- macOS Intel (`x86_64`)
- macOS Apple Silicon (`arm64`)
- Windows 11 x64 (`x86_64`)

Linux and Windows on ARM are not release targets. A source checkout is a build
input and must not be copied into an end user's Extella data directory.

The release integrator must pin the toolbar commit, build it reproducibly, put
the generated artifact into the Extella Client bundle, and publish the client
archive only with its exact SHA-256 and byte size.

### Rebuild after editing sources

```sh
cd toolbar && node build.js          # toolbar only
# or from repo root:
npm run build                        # full suite
```

Run the repository checks and rebuild the signed Extella Client candidate. Do
not copy `toolbar.js` directly into a user profile.

### Verify

1. Extella shows a top bar with **Chat · Library · Plugins** tabs centered in the bar.
2. **Plugins** opens the marketplace; **Library** opens the embedded library SPA.
3. `toolbar.js` exists at the path above (`ls` Application Support / config dir).

### Troubleshooting

| Problem | Fix |
|---------|-----|
| Old toolbar after install | Run Extella Client doctor; do not overwrite one file manually |
| Library tab blank | Run `npm run build` from repo root (needs library dist) |
| Plugins tab blank | Rebuild and install a complete Extella Client candidate |
| Changes not picked up | Verify the installed client release revision and restart Extella |
| Token prompt never appears | Toolbar retries auth for 60 s, then shows a prompt automatically |
| Wrong account in Library after switch | Toolbar auto-refreshes token on account change; re-open Library if it was closed on logout |

---

## Multi-account switching

The toolbar binds each API token to a **userId** and refreshes it when the
signed-in account changes:

- On boot, logout (`/login` URL), `tokenUpdated`, or `extella-user-id`
  postMessage → `ETB.auth.refreshSession()` resolves the current user and
  fetches a matching token.
- **Library** remounts automatically when the token changes (fresh blob URL).
- **Plugin panels** receive an updated `etb_init` message with the new token.
- On logout the Library/Plugins overlays close so stale data is not shown.

---

## Auth, in one paragraph

Modules authenticate with the Main Backend via the `X-Auth-Token` header,
sourced from `window.__MB_TOKEN__`. The toolbar acquires the token from the
live Extella session (userId → `/api/token/list`; the userId comes from the DOM,
or falls back to `localStorage.dtd_last_user_id`) and hands it to each module
through the iframe URL hash, which a synchronous `<head>` shim lifts into
`window.__MB_TOKEN__` before the SPA boots.

## External GitHub and Hugging Face projects

The toolbar may inspect a pasted GitHub or Hugging Face link and show its public
metadata. An arbitrary external project is **unverified**: the supported client
does not generate or run an autonomous local installer for it, does not display
an installation success state, and does not create a localhost service.

To become installable, a project must first receive a declarative manifest,
explicit artifact ownership, bounded lifecycle actions, functional smoke tests,
and all applicable platform evidence in the Extella Client release gate. Once
verified, it is shipped as a pinned Catalog item through the same atomic client
transaction as the toolbar. This keeps “can inspect” separate from “supported
and installed”.

## Adding a module

1. Scaffold `modules/<name>/` as a single-file Vite SPA (`vite-plugin-singlefile`),
   reading credentials from `window.__MB_*` like `@extella/library`.
2. Add a panel opener in `toolbar/src/panels/<name>.js` (clone `library.js`).
3. Wire it into `toolbar/build.js` (inline its `dist/index.html` + shim) and a
   toolbar button.
4. `npm run build`.

## Activity Center

The modular build includes a bottom-right, human-readable feed of listener
activity. It also exposes recurring task management through
**Plugins → Расписания** and a **Регулярные задачи** shortcut on the marketplace
desktop. The device runtime is owned by the Extella Client package and sourced
from the canonical `extella-marketplace-pack/device/activity-center` tree. This
repository owns only the toolbar panel and its integration contract; see
[`device/activity-center`](device/activity-center/README.md).
