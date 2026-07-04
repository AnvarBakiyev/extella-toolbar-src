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

## Deploy to Extella Desktop (local)

Extella Desktop loads `toolbar.js` from Application Support and injects it into
the web view on every page load. Marketplace, plugin chat, and plugin forms are
**embedded inside `toolbar.js`** at build time (blob iframes) — no separate
install path is required.

### Prerequisites

- **Node.js** v16+ (`node -v`)
- **Extella Desktop** installed
- Repo checked out on branch `main`

### One-command install (recommended)

From the repo root:

```sh
chmod +x install.sh   # once
./install.sh
```

The installer detects your OS, runs `npm run build` (library module + toolbar),
backs up the previous `toolbar.js`, copies artifacts to the correct paths, then
prompts for optional API keys.

**Restart Extella** after install.

### Install paths by OS

| OS | Deploy target |
|----|---------------|
| macOS | `~/Library/Application Support/extella-desktop/toolbar.js` |
| Linux | `~/.config/extella-desktop/toolbar.js` |

`toolbar/build/*.html` files are build artifacts for debugging only; the running
app does not read `~/.extella/plugins/` (legacy — removed by `./install.sh`).

### Manual install (macOS)

```sh
npm install           # once
npm run build         # library → modules/library/dist, then toolbar/build/

cp toolbar/build/toolbar.js \
   ~/Library/Application\ Support/extella-desktop/toolbar.js
```

Then `Cmd+Q` → reopen Extella Desktop.

### Manual install (Linux)

```sh
npm install
npm run build

mkdir -p ~/.config/extella-desktop
cp toolbar/build/toolbar.js ~/.config/extella-desktop/toolbar.js
```

Close and reopen Extella Desktop.

#### Linux: token authentication

On Linux, Electron requires **libsecret** to access session cookies used for
automatic token acquisition. Install it before running Extella:

```sh
# Debian / Ubuntu
sudo apt install libsecret-1-0

# Fedora / RHEL
sudo dnf install libsecret
```

If libsecret is unavailable or the session cookie is still inaccessible,
the toolbar will automatically show a **manual token prompt** after ~30 s.
Get your token at [api.extella.ai](https://api.extella.ai) → **Token → Generate**
and paste it into the prompt. The token is kept in memory for the session.

You can also launch Extella with `--password-store=basic` to bypass the keyring
entirely (disables cookie encryption; not recommended on shared machines).

### Rebuild after editing sources

```sh
cd toolbar && node build.js          # toolbar only
# or from repo root:
npm run build                        # full suite
```

Copy `toolbar.js` again (or re-run `./install.sh`).

### Verify

1. Extella shows a top bar with **Chat · Library · Plugins** tabs centered in the bar.
2. **Plugins** opens the marketplace; **Library** opens the embedded library SPA.
3. `toolbar.js` exists at the path above (`ls` Application Support / config dir).

### Troubleshooting

| Problem | Fix |
|---------|-----|
| Old toolbar after install | Quit Extella fully and reopen |
| Library tab blank | Run `npm run build` from repo root (needs library dist) |
| Plugins tab blank | Re-copy `toolbar.js` and restart Extella (UI is embedded in toolbar.js) |
| Changes not picked up | Re-copy `toolbar.js` and restart Extella |
| Authorization failed (Linux) | Install `libsecret-1-0` or launch Extella with `--password-store=basic` |
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

## GitHub plugins — agent-driven install

Adding a plugin from **Plugins → Add GitHub repo** no longer runs a hardcoded
decision tree in the toolbar. Instead the toolbar hands the repository to an
**autonomous Extella agent** that does the whole installation end to end on the
user's own device, and reports back through a local file registry.

### Principle

1. **One standard prompt.** The toolbar fetches a light repo digest (tree +
   README) and builds a single instruction prompt
   ([`toolbar/src/core/install-prompt.js`](toolbar/src/core/install-prompt.js)).
   It contains only **deterministic identifiers** both sides must agree on —
   `plugin_id`, install dir, HTTP `port`, `start_expert` name, pid file, and the
   `registry_file` path — plus the rules, ordered steps, and a CSPL guide.
2. **No device id baked in.** `device_id = my` is passed as the literal word
   **`my`**: the agent resolves the *current user's own* device automatically.
   Nothing user-specific is hardcoded into the prompt. (The agent authenticates
   with its own Extella credentials via request headers — no token in the prompt.)
3. **Three categories, agent picks one.**
   - **repo_ui** — repo already has a web UI → reuse it (download static/dist, or
     clone + install toolchain + build, or embed a published component via UMD).
   - **generated_ui** — repo is functional only (library/SDK) → generate one
     self-contained `index.html` that drives the real capabilities, backed by
     Extella experts where server-side code is needed.
   - **generated_ui (functions)** — small repo / a few functions → wrap each as an
     expert and generate a UI on top.
4. **Serve + validate.** The agent puts the entry at
   `~/extella-plugins/<id>/index.html`, starts a detached `python3 -m http.server`
   via the `start_expert` (so the toolbar can restart it later), then **validates
   the live render** at `http://localhost:<port>/` and fixes it until it actually
   loads — HTTP 200 alone is not treated as success.
5. **Manifest as source of truth.** The agent writes a manifest JSON to
   `~/extella-plugins/_registry/<id>.json` describing the plugin, its `ui`
   (`local_server` + port + start expert), `conceptTexts`, and an `artifacts`
   block listing **every** expert, file, pid file, and KV key it created.
6. **Toolbar reads it back.** `ETB.registry.syncFromDevice()`
   ([`toolbar/src/core/registry.js`](toolbar/src/core/registry.js)) runs a small
   `fython` expert on the local device (device id resolved automatically via the
   desktop bridge — never prompted) to read the registry files and surface the new
   plugin under **Plugins**. This sync is gated on a valid session token so it
   never triggers a token prompt at boot.

### Removal cleans up everything

Removing an agent-installed plugin uses the manifest's `artifacts` to fully tear
down what the agent created
([`toolbar/src/panels/marketplace.js`](toolbar/src/panels/marketplace.js)):
deletes the saved experts (`ETB.api.deleteExpert`), clears KV keys, runs an
on-device cleanup expert that stops the server and `rmtree`s the install dir +
pid file + registry entry, then drops the local registry record and evicts the
cached panel.

## Adding a module

1. Scaffold `modules/<name>/` as a single-file Vite SPA (`vite-plugin-singlefile`),
   reading credentials from `window.__MB_*` like `@extella/library`.
2. Add a panel opener in `toolbar/src/panels/<name>.js` (clone `library.js`).
3. Wire it into `toolbar/build.js` (inline its `dist/index.html` + shim) and a
   toolbar button.
4. `npm run build`.
