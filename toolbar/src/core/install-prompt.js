// ── INSTALL PROMPT BUILDER ──────────────────────────────────────────────────
// Builds the single standard prompt that turns the agent into an autonomous
// plugin installer. The toolbar only feeds a GitHub URL + light digest; the
// agent decides the category, obtains/builds/generates the UI, installs it on
// the device (CSPL + experts + local http.server), validates the render, and
// writes a manifest JSON to a local registry file the toolbar then reads.
//
// Exposes: ETB.installPrompt.context(rd, digest) -> ctx
//          ETB.installPrompt.build(ctx) -> string

ETB.installPrompt = (function () {

  // Deterministic 32-bit hash → stable per-plugin port (mirrors repo-analyzer).
  function _hashCode(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) {
      h = ((h << 5) - h) + str.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h);
  }

  function _slug(s) {
    return String(s).toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/__+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 30);
  }

  // Assemble all deterministic identifiers/paths so the agent and the toolbar
  // agree on names (start expert, pid file, registry path, port). Everything
  // the agent must reuse verbatim is computed here, not invented by the model.
  function context(rd, digest, opts) {
    opts = opts || {};
    var runMode = opts.runMode === 'remote' ? 'remote' : 'local';
    var fullName = rd.full_name || ((rd.owner && rd.owner.login ? rd.owner.login : 'owner') + '/' + (rd.name || 'repo'));
    var owner = fullName.split('/')[0];
    var repo = (fullName.split('/')[1] || rd.name || 'repo');
    // Hosted and local installs of the same repo get distinct ids so their
    // manifests don't collide.
    var pluginId = 'gh_' + _slug(fullName.replace('/', '_')) + (runMode === 'remote' ? '_hf' : '');
    var safeId = pluginId.replace(/[^a-z0-9]/gi, '_');
    var port = 34000 + (_hashCode(pluginId) % 1000);
    return {
      url: 'https://github.com/' + owner + '/' + repo,
      owner: owner,
      repo: repo,
      fullName: fullName,
      branch: rd.default_branch || 'main',
      displayName: rd.name || repo,
      description: rd.description || '',
      pluginId: pluginId,
      safeId: safeId,
      port: port,
      rootPath: '~/extella-plugins/' + safeId,
      registryDir: '~/extella-plugins/_registry',
      registryPath: '~/extella-plugins/_registry/' + safeId + '.json',
      startExpert: '_etb_srv_' + safeId,
      pidFile: '/tmp/etb_srv_' + safeId + '.pid',
      digest: digest || null,
      runMode: runMode,
      // Приватный репозиторий: обычный git clone по URL у агента упадёт «not found»
      // (GitHub на приватный отвечает так же, как на несуществующий). Флаг включает
      // отдельную инструкцию скачивания по ключу — см. блок SPEED.
      isPrivate: !!(rd && rd.private),
      hf: opts.hf || null   // { kind:'space'|'model', id:'owner/name' } when known
    };
  }

  function _digestBlock(ctx) {
    var d = ctx.digest || {};
    var parts = [];
    if (d.text) {
      parts.push(d.text);
    } else {
      parts.push('Repo: ' + ctx.fullName);
      if (ctx.description) parts.push('Description: ' + ctx.description);
    }
    return parts.join('\n');
  }

  // Light Extella palette + theme rules for every agent-generated index.html.
  function _visualStyleBlock() {
    return [
      '=== VISUAL STYLE (match Extella Library — LIGHT, not dark) ===',
      'Every index.html YOU write (control panels, generated UIs, static wrappers) MUST use the',
      'LIGHT Extella palette so it matches the main app and Library. Do NOT use dark themes',
      '(#0a0a0a, #0d1117, #111, #161b22, neon-on-black, terminal/hacker aesthetics, dark GitHub',
      'Markdown landing pages). Users expect a clean light interface.',
      '',
      'Put this in <head>: <meta name="color-scheme" content="light">',
      'Start <html> with data-lm="1" (light mode). Use these CSS variables in :root:',
      '  --bg:#f2f2f7; --s1:#fff; --s2:#fff; --s3:#f7f7f9;',
      '  --bd:rgba(0,0,0,.07); --bd2:rgba(0,0,0,.14);',
      '  --tx:#111; --tx2:#6b6b6b; --a:#C67E34; --ar:198,126,52;',
      '  body{background:var(--bg);color:var(--tx);',
      '    font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;}',
      '  Cards/panels: background var(--s1), border 1px solid var(--bd), border-radius 12px.',
      '  Primary buttons: background #C67E34, color #000, font-weight 600, border-radius 9px.',
      '  Secondary buttons: background var(--s3), color var(--tx), border 1px solid var(--bd2).',
      '  Inputs: background #fff, border 1px solid var(--bd2), color var(--tx), border-radius 9px.',
      '',
      'Listen for live theme from the toolbar (optional sync with host app):',
      '  window.addEventListener("message", function(e){',
      '    if (!e.data) return;',
      '    if (e.data.type==="etb_init"){',
      '      if(e.data.token) window.__tok=e.data.token;',
      '      if(e.data.apiBase) window.__api=e.data.apiBase;',
      '      if(e.data.theme==="dark") document.documentElement.removeAttribute("data-lm");',
      '      else document.documentElement.setAttribute("data-lm","1");',
      '    }',
      '    if (e.data.type==="etb_theme"){',
      '      if(e.data.theme==="light") document.documentElement.setAttribute("data-lm","1");',
      '      else document.documentElement.removeAttribute("data-lm");',
      '    }',
      '  });',
      'Default remains LIGHT (data-lm="1") even before etb_init arrives.',
      ''
    ].join('\n');
  }

  // The standard prompt. `ctx` comes from context() above.
  // Hosted (HuggingFace) install of a heavy model — no local GPU/weights.
  // The plugin's UI calls a device expert that proxies to the model's HF Space
  // via gradio_client, using the user's HF token (from KV). Proven pattern.
  function buildHostedModel(ctx) {
    var hf = ctx.hf || {};
    var proxyExpert = ctx.safeId + '_run';
    return [
      'You are the Extella Plugin Installer agent, running ON THE USER\'S DEVICE with the',
      'Extella CSPL/expert toolset. Install this GitHub repo as a HOSTED plugin: the heavy',
      'model runs on its HuggingFace Space (no local GPU, no weights download). Do it end to',
      'end, autonomously. Respond ONLY with the final JSON object described at the bottom.',
      '',
      '=== TARGET ===',
      'GitHub repo: ' + ctx.url,
      'Plugin name: ' + ctx.displayName,
      'HuggingFace ' + (hf.kind || 'space') + ': ' + (hf.id || '(FIND IT: read the repo README for a huggingface.co/spaces/<owner>/<name> or huggingface.co/<owner>/<model> link; if none, pick the official Space for this model)'),
      '',
      '=== FIXED IDENTIFIERS (use verbatim) ===',
      'plugin_id     = ' + ctx.pluginId,
      'install_dir   = ' + ctx.rootPath + '   (create it; put index.html here)',
      'http_port     = ' + ctx.port + '       (serve index.html on this port via python3 -m http.server)',
      'start_expert  = ' + ctx.startExpert,
      'proxy_expert  = ' + proxyExpert + '    (the device expert that calls the HF Space)',
      'registry_file = ' + ctx.registryPath,
      '',
      '=== STEP 1: create the proxy expert (fython, global) ===',
      'First introspect the Space API on the device: GET https://<owner>-<name>.hf.space/gradio_api/info',
      '(owner/name from the Space id, lowercased, "/"→"-"). Find the primary endpoint (api_name, e.g.',
      '"/run_ocr" or "/predict") and its inputs. Then save an expert named ' + proxyExpert + ' whose kwargs',
      'match those inputs, PLUS an optional image_b64 for any file/image input. The expert MUST:',
      '  - read the HF token from Extella KV key "huggingface_token" (POST https://api.extella.ai/api/kv/get',
      '    with the device api token from ~/.extella/api_token.txt; header X-Auth-Token); set os.environ["HF_TOKEN"].',
      '  - if image_b64 is given: base64-decode to a tempfile and pass it via gradio_client handle_file(path).',
      '  - use gradio_client: try Client("<owner>/<name>", hf_token=tok) except TypeError: Client("<owner>/<name>");',
      '    call client.predict(..., api_name="<the endpoint>"); return json.dumps({status:"success", <result fields>}).',
      '  - ensure gradio_client is installed (subprocess pip install if ImportError). NO include(...) — plain imports.',
      'Verify by running ' + proxyExpert + ' once on a small sample and confirming it returns text/result.',
      '',
      '=== STEP 2: create index.html in install_dir ===',
      'A clean control panel (LIGHT style, gold #C67E34 accent) with inputs matching the model, a file drop',
      'zone that reads the file as base64 (FileReader.readAsDataURL) — NOT File.path (hidden in Electron) —',
      'and a Run button. Call the proxy via the toolbar bridge (postMessage {type:"etb_run_expert", reqId,',
      'name:"' + proxyExpert + '", params}); await {type:"etb_expert_result"}. The UI makes NO direct API calls.',
      '',
      '=== STEP 3: serve + manifest ===',
      'Start python3 -m http.server ' + ctx.port + ' in install_dir (detached; write pid; save start_expert ' + ctx.startExpert + ').',
      'Write ' + ctx.registryPath + ' with: {id:"' + ctx.pluginId + '", name:"' + ctx.displayName + '", type:"github", mode:"generated_ui",',
      'hf:{id:"' + (hf.id || '') + '", kind:"' + (hf.kind || 'space') + '", hosted:true}, ui:{type:"local_server", port:' + ctx.port + ', rootPath:"' + ctx.rootPath + '",',
      'startExpert:"' + ctx.startExpert + '", mainFile:"index.html", openInBrowser:false, expectsHealth:false}, service:{isApp:false, port:' + ctx.port + ', startExpert:"' + ctx.startExpert + '", ready:true},',
      'experts:["' + proxyExpert + '"], installed:true}.',
      '',
      '=== FINAL OUTPUT (only this) ===',
      'Return: {"ok":true, "plugin_id":"' + ctx.pluginId + '", "mode":"hosted", "hf":"' + (hf.id || '') + '", "notes":"..."}',
      'If you cannot find a HuggingFace Space for this model, return {"ok":false, "error":"no hosted Space found"}.'
    ].join('\n');
  }

  // Optional `analysis` from the pre-analysis SubAgent (see buildAnalysis).
  function build(ctx, analysis) {
    if (ctx && ctx.runMode === 'remote') return buildHostedModel(ctx);
    var lines = [
      'You are the Extella Plugin Installer agent. You run ON THE USER\'S DEVICE and',
      'have full local filesystem access plus the Extella CSPL/expert toolset. Your job',
      'is to take ONE GitHub repository and install it as a working Extella plugin with',
      'a real, interactive UI, fully autonomously. Do everything end to end; do not ask',
      'the user questions.',
      '',
      'CRITICAL — ACT IMMEDIATELY: Submit your FIRST CSPL expert task in this very first',
      'message. Do NOT write prose analysis or plan all steps before acting. Your first',
      'action must be a CSPL task (clone the repo, or read README if already cloned).',
      'Think and plan IN PARALLEL with execution — start executing NOW.',
      '',
      '=== SPEED (do not skip) ===',
      (ctx.isPrivate
        ? 'PRIVATE REPOSITORY — a plain `git clone` fails here with "not found" (GitHub answers\n' +
          'the same for private and non-existent). Fetch it with the stored key instead:\n' +
          '  1. read the Extella account token from ~/.extella/api_token.txt (fall back to\n' +
          '     ~/extella_wizard/app/config.json -> auth_token);\n' +
          '  2. POST https://api.extella.ai/api/kv/get with headers X-Auth-Token: <that token>,\n' +
          '     X-Profile-Id: default, X-Agent-Id: agent_extella_default and body\n' +
          '     {"key": "github_token", "global": true} — the answer field `value` is the key;\n' +
          '  3. download the tarball, passing the key in a HEADER, never in the URL (a token\n' +
          '     inside a URL leaks into shell history, process lists and server logs):\n' +
          '     curl -sL -H "Authorization: token <key>" \\\n' +
          '       https://api.github.com/repos/' + ctx.fullName + '/tarball/' + ctx.branch + ' \\\n' +
          '       | tar xz --strip-components=1 -C ' + ctx.rootPath + '\n' +
          '     (create ' + ctx.rootPath + ' first).\n' +
          'If the key is missing or GitHub answers 401/404, STOP and report honestly that the\n' +
          'repository is private and the GitHub key is missing or has no access to it. Do NOT\n' +
          'build a plugin around an empty directory — an empty card is worse than an error.'
        : 'ALWAYS clone shallow: git clone --depth 1 --single-branch ' + ctx.url + ' ' + ctx.rootPath),
      '(you never need git history — a full clone of a big repo wastes minutes).',
      'Be decisive, not exploratory. For a static / docs / content repo this is a',
      'handful of steps — clone, confirm the entry file, serve it, write the manifest —',
      'NOT a dozen. Do not re-read files you already have or re-run steps that passed.',
      '',
      '=== TARGET REPOSITORY ===',
      'URL: ' + ctx.url,
      'Repo: ' + ctx.fullName + ' (branch: ' + ctx.branch + ')',
      'Plugin name: ' + ctx.displayName,
      ctx.description ? 'Description: ' + ctx.description : '',
      '',
      '=== FIXED IDENTIFIERS (use these EXACT values, do not invent your own) ===',
      'device_id     = my   (resolve the CURRENT USER\'S OWN device automatically — do NOT expect a literal id here. Run ALL experts/commands targeting your own device so files land locally)',
      'plugin_id     = ' + ctx.pluginId,
      'install_dir   = ' + ctx.rootPath + '        (create it; put the UI entry at index.html here)',
      'http_port     = ' + ctx.port + '            (serve the UI on this port)',
      'start_expert  = ' + ctx.startExpert + '     (name of the expert that starts the server)',
      'pid_file      = ' + ctx.pidFile,
      'registry_file = ' + ctx.registryPath + '    (write the final manifest JSON here)',
      '',
      '=== PLUGIN CATEGORIES (pick exactly one) ===',
      '1a. REPO HAS A STATIC/BUILDABLE WEB UI (no own backend runtime) → reuse it.',
      '   - Static site / prebuilt dist / plain HTML+JS: download those files into install_dir.',
      '   - Needs a build (package.json + bundler like vite/webpack/cra/kkt/rsbuild): clone,',
      '     install toolchain + deps, run the build, copy the produced dist into install_dir.',
      '   - A published npm React component with no runnable site: build a small index.html that',
      '     embeds it (see UMD RECIPE below). Serve install_dir statically on http_port.',
      '   - mode = "repo_ui".',
      '1b. REPO IS A RUNNABLE APP/SERVICE/CLI TOOL (you install and run it). Signals: a documented',
      '    install + run sequence (npx <tool> onboard, npm install && npm start, pip install then a',
      '    run command, a setup/onboarding script, docker compose), a "start"/"dev" server script, a',
      '    documented port (5678/3000/8080/...), a daemon/gateway. DO NOT build a control panel that',
      '    merely pokes at it, and DO NOT hand-write a page describing it: you MUST make the REAL tool run.',
      '   Sub-classify BEFORE installing:',
      '   1b-simple: README shows a single install command + a single start command (e.g. "npm install",',
      '     then "npm start"). No interactive wizard, no onboarding step, no config that must be obtained',
      '     before start. Proceed with a single install + start expert.',
      '   1b-multi: README documents TWO OR MORE ORDERED STEPS that depend on each other before the',
      '     service is usable. Signals: a dedicated "onboard"/"setup"/"configure" command that must run',
      '     BEFORE start; a wizard that outputs a token/key needed for the next step; a "step 1 / step 2"',
      '     sequence in the docs; multiple commands where the second uses output from the first (e.g.',
      '     "openclaw onboard" → writes config, then "openclaw gateway --port X"). USE THE PHASED SETUP',
      '     RECIPE below for all 1b-multi tools.',
      '   - Follow the repo README EXACTLY: install the full toolchain + ALL dependencies',
      '     (node/python/docker, npm/pip install), then run any onboarding/setup step it documents.',
      '   - START the real long-running service via the start expert (npx/npm start/python/docker/the',
      '     tool\'s own CLI).',
      '   - IF it exposes a web UI: the toolbar shows it in an IFRAME, so the app MUST allow embedding.',
      '     Check X-Frame-Options and Content-Security-Policy frame-ancestors on MULTIPLE routes:',
      '       HEAD http://localhost:<port>/           (root / login page)',
      '       HEAD http://localhost:<port>/home       (common post-auth dashboard)',
      '       HEAD http://localhost:<port>/dashboard',
      '       HEAD http://localhost:<port>/app',
      '     If ANY of these returns X-Frame-Options: DENY or SAMEORIGIN, or a restrictive CSP',
      '     frame-ancestors, set ui.openInBrowser=true so the toolbar shows an "Open in browser"',
      '     card instead of a dead iframe. Many apps (n8n, Grafana, Metabase, Superset) allow',
      '     the login page in an iframe but block post-login routes — testing only root / will',
      '     miss this and leave the user with a blank panel after login.',
      '     If ALL checked routes allow embedding, set ui.port = its real port,',
      '     ui.openInBrowser=false, and iframe it.',
      '   - If it has NO web UI (pure CLI/daemon), still install+run it, then generate a thin control',
      '     panel (served by http.server, which DOES allow embedding) whose buttons call Extella experts',
      '     that run the tool\'s REAL commands (start/stop/status/actions).',
      '   - mode = "repo_ui".',
      '2. REPO IS FUNCTIONAL ONLY (a library/SDK, no UI) → generate a functional UI.',
      '   - Generate ONE self-contained index.html that actually drives the library\'s real',
      '     capabilities (not an empty placeholder). Use the LIGHT VISUAL STYLE below.',
      '     If the capability needs server-side code, create Extella experts (fython/shell/',
      '     interpreter) and have the UI call them.',
      '   - mode = "generated_ui".',
      '3. SMALL REPO / a few concrete functions → wrap the functions as experts + UI.',
      '   - Create one Extella expert per useful function, then generate an index.html on top',
      '     of them so the user can run each function with inputs and see results.',
      '     Use the LIGHT VISUAL STYLE below.',
      '   - mode = "generated_ui".',
      '',
      '=== HARD RULES (most installs fail by breaking these) ===',
      'R1. The plugin MUST be the REAL, WORKING tool — not a description of it. NEVER hand-write a',
      '    landing / marketing / "About" / "Quick start" / instructions page and serve that as the',
      '    plugin. SPECIFIC BAN: a page that shows install commands with "Copy" buttons (e.g.',
      '    "npx <tool> onboard", "<tool> start"), a "Requirements" table, or Docs/Discord/GitHub links',
      '    instead of working controls is a FAILED install. Buttons must DO things (call experts or the',
      '    running service via the bridge below), not copy text. Do not write the manifest for a',
      '    description page.',
      'R2. If the README/docs show install/run commands (e.g. "npx <tool> onboard", "npm install"',
      '    then "npm start", "pip install" then a run command, a setup script, docker compose up),',
      '    that repo is a RUNNABLE APP → category 1b. YOU must actually execute those exact commands',
      '    on this device (via shell/cli_*/nohup): install the toolchain + all dependencies, run any',
      '    onboarding/setup step, then start the real long-running server/process.',
      'R3. The plugin UI must be served BY the real running tool (iframe its real port), OR — if the',
      '    tool is a CLI/daemon with no web UI of its own — a UI you generate that ACTUALLY drives the',
      '    real tool through Extella experts that run its real commands. Either way the controls must',
      '    perform real actions, never be decorative.',
      'R4. Default bias: if unsure between "generate a pretty page" and "install + run the real tool",',
      '    ALWAYS choose installing and running the real tool. Pretty static pages are only valid for',
      '    genuinely static sites (category 1a).',
      '',
      '=== UMD RECIPE (for embedding a published React component) ===',
      '- Prefer UMD bundles over bare esm.sh — esm.sh import-maps are unreliable for complex',
      '  React libraries and render blank. Use this order:',
      '  1) React+ReactDOM 18 UMD from unpkg:',
      '     https://unpkg.com/react@18/umd/react.production.min.js',
      '     https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
      '  2) The package UMD bundle. Discover the real file via the unpkg meta listing',
      '     (https://unpkg.com/<pkg>@<ver>/?meta) and pick dist/*.umd*.min.js or dist/*.min.js;',
      '     also pull its CSS (the package "style" field or dist/*.css).',
      '  3) In a bootstrap script, find the exported global (explicit UMD global name, else the',
      '     new key on window) and ReactDOM.render it into #root.',
      '- Only if no UMD bundle exists, fall back to an esm.sh module build, and still validate.',
      '',
      '=== UI <-> EXPERTS BRIDGE (this is how a UI runs REAL actions — buttons MUST use it) ===',
      'Your index.html runs in an iframe on a LOCAL origin. It CANNOT call api.extella.ai',
      'directly — the browser blocks cross-origin requests ("Failed to fetch"). So NEVER',
      'fetch the API from the UI. Instead ask the toolbar (parent) to run the expert for you',
      'via postMessage; the toolbar has API access and posts the result back. Copy this bridge',
      'verbatim and call runExpert(name, params) from your buttons:',
      '  var _rq = 0, _pend = {};',
      '  window.addEventListener("message", function (e) {',
      '    if (e.data && e.data.type === "etb_expert_result" && _pend[e.data.reqId]) {',
      '      var p = _pend[e.data.reqId]; delete _pend[e.data.reqId];',
      '      if (e.data.ok) p.resolve(e.data.res); else p.reject(new Error(e.data.error || "expert failed"));',
      '    }',
      '  });',
      '  function runExpert(name, params) {',
      '    return new Promise(function (resolve, reject) {',
      '      var id = "r" + (++_rq) + "_" + Date.now(); _pend[id] = { resolve: resolve, reject: reject };',
      '      (window.parent || window).postMessage({ type: "etb_run_expert", reqId: id, name: name, params: params }, "*");',
      '      setTimeout(function () { if (_pend[id]) { delete _pend[id]; reject(new Error("timeout")); } }, 180000);',
      '    }).then(function (res) {',
      '      var out = (res && res.result !== undefined) ? res.result : res;',
      '      if (typeof out === "string") { try { out = JSON.parse(out); } catch (e) {} }',
      '      return out;  // the expert\'s parsed JSON result, e.g. { status, ... }',
      '    });',
      '  }',
      '(etb_init still arrives with { token, apiBase, theme } — use it only for theming; the',
      'token is NOT needed in the UI because the toolbar runs experts on your behalf.)',
      'Every interactive control MUST call a real expert (or the running service) and render its real',
      'output. A button that only copies a shell command, links to docs, or shows static text is a',
      'FAILED UI. If a real action needs user input (API key, model, channel, message text), collect',
      'it with form fields and pass it as params — do NOT tell the user to run commands in a terminal.',
      '',
      '=== HARD SANDBOX RULES (violating any ships a plugin that crashes on first click) ===',
      'The index.html runs in a browser iframe with NO filesystem and NO backend of its own.',
      'It makes NO direct API calls at all — the ONLY way to run a real action is the runExpert()',
      'postMessage bridge above (or, for a local_server plugin, a fetch to its OWN http_port).',
      'NEVER fetch api.extella.ai or invent any endpoint — no /api/upload, /api/ocr, /predict, no',
      'custom API. A direct cross-origin fetch fails with "Failed to fetch"; a wrong path returns',
      'an HTML 404 so JSON.parse dies with "Unexpected token \'<\'". There is NO file-upload endpoint.',
      'FILE INPUTS: a browser CANNOT put a file onto the device. If an expert needs a file',
      '(image_path, pdf_path, file_path, etc.), the UI MUST use a TEXT field where the user types or',
      'pastes the path to a file ON THIS DEVICE, and pass that string to the expert. Do NOT build',
      '<input type="file">, FormData, or any upload flow — they physically cannot reach the device.',
      'Every file-processing expert must accept a device-path parameter and read the file itself.',
      '',
      _visualStyleBlock(),
      '=== CONTROL-PANEL RECIPE (for CLI / daemon tools with no web UI of their own) ===',
      'When the tool is a CLI/daemon (e.g. an "onboard" wizard + a "start" gateway like OpenClaw):',
      '1) Install it for real (npm i -g / npx / pip / clone+build) on this device.',
      '2) Create small action experts (shell/nohup) that run the tool\'s REAL commands NON-interactively,',
      '   e.g. one expert per action: configure(set api key/provider/channel via flags or a written',
      '   config file), start (launch the long-running gateway detached, write pid), stop, status, and',
      '   any primary action (send message / run task). Pass user input as kwargs; never block on a TTY.',
      '3) Generate index.html as a real control panel using the LIGHT VISUAL STYLE above:',
      '   input fields for required config (API key, provider, channel, message), and buttons',
      '   wired via runExpert() to those action experts, with a live output/status area.',
      '   This IS the working plugin — not a description of one. Never dark-themed.',
      '',
    ].concat(analysis && (analysis.category === '2' || analysis.category === '3') ? [] : [
      '=== PHASED SETUP RECIPE (1b-multi only) ===',
      'Use when README requires multiple ordered commands (onboard → configure → start, etc.).',
      'Phase 1: read local README via fython to get exact ordered commands.',
      'Phase 2: execute each step as ONE CSPL expert; capture stdout+stderr+exit.',
      'Phase 3: smoke-test after each step (binary --version, port open, pid exists).',
      'Phase 4: if a step fails — diagnose from captured output, fix PATH/deps, retry THAT step.',
      'Phase 5: pass output tokens from one step as explicit kwargs to the next.',
      'Phase 6: only after ALL steps pass → save start expert + write manifest.',
      '',
    ]).concat([
      '=== ENVIRONMENT & PATH (CRITICAL — the #1 reason installs fail) ===',
      'Experts run with a MINIMAL PATH (often only /usr/bin:/bin:/usr/sbin:/sbin). User-installed',
      'tools (node/npm/npx via nvm, Homebrew binaries, pipx, the tool\'s own CLI) are NOT on it, so a',
      'bare which/`subprocess(["npm",...])` reports "not found" EVEN WHEN THE TOOL IS INSTALLED.',
      'NEVER conclude a tool is missing from that. In EVERY expert that runs a CLI:',
      '- First RESOLVE real binaries. Search the user dirs and a login shell, e.g.:',
      '    home=os.path.expanduser("~")',
      '    import glob',
      '    cand=glob.glob(home+"/.nvm/versions/node/*/bin")+["/opt/homebrew/bin","/usr/local/bin",',
      '         home+"/.local/bin","/opt/homebrew/sbin","/usr/bin"]',
      '    env=dict(os.environ); env["PATH"]=":".join(cand)+":"+env.get("PATH","")',
      '    # or: subprocess.run(["/bin/zsh","-lc","command -v <tool>"],capture_output=True,text=True,env=env)',
      '- Then call the ABSOLUTE path (or run via ["/bin/zsh","-lc", cmd]) and REUSE this same env',
      '  (augmented PATH) for install, start, and every action expert. The start expert must export',
      '  this PATH too, or the launched process will not find node/the tool.',
      '- Only after resolution truly fails everywhere may you install the toolchain yourself. If the',
      '  tool\'s own binary already exists (e.g. /opt/homebrew/bin/<tool>), DO NOT reinstall — use it.',
      '',
      '=== CSPL GUIDE (prefer CSPL for device work) ===',
      '- fython     : short synchronous Python (write files, read dirs, small HTTP) — stdlib only.',
      '- nohup      : long-running / detached background process (builds, the http.server).',
      '- shell / cli_*: git clone, npm/yarn/pnpm install, build commands, toolchain setup.',
      '- interpreter / node_exec: run Node or other languages when a build needs it.',
      '- parallel_task + wait_tasks: run independent steps concurrently, then join.',
      'Install any missing toolchain (node, package manager) yourself before building.',
      '',
      '=== THE START EXPERT (' + ctx.startExpert + ') ===',
      'Create and save ONE fython expert with EXACTLY this name and signature so the toolbar can',
      '(re)start the plugin later. It takes port + root_path kwargs, kills any old pid, launches a',
      'DETACHED process, and writes the pid file. The launch command depends on the category:',
      '  - category 1a (static UI): run python3 -m http.server in root_path.',
      '  - category 1b (runnable app): run the REAL app launch command (e.g. ["npx","n8n"],',
      '    ["npm","start"], ["python3","app.py"], a venv binary, or docker) in root_path, with any',
      '    required env (e.g. N8N_PORT). Make it idempotent: if deps are missing, install them first.',
      'Hardcode the chosen launch command/env inside the expert body so a later restart reproduces it.',
      '',
      '  def ' + ctx.startExpert + '(port: str = "' + ctx.port + '", root_path: str = "' + ctx.rootPath + '") -> str:',
      '      import subprocess, os, signal, json, time',
      '      root = os.path.expanduser(root_path)',
      '      import tempfile',
      '      def _tmp_path(p):',
      '          return p if os.path.isdir("/tmp") or not p.startswith("/tmp/") else \\',
      '              os.path.join(tempfile.gettempdir(), p[len("/tmp/"):])',
      '      pid_file = _tmp_path("' + ctx.pidFile + '")',
      '      if os.path.exists(pid_file):',
      '          try:',
      '              os.kill(int(open(pid_file).read().strip()), signal.SIGTERM); time.sleep(0.3)',
      '          except Exception: pass',
      '      env = dict(os.environ)   # augment env["PATH"] (see ENVIRONMENT & PATH) so node/the tool resolve',
      '      # 1a static site, OR a generated control panel for a CLI/daemon tool (openclaw-style):',
      '      #   cmd = ["python3","-m","http.server",str(int(port))]  — http.server serves the PANEL; the',
      '      #   real tool runs via the action experts the panel calls. This is correct for daemon tools.',
      '      # 1b app WITH ITS OWN WEB UI (n8n etc.): REPLACE with the REAL launch command, e.g.',
      '      #   ["npx","n8n"] / ["npm","start"] / ["python3","app.py"] / docker; set required env',
      '      #   (e.g. env["PORT"]=str(int(port))). Shipping http.server for an app that has its own',
      '      #   web server is a FAILURE.',
      '      cmd = ["python3","-m","http.server",str(int(port))]   # REPLACE for 1b apps with own web UI',
      '      proc = subprocess.Popen(cmd, cwd=root, env=env,',
      '          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)',
      '      open(pid_file,"w").write(str(proc.pid)); time.sleep(0.8)',
      '      return json.dumps({"status":"started","pid":proc.pid,"port":int(port),"root":root})',
      '',
      '=== ORDERED STEPS ===',
    ].concat(analysis && analysis.category ? [
      'PRE-ANALYSIS COMPLETE — skip step 1, proceed directly to step 2.',
      'Category: ' + analysis.category,
      analysis.setup_steps && analysis.setup_steps.length
        ? 'Setup commands: ' + JSON.stringify(analysis.setup_steps)
        : '',
      analysis.port ? 'Documented port: ' + analysis.port : '',
      analysis.env_vars && analysis.env_vars.length
        ? 'Required env vars: ' + analysis.env_vars.join(', ')
        : '',
      analysis.notes ? 'Notes: ' + analysis.notes : '',
      ''
    ] : [
      '1) Analyze the repo (tree + README below) and choose the category (1a / 1b-simple / 1b-multi / 2 / 3).',
      '1.5) FOR 1b TOOLS ONLY — extract and execute the setup sequence BEFORE anything else:',
      '   a) Read the installed README via a CSPL fython expert (Phase 1 of PHASED SETUP RECIPE).',
      '   b) Identify whether this is 1b-simple (single install+start) or 1b-multi (ordered steps).',
      '   c) For 1b-multi: execute Phases 2–4 of the PHASED SETUP RECIPE fully. Each step gets its own',
      '      CSPL expert. Validate after each step. Do NOT proceed to step 2 until all setup steps pass.',
      '   d) For 1b-simple: run a single install + start expert, then proceed to step 5 validation.',
    ]).concat([
      '>> PINOKIO APPS (repo_class "pinokio_app", or install.js/pinokio.js/pinokio.json in the tree):',
      '   the repo carries its OWN install recipe — do NOT guess a generic python/node setup',
      '   (running `uv pip install -r requirements.txt` on such a repo fails: the file does not exist,',
      '   the real steps live in install.js — e.g. it first clones ANOTHER repo into app/).',
      '   Instead run the GLOBAL expert app_install {repo:"<git url>", app_id:"' + ctx.pluginId + '"}',
      '   on THIS device: it clones the repo, resolves install.js deterministically (gpu/platform,',
      '   exists/which) and executes the recipe, then writes the plugin registry itself.',
      '   Launch via app_start {app_id}. If app_install returns an error — surface its human message',
      '   and reply {"ok": false, ...}; do NOT fall back to guessing dependency files.',
      '2) Obtain/build/generate the UI (1a/2/3) OR, for 1b, the setup is complete from step 1.5 above.',
      '   Put the static entry at ' + ctx.rootPath + '/index.html only for 1a/2/3.',
      '3) Create any Extella experts you need (categories 2 & 3) and save them GLOBAL (global:true).',
      '   >> EXPERT SAVE CAN FAIL SILENTLY (known platform quirk). After saving EACH expert you MUST',
      '      verify it actually exists: look it up by name (get_expert / expert lookup, global scope).',
      '      If the lookup fails, re-save and re-verify (up to 2 retries). If an expert STILL does not',
      '      exist after retries, DO NOT claim success — reply {"ok": false, ...} listing the missing',
      '      expert names. A plugin whose UI calls a missing expert is a FAILED install: every button',
      '      dies with "Error: Expert not found" at runtime.',
      '4) Save the start expert ' + ctx.startExpert + ' and run it (target this device) to launch the',
      '   process: a static server (1a) OR the REAL app/service on its real port (1b).',
      '   Verify ' + ctx.startExpert + ' exists by name lookup too (same retry rule as step 3) — without',
      '   it the toolbar cannot relaunch the server after a reboot.',
      '5) VALIDATE IT IS ACTUALLY RUNNING AND REAL. Let SERVE_PORT be the port you serve on (http_port',
      '   for 1a/2/3, the real service port for 1b).',
      '   >> DETERMINING SERVE_PORT FOR DOCKER / docker-compose APPS: use the PUBLISHED HOST port — the',
      '      LEFT side of the compose "ports:" mapping, resolving ${VAR:-default} (e.g. "${APP_PORT:-7000}:7000"',
      '      -> host port 7000), or read it from `docker compose -f <file> ps`. Do NOT guess the app\'s',
      '      INTERNAL/default port (Flask 5000, Rails 3000, Django 8000, Vite 5173): that port is NOT',
      '      reachable from the host unless compose publishes it. Poll the HOST-published port ONLY.',
      '   >> macOS TRAP: host ports 5000 AND 7000 are BOTH occupied by the system AirPlay Receiver',
      '      (process ControlCenter, listens on *:5000 and *:7000 incl. IPv6). It answers with',
      '      "Server: AirTunes/..." and HTTP 403 for EVERYTHING. NEVER treat :5000 or :7000 as a plugin',
      '      health port. If a compose file publishes to host :5000 or :7000 (common — e.g.',
      '      "${APP_PORT:-7000}:7000"), REMAP the host side to a free port outside those (e.g. 8700):',
      '      set APP_PORT/the published port in .env or the compose, `docker compose up -d`, and use the',
      '      new port as SERVE_PORT and in the manifest. Note: a browser resolves localhost to IPv6 (::1)',
      '      first, so even if Docker binds IPv4 127.0.0.1:7000, the browser still hits AirPlay on ::1:7000.',
      '   Poll GET http://localhost:<SERVE_PORT>/ as follows:',
      '   Base poll: 12 retries × 5 s = 60 s max. HARD CAP: never exceed ~30 polls total for the whole',
      '   install — a runaway poll loop (e.g. probing a port that always errors) exhausts the agent step',
      '   budget and crashes the install with a GRAPH_RECURSION_LIMIT error. If the server has not',
      '   responded yet, read its log file (if you wrote one via nohup/the server process). If the log',
      '   contains words like "downloading", "compiling", "building", "Installing", "Downloading" or',
      '   similar — the server is still starting up: extend the wait by ONE extra round of 12 retries × 5 s',
      '   (another 60 s). If after that it still does not respond, STOP polling and move on to diagnose +',
      '   fix rather than waiting further.',
      '   >> WHAT COUNTS AS "UP": ANY HTTP status the server itself returns means the service is RUNNING —',
      '      200, ANY 3xx redirect (302 -> /login is a healthy app behind an auth gate), or 401/403 that',
      '      come FROM THE APP\'s own auth. Stop polling the instant you get any HTTP status. ONLY a',
      '      connection-refused / timeout (nothing listening) means DOWN. A redirect or login page is a',
      '      PASS: set service.ready=true; if it sends X-Frame-Options/CSP frame-ancestors, also set',
      '      ui.openInBrowser=true so the toolbar shows an external-open card instead of a blank iframe.',
      '   For a 200 HTML body (a 3xx/auth response already counts as UP per above), the response must be:',
      '   (a) non-empty and not an error/"not running" page, not a build-template stub, not an empty',
      '       <div id="root"> with no script; AND',
      '   (b) the REAL tool — not a page you authored merely to describe it. Two valid shapes:',
      '       - App WITH its own web UI (n8n etc.): the pid on SERVE_PORT must be the app/CLI you',
      '         launched (node/python/docker), NOT http.server serving a static file you wrote. ALSO',
      '         check embedding: if the response has X-Frame-Options DENY/SAMEORIGIN or a restrictive',
      '         CSP frame-ancestors, an iframe would be BLANK/BLACK — set ui.openInBrowser=true so the',
      '         toolbar offers an external-open card instead of a dead iframe.',
      '       - CLI/daemon with a generated control panel (openclaw etc.): http.server serving YOUR',
      '         working panel is fine, BUT you must ALSO prove the tool truly works: run a smoke-test',
      '         action expert (resolved absolute path / login shell) such as "<tool> --version" or a',
      '         status command and confirm it returns real output (not "command not found"). The panel',
      '         buttons must be wired to action experts (not copy-command text).',
      '   A hand-written description / Quick-Start / copy-command page is ALWAYS a FAILED install.',
      '   If blank/broken/unreachable/fake, OR the smoke test shows the tool is not actually installed/',
      '   runnable, fix it (resolve PATH, install missing deps, run the documented commands, correct the',
      '   launch command/env, rebuild) and repeat until the REAL tool genuinely works.',
      '6) Write the manifest JSON (schema below) to ' + ctx.registryPath + '. Create the directory',
      '   ' + ctx.registryDir + ' first. Set ui.port = SERVE_PORT. The JSON must be valid and parseable.',
      '',
      '=== MANIFEST SCHEMA (write this exact shape to registry_file) ===',
      '{',
      '  "id": "' + ctx.pluginId + '",',
      '  "name": "' + _jsonSafe(ctx.displayName) + '",',
      '  "tagline": "<one line>",',
      '  "description": "<short description>",',
      '  "category": "utilities",',
      '  "type": "github",',
      '  "version": "1.0.0",',
      '  "eye": "' + ctx.owner + '/' + ctx.repo + '",',
      '  "source": "' + ctx.url + '",',
      '  "mode": "repo_ui | generated_ui",',
      '  "ui": {',
      '    "type": "local_server",',
      '    "port": <SERVE_PORT: ' + ctx.port + ' for 1a/2/3, or the real service port for 1b>,',
      '    "rootPath": "' + ctx.rootPath + '",',
      '    "startExpert": "' + ctx.startExpert + '",',
      '    "mainFile": "index.html",',
      '    "openInBrowser": false,   // set true ONLY for an app whose web UI blocks iframe embedding',
      '    "expectsHealth": false',
      '  },',
      '  "service": {',
      '    "isApp": <true for category 1b, false otherwise>,',
      '    "port": <real service port for 1b, else ' + ctx.port + '>,',
      '    "startExpert": "' + ctx.startExpert + '",',
      '    "healthPath": "/",',
      '    "launchCmd": "<the exact command you launch, e.g. npx n8n>",',
      '    "ready": <true if it responded to the health poll, else false>',
      '  },',
      '  "experts": ["<names of plugin experts you created, if any>"],',
      '  "conceptTexts": ["<short knowledge text about the plugin for the LLM>"],',
      '  "setupLog": [',
      '    {"step": "<step name, e.g. install/onboard/configure/start>",',
      '     "cmd":  "<exact command or expert name executed>",',
      '     "status": "ok | failed",',
      '     "notes": "<optional: key output, token received, config path written>"}',
      '  ],   // omit or use [] for 1a/2/3 and 1b-simple; REQUIRED for 1b-multi',
      '  "artifacts": {',
      '    "experts": ["' + ctx.startExpert + '", "<every expert you created>"],',
      '    "rootPath": "' + ctx.rootPath + '",',
      '    "pidFile": "' + ctx.pidFile + '",',
      '    "pidFiles": ["' + ctx.pidFile + '", "<any extra pid files you wrote>"],',
      '    "registryFile": "' + ctx.registryPath + '",',
      '    "kvKeys": []',
      '  },',
      '  "installed": true',
      '}',
      '',
      '=== FINAL REPLY ===',
      'After the manifest file is written, reply with ONLY this JSON (no markdown, no prose):',
      '{"ok": true, "plugin_id": "' + ctx.pluginId + '", "category": "1a|1b|2|3", "mode": "repo_ui", "url": "http://localhost:<SERVE_PORT>/", "notes": "<what you did>"}',
      'If you truly cannot make it run/render, reply {"ok": false, "plugin_id": "' + ctx.pluginId + '", "error": "<reason>"}.',
      '',
      '=== REPOSITORY DIGEST ===',
      _digestBlock(ctx)
    ]));
    return lines.filter(function (l) { return l !== null && l !== undefined; }).join('\n');
  }

  function _jsonSafe(s) {
    return String(s || '').replace(/"/g, '\\"');
  }

  function _safeIdOf(plugin) {
    var id = (plugin && plugin.id) || 'plugin';
    return String(id).replace(/[^a-z0-9]/gi, '_');
  }

  // Repair/run prompt: hand the agent an already-installed plugin that is not
  // running (or not working) and let it diagnose + fix + (re)start autonomously.
  function buildRepair(plugin, failure) {
    plugin = plugin || {};
    var ui = plugin.ui || {};
    var service = plugin.service || {};
    var artifacts = plugin.artifacts || {};
    var safeId = _safeIdOf(plugin);
    var registryPath = artifacts.registryFile || ('~/extella-plugins/_registry/' + safeId + '.json');
    var rootPath = ui.rootPath || artifacts.rootPath || ('~/extella-plugins/' + safeId);
    var port = service.port || ui.port || '';
    var startExpert = ui.startExpert || service.startExpert || ('_etb_srv_' + safeId);

    var lines = [
      'You are the Extella Plugin Repair agent. You run ON THE USER\'S DEVICE with full local',
      'filesystem access plus the Extella CSPL/expert toolset. An already-installed plugin is NOT',
      'running or not working. Diagnose and FIX it fully autonomously; do not ask the user anything.',
      '',
      'CRITICAL — ACT IMMEDIATELY: Submit your FIRST CSPL expert task in this very first message.',
      'Do NOT write prose analysis before acting. Start diagnosing NOW — check process, port, files.',
      '',
      '=== PLUGIN ===',
      'plugin_id   = ' + (plugin.id || ''),
      'name        = ' + (plugin.name || ''),
      plugin.source ? 'source      = ' + plugin.source : null,
      'device_id   = my   (resolve the CURRENT USER\'S OWN device; run everything there)',
      '',
      '=== KNOWN STATE ===',
      'install_dir   = ' + rootPath,
      'serve_port    = ' + port + '   (the toolbar loads http://localhost:' + port + '/)',
      'start_expert  = ' + startExpert + '   ((re)run / fix this to start the process)',
      'registry_file = ' + registryPath + '   (update this manifest if anything changes)',
      'is_app        = ' + (service.isApp ? 'true (real service with its own runtime)' : 'unknown/false'),
      service.launchCmd ? 'launch_cmd    = ' + service.launchCmd : null,
      (plugin.setupLog && plugin.setupLog.length)
        ? ('setup_log (completed steps from original install):\n' +
           plugin.setupLog.map(function (s) {
             return '  [' + (s.status || '?') + '] ' + (s.step || '') + ': ' + (s.cmd || '') + (s.notes ? ' → ' + s.notes : '');
           }).join('\n'))
        : null,
      '',
      '=== OBSERVED FAILURE ===',
      (failure || ('Nothing is responding on http://localhost:' + port + '/.')),
      '',
      '=== ENVIRONMENT & PATH (check this FIRST) ===',
      'Experts run with a MINIMAL PATH (often /usr/bin:/bin:/usr/sbin:/sbin). User tools (node/npm via',
      'nvm, Homebrew, pipx, the tool\'s CLI) are NOT on it, so "npm not found"/"command not found" is',
      'almost always a PATH problem, NOT a missing tool. Before reinstalling anything, resolve real',
      'binaries: glob ~/.nvm/versions/node/*/bin, /opt/homebrew/bin, /usr/local/bin, ~/.local/bin, or',
      'run ["/bin/zsh","-lc","command -v <tool>"]; build env with an augmented PATH and reuse it for',
      'every command and in the start expert. If the tool binary already exists, USE it — do not reinstall.',
      '',
      '=== WHAT TO DO ===',
      '1) Inspect the install dir, the start expert ' + startExpert + ', and what is ACTUALLY serving',
      '   on the port. A 200 response is NOT enough — check WHAT is running and whether the tool\'s real',
      '   CLI works (run "<tool> --version"/status with a resolved absolute path; "not found" usually',
      '   means PATH, see above — fix PATH before concluding it is missing).',
      '2) Detect the most common failure: the install only produced a hand-written description /',
      '   landing / instructions page served by `python3 -m http.server`, while the REAL tool was',
      '   never installed or started. If so, treat it as broken even though it returns 200: read the',
      '   repo README, install the toolchain + ALL dependencies, run the documented onboarding/run',
      '   commands, and start the REAL long-running tool. Other causes: missing deps, wrong launch',
      '   command/env, wrong port, crashed process.',
      '   If setup_log is present above: check which steps completed (status=ok) and which failed.',
      '   Resume from the FIRST failed or missing step. Use the PHASED SETUP RECIPE (onboard →',
      '   configure → start) for any 1b-multi tool — do NOT skip steps that appear completed if the',
      '   tool is not actually running.',
      '3) Install ALL required dependencies and the toolchain if missing (idempotent).',
      '4) Rewrite the start expert (same name ' + startExpert + ', same port/root_path kwargs) so it',
      '   launches the REAL tool (its documented run command / CLI / docker), NOT http.server, then',
      '   run it (target this device).',
      '5) VALIDATE: poll GET http://localhost:' + port + '/ with retries/backoff (up to ~120s) until',
      '   the REAL tool responds — the process listening on the port must be the app/CLI you launched',
      '   (node/python/docker), not http.server serving a static page. If the tool has no web UI,',
      '   ensure its daemon is running and the generated UI\'s experts drive its real commands.',
      'BLACK/BLANK SCREEN: if the service responds 200 but the panel shows a black/blank iframe,',
      'check X-Frame-Options and CSP frame-ancestors on MULTIPLE routes — not just root /:',
      '  HEAD http://localhost:' + port + '/         (root / login)',
      '  HEAD http://localhost:' + port + '/home',
      '  HEAD http://localhost:' + port + '/dashboard',
      '  HEAD http://localhost:' + port + '/app',
      'Many apps (n8n, Grafana, Metabase) allow embedding the login page but block post-login',
      'routes with X-Frame-Options: SAMEORIGIN. If ANY of these returns DENY or SAMEORIGIN,',
      'set ui.openInBrowser=true in the manifest (keep the service running). Do NOT replace it',
      'with a fake page.',
      '',
      'LOCAL_SERVER RULE — CRITICAL:',
      'If this plugin has "type": "local_server" in the manifest, you MUST NOT:',
      '  - Generate or modify any index.html in the install directory.',
      '  - Embed the tool\'s own web UI inside a generated HTML wrapper that loads localhost:PORT',
      '    in another <iframe>. This creates a nested iframe and breaks navigation entirely.',
      '  - Change ui.type in the manifest.',
      'The ONLY permitted changes for local_server plugins are:',
      '  a) Fix/restart the service (install deps, rewrite start expert, run it on the device).',
      '  b) Set ui.openInBrowser=true in the manifest if the service blocks iframe embedding.',
      'If the service runs fine and the iframe is just blank: set openInBrowser=true. Done.',
      '',
      '6) UPDATE the manifest at ' + registryPath + ' to match reality (ui.port, ui.startExpert,',
      '   service.* incl. isApp/launchCmd/ready, artifacts.*) and keep it valid JSON.',
      '',
      'If you must rebuild the UI (e.g. it was a "Copy command" / Quick Start description page), make',
      'a REAL control panel: the toolbar postMessages the iframe { type:"etb_init", token, apiBase },',
      'so buttons call POST <apiBase>/api/expert/run (headers X-Auth-Token, X-Profile-Id:"default",',
      'X-Agent-Id:"' + ((ETB.api && ETB.api.currentAgent) ? ETB.api.currentAgent() : 'agent_XXXXXXXX') + '"; body {expert_name, params}) to run real action experts',
      '(configure/start/stop/status/send). Collect required config (API key, provider, channel,',
      'message) via form fields; never tell the user to run terminal commands.',
      'Use the LIGHT Extella palette (bg #f2f2f7, surfaces #fff, text #111, accent #C67E34) —',
      'NOT a dark theme. Set <html data-lm="1"> and listen for etb_init/etb_theme.',
      '',
      '=== AUTH & CREDENTIALS (if the plugin needs external API keys / tokens) ===',
      'If a credential is missing: load from KV via runExpert("_etb_kv_get", {key:"<id>_api_key"}).',
      'Save user-entered values via runExpert("_etb_kv_set", {key:"...", value:"..."}).',
      'Never access _mkt_xtl_evolution_mcp_registry_v1: it is reserved for the trusted Evolution MCP provider.',
      'Or ask the toolbar for a native form: postMessage({type:"etb_config_request", title:"...",',
      '  fields:[{id:"<key>",label:"...",type:"password"}]}, "*") and listen for etb_config_response.',
      'Always include a Settings button so users can reconfigure without reinstalling.',
      '',
      '=== CSPL GUIDE ===',
      '- shell / cli_*: install deps, run build/launch commands, docker.',
      '- nohup       : long-running / detached processes (the service, builds).',
      '- fython      : short stdlib Python (read/write files, health checks, pid handling).',
      '- interpreter / node_exec: run Node/other languages when needed.',
      '',
      '=== FINAL REPLY ===',
      'Reply with ONLY this JSON (no markdown, no prose):',
      '{"ok": true, "plugin_id": "' + (plugin.id || '') + '", "url": "http://localhost:' + port + '/", "notes": "<what was wrong and how you fixed it>"}',
      'If you truly cannot make it run, reply {"ok": false, "plugin_id": "' + (plugin.id || '') + '", "error": "<reason>"}.'
    ];
    return lines.filter(function (l) { return l !== null && l !== undefined; }).join('\n');
  }

  // Clean-rebuild prompt: deletes stale files, then regenerates UI (soft) or
  // performs a full reinstall from the source GitHub repo (hard / fullReset).
  // Optional `analysis` = JSON from buildRepairAnalysis SubAgent.
  // Optional `logs` = last ~100 lines of plugin log files collected before calling agent.
  function buildCleanReinstall(plugin, fullReset, description, analysis, logs) {
    var ui           = plugin.ui || {};
    var service      = plugin.service || {};
    var artifacts    = plugin.artifacts || {};
    var port         = ui.port || service.port || '';
    var installDir   = artifacts.rootPath   || ui.rootPath   || '~/extella-plugins/' + _safeIdOf(plugin);
    var registryFile = artifacts.registryFile || ('~/extella-plugins/_registry/' + _safeIdOf(plugin) + '.json');
    var cleanupExpert = '_etb_cleanup_' + _safeIdOf(plugin);
    var startExpert  = ui.startExpert || service.startExpert || ('_etb_srv_' + _safeIdOf(plugin));
    var sourceUrl    = plugin.source || '';
    var pluginName   = plugin.name || plugin.id || 'plugin';
    var safeId       = _safeIdOf(plugin);
    var pluginMode   = plugin.mode || ui.mode || 'unknown';

    var lines = [
      'You are an autonomous Extella agent. The user has requested a CLEAN REBUILD of the',
      '"' + pluginName + '" plugin. Follow the steps exactly in order.',
      '',
      '=== PLUGIN INFO ===',
      'Plugin ID   : ' + (plugin.id || safeId),
      'Name        : ' + pluginName,
      'Source      : ' + (sourceUrl || '(not recorded)'),
      'Install dir : ' + installDir,
      'Registry    : ' + registryFile,
      'Port        : ' + port,
      'Start expert: ' + startExpert,
      'Cleanup exp : ' + cleanupExpert,
      'Mode        : ' + pluginMode + '  (repo_ui = cloned repo served statically; generated_ui = agent-created panel; local_server = real running service)',
      '',
      description ? ('=== USER NOTE ===\n' + description + '\n') : null,
      analysis
        ? ('=== PRE-ANALYSIS (from error analyzer) ===\n' +
           'Root cause : ' + (analysis.root_cause || '(unknown)') + '\n' +
           'Repair steps the analyzer recommends:\n' +
           (analysis.repair_steps || []).map(function (s, i) { return '  ' + (i + 1) + '. ' + s; }).join('\n') + '\n' +
           (analysis.notes ? 'Critical notes: ' + analysis.notes : '') + '\n')
        : null,
      logs && logs.trim()
        ? ('=== RECENT PLUGIN LOG OUTPUT (context — do not re-read these files) ===\n' +
           logs.slice(0, 5000) + '\n')
        : null,
      '=== STEP 1 — CLEAN (run this first via CSPL before doing anything else) ===',
      fullReset
        ? [
            'Perform a FULL reset — delete the entire plugin installation:',
            '1a. Run fython expert: try to call the cleanup expert "' + cleanupExpert + '" if it exists.',
            '    If it does not exist, write and run a fython task that does:',
            '      import os, shutil',
            '      for p in ["' + installDir + '", "' + registryFile + '"]:',
            '          expanded = os.path.expanduser(p)',
            '          if os.path.isdir(expanded): shutil.rmtree(expanded, ignore_errors=True)',
            '          elif os.path.isfile(expanded): os.remove(expanded)',
            '1b. Stop OUR server on port ' + port + ' — by our own pid file, never by port:',
            '      import os, signal',
            '      pid_file = _tmp_path("' + ctx.pidFile + '")',
            '      if os.path.exists(pid_file):',
            '          try: os.kill(int(open(pid_file).read().strip()), signal.SIGTERM)',
            '          except Exception: pass',
            '          try: os.remove(pid_file)',
            '          except Exception: pass',
            '      # Никакого lsof + kill -9: этих команд нет на Windows, а на других системах',
            '      # они убьют чужой процесс, который занял тот же порт.',
          ].join('\n')
        : [
            'Perform a SOFT reset — delete ONLY index.html (the agent-generated entry point).',
            'Write and run a fython task that does:',
            '  import os',
            '  d = os.path.expanduser("' + installDir + '")',
            '  entry = os.path.join(d, "index.html")',
            '  if os.path.isfile(entry):',
            '      os.remove(entry)',
            '      print("Removed:", entry)',
            '  else:',
            '      print("index.html not found, nothing to remove")',
            'CRITICAL: do NOT delete any other files (*.js, *.css, fonts, lib directories, etc.).',
            'Those files belong to the cloned repository and must remain intact.',
            'The service on port ' + port + ' should keep running through this step.',
          ].join('\n'),
      '',
      '=== STEP 2 — REINSTALL ===',
      fullReset
        ? [
            'Perform a FULL fresh install from the source repository.',
            'Source GitHub URL: ' + (sourceUrl || '(check plugin manifest — source field)'),
            '',
            'Follow the standard install recipe:',
            '1) Clone the repository into ' + installDir + ' (or re-use if already there).',
            '2) Read the README to identify the install/setup steps.',
            '3) Install all dependencies and run any onboarding/setup steps.',
            '4) Start the service using the documented run command via a nohup expert.',
            '   Save the start expert as ' + startExpert + ' (same name as before).',
            '5) Poll GET http://localhost:' + port + '/ with retries (up to 120s) until it responds.',
            '6) Check X-Frame-Options on /, /home, /dashboard, /app.',
            '   If ANY blocks embedding → set ui.openInBrowser=true.',
            '   Otherwise set ui.openInBrowser=false.',
            '7) Write the manifest to ' + registryFile + '.',
          ].join('\n')
        : [
            'Regenerate index.html in ' + installDir + '.',
            '',
            'Plugin mode is "' + pluginMode + '". Choose your approach accordingly:',
            '',
            'IF mode is "repo_ui":',
            '  The cloned repository files (JS, CSS, fonts, lib/) are still present in ' + installDir + '.',
            '  Write a new index.html that loads those LOCAL files — do NOT reference CDN URLs.',
            '  The page must be the REAL, WORKING tool (the actual editor/app), not a description page.',
            '  FORBIDDEN: pages with "Plugin loaded", "Use Extella chat", install instructions,',
            '  or any text that describes the plugin instead of letting the user USE it.',
            '',
            'IF mode is "generated_ui":',
            '  Generate a fresh interactive control panel that drives the tool via Extella experts.',
            '  Use the LIGHT VISUAL STYLE below.',
            '',
            'IF mode is "local_server":',
            '  The real service at port ' + port + ' has its own web UI.',
            '  Do NOT generate index.html — just iframe it directly (openInBrowser=false) OR',
            '  set openInBrowser=true if it blocks iframe embedding.',
            '',
            'For all modes:',
            'If the service at port ' + port + ' is NOT running: start it via ' + startExpert + ' first.',
            'Check X-Frame-Options on /, /home, /dashboard, /app before deciding openInBrowser.',
            '',
            'LOCAL_SERVER RULE: NEVER generate an index.html that loads localhost:PORT inside another <iframe>.',
            '',
            _visualStyleBlock(),
          ].join('\n'),
      '',
      '=== STEP 3 — UPDATE MANIFEST ===',
      'After the reinstall is complete, write the manifest JSON to ' + registryFile + '.',
      'IMPORTANT manifest rules:',
      '- ui.type MUST be "local_server" if the plugin is served by Python http.server or any local port process.',
      '  Do NOT use "iframe" for locally-served plugins — the toolbar uses ui.type="local_server" to load them.',
      '- ui.type = "iframe" is only for plugins with a remote URL (ui.url field with http/https).',
      '- Preserve ui.startExpert, ui.port, artifacts.*, service.* from the original manifest.',
      'The manifest MUST match what is actually running.',
      '',
      '=== CSPL GUIDE ===',
      '- fython : stdlib Python (file ops, port kill, cleanup). Run synchronously.',
      '- shell / cli_*: git clone, npm/pip install, build commands.',
      '- nohup  : long-running background processes (the service).',
      '',
      '=== ENVIRONMENT & PATH ===',
      'Experts run with minimal PATH. Resolve binaries via glob on ~/.nvm, /opt/homebrew/bin,',
      '/usr/local/bin, ~/.local/bin, or run ["/bin/zsh","-lc","command -v <tool>"] first.',
      '',
      '=== FINAL REPLY ===',
      'Reply with ONLY this JSON (no markdown):',
      '{"ok": true, "plugin_id": "' + (plugin.id || '') + '", "url": "http://localhost:' + port + '/", "notes": "<what you did>"}',
      'If it fails: {"ok": false, "plugin_id": "' + (plugin.id || '') + '", "error": "<reason>"}'
    ];
    return lines.filter(function (l) { return l !== null && l !== undefined; }).join('\n');
  }

  // Short analysis-only prompt: pure LLM, no CSPL, returns JSON category + setup plan.
  // Used as SubAgent-A in the two-phase orchestration flow (see github-add.js).
  // Pre-repair analysis SubAgent prompt. Returns a JSON diagnosis used to
  // enrich the main buildCleanReinstall prompt with a root-cause summary.
  // The SubAgent must NOT dispatch CSPL tasks — pure LLM reasoning only.
  function buildRepairAnalysis(plugin, description, logs) {
    var ui = plugin.ui || {};
    var service = plugin.service || {};
    var safeId = _safeIdOf(plugin);
    var port = service.port || ui.port || '';
    var installDir = (plugin.artifacts && plugin.artifacts.rootPath) || ui.rootPath || ('~/extella-plugins/' + safeId);
    var pluginMode = plugin.mode || ui.mode || 'unknown';

    return [
      'You are a repair analyst. Analyze the failing plugin and return ONLY a JSON object.',
      'Do NOT use CSPL. Do NOT dispatch device tasks. Read what is given and reason.',
      '',
      '=== PLUGIN ===',
      'Name        : ' + (plugin.name || plugin.id || ''),
      'Source      : ' + (plugin.source || '(unknown)'),
      'Mode        : ' + pluginMode + '  (repo_ui=static clone, generated_ui=agent panel, local_server=real service)',
      'Port        : ' + port,
      'Install dir : ' + installDir,
      '',
      description ? ('=== USER DESCRIPTION OF THE PROBLEM ===\n' + description + '\n') : null,
      logs && logs.trim()
        ? ('=== RECENT PLUGIN LOG OUTPUT ===\n' + logs.slice(0, 8000) + '\n')
        : '(No log output available)',
      '',
      '=== YOUR TASK ===',
      'Based on the plugin info, user description, and log output above:',
      '1. Identify the root cause of the failure.',
      '2. List the ordered repair steps the reinstall agent should perform.',
      '3. Note anything critical (broken dependencies, missing env, wrong port, etc.).',
      '',
      'Return ONLY this JSON (no markdown, no prose):',
      '{',
      '  "root_cause": "one-sentence diagnosis",',
      '  "repair_steps": ["step 1", "step 2", "..."],',
      '  "notes": "anything critical for the reinstall agent to know"',
      '}'
    ].filter(function (l) { return l !== null && l !== undefined; }).join('\n');
  }

  function buildAnalysis(ctx) {
    return [
      'You are a repository analyzer. Analyze the repo digest below and return ONLY a JSON object.',
      'Do NOT use CSPL. Do NOT dispatch device tasks. Do NOT install anything.',
      'Just read the digest and return structured JSON.',
      '',
      'Return exactly this shape (fill in real values):',
      '{',
      '  "category": "1a" or "1b-simple" or "1b-multi" or "2" or "3",',
      '  "setup_steps": ["npm install", "npm start"],',
      '  "port": 5678,',
      '  "ui_type": "own_web_ui" or "generated" or "static",',
      '  "env_vars": ["PORT", "API_KEY"],',
      '  "notes": "brief explanation of the category choice"',
      '}',
      '',
      'Category guide:',
      '1a = static/buildable web UI (no own backend), 1b-simple = single install+start command,',
      '1b-multi = multiple ordered setup steps before service is usable,',
      '2 = CLI/daemon with no web UI (generate control panel), 3 = small function library.',
      '',
      '=== REPO DIGEST ===',
      _digestBlock(ctx)
    ].join('\n');
  }

  // ── HuggingFace context/prompts ─────────────────────────────────────────

  // Build deterministic identifiers for a HuggingFace plugin
  function contextHF(harvest, runMode, hfToken) {
    var kind   = harvest.kind || 'space';
    var id     = harvest.id   || '';
    var slugId = id.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    var pluginId = 'hf_' + kind + '_' + _slug(slugId);
    var safeId   = pluginId.replace(/[^a-z0-9]/gi, '_');
    var port     = 34000 + (_hashCode(pluginId) % 1000);
    var res      = harvest.resources || {};

    return {
      hfKind:      kind,
      hfId:        id,
      runMode:     runMode || 'local',
      hfToken:     hfToken || '',
      spaceUrl:    harvest.spaceUrl || '',
      sdk:         harvest.sdk || '',
      pipelineTag: harvest.pipelineTag || '',
      libraryName: harvest.libraryName || '',
      appFile:     harvest.appFile || '',
      displayName: harvest.name || id,
      description: harvest.description || '',
      digest:      harvest.digest || '',
      resources:   res,
      pluginId:    pluginId,
      safeId:      safeId,
      port:        port,
      rootPath:    '~/extella-plugins/' + safeId,
      registryDir: '~/extella-plugins/_registry',
      registryPath:'~/extella-plugins/_registry/' + safeId + '.json',
      startExpert: '_etb_srv_' + safeId,
      pidFile:     '/tmp/etb_srv_' + safeId + '.pid'
    };
  }

  function _hfResourceBlock(ctx) {
    var res = ctx.resources || {};
    var lines = [];
    if (res.diskBytes) lines.push('Disk required: ~' + (res.diskBytes / 1e9).toFixed(1) + ' GB');
    if (res.vramEstimate) lines.push('VRAM estimate: ~' + (res.vramEstimate / 1e9).toFixed(1) + ' GB');
    if (res.hardware) lines.push('Recommended hardware: ' + res.hardware);
    if (res.paramCount) lines.push('Parameters: ' + (res.paramCount / 1e9).toFixed(1) + 'B');
    return lines.length ? ('Resource requirements:\n' + lines.join('\n') + '\n') : '';
  }

  // HF analysis phase — lightweight, no CSPL
  function buildHFAnalysis(ctx) {
    var kind = ctx.hfKind;
    var remoteMode = ctx.runMode === 'remote';
    return [
      'You are a HuggingFace project analyzer. Analyze the project digest below.',
      'Return ONLY a JSON object. Do NOT use CSPL. Do NOT dispatch device tasks.',
      '',
      'Return exactly this shape:',
      '{',
      '  "category": "space_gradio" | "space_streamlit" | "space_docker" | "space_static" | "model_api" | "model_local",',
      '  "setup_steps": ["pip install ...", "python app.py"],',
      '  "port": ' + ctx.port + ',',
      '  "env_vars": [],',
      '  "notes": "brief notes"',
      '}',
      '',
      'Category guide:',
      'space_gradio=Gradio Space (local: pip+python), space_streamlit=Streamlit Space,',
      'space_docker=Docker-based Space, space_static=HTML/JS only,',
      'model_api=model accessed via HF Inference API (remote), model_local=model run locally.',
      '',
      '=== PROJECT DIGEST ===',
      'Kind: ' + kind + '  RunMode: ' + (remoteMode ? 'remote' : 'local'),
      ctx.digest || ('HF ' + kind + ': ' + ctx.hfId)
    ].join('\n');
  }

  // Main HF install prompt — handles all 4 combinations
  function buildHF(ctx, analysis) {
    var kind     = ctx.hfKind;
    var runMode  = ctx.runMode;
    var isRemote = runMode === 'remote';
    var isSpace  = kind === 'space';
    var isModel  = kind === 'model';

    var category = (analysis && analysis.category) || '';

    // Determine what the agent should do
    var recipeBlock = '';
    if (isSpace && isRemote) {
      recipeBlock = [
        '=== RECIPE: REMOTE SPACE (no local install needed) ===',
        'The user wants to open this Space directly on HuggingFace.',
        '1. Do NOT clone. Do NOT install anything locally.',
        '2. Determine the live Space URL: ' + (ctx.spaceUrl || ('https://<owner>-<name>.hf.space')),
        '   You can verify the exact URL from the digest. If X-Frame-Options blocks iframe embed,',
        '   set ui.openInBrowser=true in the manifest.',
        '3. Write the manifest with:',
        '   type="huggingface", mode="remote", ui.type="iframe" (or "browser" if X-Frame blocks),',
        '   ui.url="' + (ctx.spaceUrl || 'https://...-....hf.space') + '".',
        '4. No start expert needed. No port needed.',
        ''
      ].join('\n');
    } else if (isModel && isRemote) {
      recipeBlock = [
        '=== RECIPE: REMOTE MODEL (HF Inference API) ===',
        '1. STEP 0 (MANDATORY): Create a Fython expert that runs `mkdir -p ' + ctx.rootPath + '`.',
        '2. Do NOT download model weights.',
        '3. Generate a control-panel web UI (index.html) that calls the HF Inference API.',
        '   Endpoint: https://router.huggingface.co/v1/chat/completions',
        '   or: https://api-inference.huggingface.co/models/' + ctx.hfId,
        '   The UI must listen for postMessage "etb_init" and read event.data.hf_token.',
        '   Use that token as Authorization: Bearer <token> — do NOT hardcode it.',
        '4. Save the generated index.html to: ' + ctx.rootPath + '/index.html',
        '5. Start a local http.server on port ' + ctx.port + ':',
        '   python3 -m http.server ' + ctx.port + ' --directory ' + ctx.rootPath,
        '   Use a nohup expert so it survives the session.',
        '6. Manifest: type="huggingface", mode="remote", ui.type="local_server",',
        '   ui.port=' + ctx.port + ', service.port=' + ctx.port + ',',
        '   hf.needsToken=true, hf.tokenKvKey="hf_token".',
        _visualStyleBlock(),
        ''
      ].join('\n');
    } else if (isSpace && !isRemote) {
      recipeBlock = [
        '=== RECIPE: LOCAL SPACE ===',
        'SDK: ' + (ctx.sdk || 'unknown') + (ctx.appFile ? '  App file: ' + ctx.appFile : ''),
        '1. STEP 0 (MANDATORY): Create a Fython expert that runs `mkdir -p ' + ctx.rootPath + '`.',
        '2. Clone the Space repository:',
        '   git clone https://huggingface.co/spaces/' + ctx.hfId + ' ' + ctx.rootPath,
        '3. Install dependencies based on SDK:',
        '   - gradio/streamlit: pip install -r requirements.txt (if present)',
        '   - docker: build and run the Docker container',
        '   - static: no install needed',
        '4. Launch the app on port ' + ctx.port + ':',
        '   - gradio/streamlit: PORT=' + ctx.port + ' python ' + (ctx.appFile || 'app.py'),
        '   - docker: docker run -p ' + ctx.port + ':7860 ...',
        '5. Verify the service is reachable at http://localhost:' + ctx.port,
        '6. Write manifest: type="huggingface", mode="local", ui.type="local_server",',
        '   ui.port=' + ctx.port + ', service.port=' + ctx.port + '.',
        ''
      ].join('\n');
    } else if (isModel && !isRemote) {
      recipeBlock = [
        '=== RECIPE: LOCAL MODEL ===',
        'Library: ' + (ctx.libraryName || 'unknown') + '  Pipeline: ' + (ctx.pipelineTag || 'unknown'),
        '1. STEP 0 (MANDATORY): Create a Fython expert that runs `mkdir -p ' + ctx.rootPath + '`.',
        '2. Download model weights using huggingface_hub:',
        '   pip install -q huggingface_hub',
        '   python -c "from huggingface_hub import snapshot_download; snapshot_download(\'' + ctx.hfId + '\', local_dir=\'' + ctx.rootPath + '/weights\')"',
        '   Use HF_TOKEN env var if token is available.',
        '3. Set up inference server based on library_name:',
        '   - transformers/diffusers: generate a FastAPI server with the pipeline',
        '   - llama.cpp/gguf: run llama.cpp server with the GGUF file',
        '   - other: use appropriate runner',
        '4. Generate a control-panel index.html on port ' + ctx.port,
        '5. Write manifest: type="huggingface", mode="local", ui.type="local_server",',
        '   ui.port=' + ctx.port + ', service.port=' + ctx.port + '.',
        _visualStyleBlock(),
        ''
      ].join('\n');
    }

    return [
      'CRITICAL — ACT IMMEDIATELY. Start with Step 0 (CSPL fython task). Do not wait for confirmation.',
      '',
      '=== TASK: INSTALL HUGGINGFACE ' + kind.toUpperCase() + ' ===',
      'Plugin ID  : ' + ctx.pluginId,
      'Safe ID    : ' + ctx.safeId,
      'HF ID      : ' + ctx.hfId,
      'Kind       : ' + kind,
      'Run mode   : ' + runMode,
      'Install dir: ' + ctx.rootPath,
      'Registry   : ' + ctx.registryPath,
      'Start expert: ' + ctx.startExpert,
      'Port       : ' + ctx.port,
      '',
      _hfResourceBlock(ctx),
      recipeBlock,
      '=== CSPL-FIRST RULE ===',
      'ALWAYS start with a "fython" or "nohup" expert task dispatched via CSPL.',
      'Never skip Step 0. The manifest write is the LAST action.',
      '',
      '=== MANIFEST SCHEMA ===',
      'Write this JSON to: ' + ctx.registryPath,
      '{',
      '  "id": "' + ctx.pluginId + '",',
      '  "name": "' + ctx.displayName + '",',
      '  "source": "hf:' + kind + ':' + ctx.hfId + '",',
      '  "type": "huggingface",',
      '  "hfKind": "' + kind + '",',
      '  "hf": {',
      '    "id": "' + ctx.hfId + '",',
      '    "kind": "' + kind + '",',
      '    "runMode": "' + runMode + '",',
      '    "remoteUrl": "' + (isRemote && isSpace ? ctx.spaceUrl : '') + '",',
      '    "pipelineTag": "' + ctx.pipelineTag + '",',
      '    "sdk": "' + ctx.sdk + '",',
      '    "needsToken": ' + (isRemote && isModel ? 'true' : 'false') + ',',
      '    "tokenKvKey": "hf_token"',
      '  },',
      '  "resources": ' + JSON.stringify(ctx.resources || {}) + ',',
      '  "mode": "' + runMode + '",',
      '  "ui": {',
      '    "type": "' + (isRemote && isSpace ? 'iframe' : 'local_server') + '",',
      (isRemote && isSpace) ? ('    "url": "' + ctx.spaceUrl + '",') : null,
      (!isRemote || isModel) ? ('    "port": ' + ctx.port + ',') : null,
      '    "openInBrowser": false',
      '  },',
      (!isRemote || isModel) ? ('  "service": { "port": ' + ctx.port + ', "startExpert": "' + ctx.startExpert + '" },') : null,
      '  "artifacts": { "rootPath": "' + ctx.rootPath + '" },',
      '  "installedAt": <timestamp>',
      '}',
      '',
      '=== PROJECT DIGEST ===',
      ctx.digest || ('HF ' + kind + ': ' + ctx.hfId),
      '',
      analysis ? ('=== ANALYSIS (from SubAgent-A) ===\n' + JSON.stringify(analysis, null, 2)) : ''
    ].filter(function (l) { return l !== null && l !== undefined; }).join('\n');
  }

  return {
    context: context,
    build: build,
    buildRepair: buildRepair,
    buildCleanReinstall: buildCleanReinstall,
    buildRepairAnalysis: buildRepairAnalysis,
    buildAnalysis: buildAnalysis,
    contextHF: contextHF,
    buildHFAnalysis: buildHFAnalysis,
    buildHF: buildHF
  };
})();
