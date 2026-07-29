#!/usr/bin/env node
/**
 * Extella Toolbar — Build Script
 *
 * Reads all source modules and plugin JSON files, then outputs:
 *   build/toolbar.js            — compiled toolbar (injects into Extella Desktop)
 *   build/plugins_manager.html  — marketplace with built-in plugin data
 *   build/plugin-chat.html      — chat interface (copied as-is)
 *
 * Usage:
 *   node build.js
 *   node build.js --watch   (re-run on file changes)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Paths ──────────────────────────────────────────────────────────────────
const ROOT    = __dirname;
const SRC     = path.join(ROOT, 'src');
const PLUGINS = path.join(ROOT, 'plugins');
const PUBLIC  = path.join(ROOT, 'public');
const OUT     = path.join(ROOT, 'build');
const DESKTOP_LOADER = path.join(ROOT, 'assets', 'desktop-loader.webm');
const BRAND_LOGO = path.join(ROOT, 'assets', 'extella-x.png');
const EVOLUTION_STANDARDS_BUNDLE = path.join(
  PLUGINS,
  'scenarios',
  'evolution-standards',
  'evolution-standards-bundle.json'
);
const RELEASE_ARTIFACTS = process.argv.slice(2).includes('--release-artifacts');

// ── Module load order ──────────────────────────────────────────────────────
// Files are concatenated in this exact order inside the IIFE.
const CORE_ORDER = [
  'brand.js',
  'auth.js',
  'api.js',
  'agent-control.js',
  'evolution-console.js',
  'evolution-agent-control-contract.js',
  'evolution-masking-policy.js',
  'evolution-automation-registry.js',
  'evolution-mcp-contract.js',
  'evolution-standards-provider.js',
  'install-prompt.js',
  'repo-analyzer.js',
  'hf-analyzer.js',
  'theme.js',
  'registry.js',
  'evolution-automation-registry-provider.js',
  'evolution-mcp-registry-provider.js',
  'evolution-mcp-read-gateway.js',
  'plugins.js',
  'router.js',
  'shell.js',
  'nav.js',
  'tabs.js'
];

const PANELS_ORDER = [
  'marketplace.js',
  'activity-center.js',
  'library.js',
  'github-add.js',
  'hf-add.js',
  'plugin-view.js'
];

// ── Helpers ────────────────────────────────────────────────────────────────
function readFile(p) {
  return fs.readFileSync(p, 'utf8');
}

function writeFile(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
  const kb = (Buffer.byteLength(content, 'utf8') / 1024).toFixed(1);
  console.log(`  ✓ ${path.relative(ROOT, p)} (${kb} KB)`);
}

// Walk a directory and collect all .json files recursively
function collectJsonFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectJsonFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      results.push(full);
    }
  }
  return results;
}

function evolutionRuntimeBundle(bundle) {
  const runtime = JSON.parse(JSON.stringify(bundle));
  const artifacts = runtime.standards && runtime.standards.artifacts || {};
  Object.keys(artifacts).forEach(function (key) {
    if (artifacts[key] && typeof artifacts[key] === 'object') {
      delete artifacts[key].source;
    }
  });
  return runtime;
}

function loadEvolutionStandardsBundle() {
  if (!fs.existsSync(EVOLUTION_STANDARDS_BUNDLE)) {
    throw new Error('pinned Evolution standards bundle is missing');
  }
  const bundle = JSON.parse(readFile(EVOLUTION_STANDARDS_BUNDLE));
  if (!bundle ||
      bundle.schema !== 'extella.evolution.standards_bundle.v1' ||
      !bundle.standards || !bundle.standards.artifacts ||
      !bundle.passport_template || !Array.isArray(bundle.agents)) {
    throw new Error('pinned Evolution standards bundle has an invalid schema');
  }
  if (bundle.data_mode !== 'DEMO_FIXTURE' ||
      bundle.production_eligible !== false ||
      bundle.live_projection_allowed !== false ||
      !bundle.runtime_policy ||
      bundle.runtime_policy.live_projection !== 'FORBIDDEN' ||
      bundle.runtime_policy.production_merge !== 'FORBIDDEN') {
    throw new Error(
      'static toolbar embedding accepts only the reviewed DEMO_FIXTURE bundle; ' +
      'production Agent Passports require the account-scoped host provider'
    );
  }
  const createHash = require('crypto').createHash;
  ['cabinet_widget', 'help_widget'].forEach(function (key) {
    const artifact = bundle.standards.artifacts[key];
    if (!artifact || typeof artifact.source !== 'string' ||
        !/^[a-f0-9]{64}$/.test(String(artifact.sha256 || ''))) {
      throw new Error(`pinned ${key} source/hash is missing`);
    }
    const actual = createHash('sha256')
      .update(artifact.source, 'utf8')
      .digest('hex');
    if (actual !== artifact.sha256) {
      throw new Error(`pinned ${key} source does not match its SHA-256`);
    }
    if (/<\/script/i.test(artifact.source)) {
      throw new Error(`pinned ${key} cannot be safely embedded in HTML`);
    }
  });
  if (bundle.passport_template.draft_state !== 'NOT_VALIDATED' ||
      !bundle.passport_template.parsed) {
    throw new Error('canonical Agent Passport draft template is unavailable');
  }
  return bundle;
}

function injectEvolutionStandards(html, bundle) {
  const marker = '<!-- EXTELLA_EVOLUTION_STANDARD_ARTIFACTS -->';
  if (String(html).split(marker).length !== 2) {
    throw new Error('Evolution Console must contain exactly one standards marker');
  }
  const artifacts = bundle.standards.artifacts;
  const runtime = evolutionRuntimeBundle(bundle);
  const injected = [
    '<script>window.__EXTELLA_EVOLUTION_STANDARDS_BUNDLE__ = ' +
      jsonForInlineScript(runtime) + ';</script>',
    '<script>',
    artifacts.cabinet_widget.source,
    '</script>',
    '<script>',
    artifacts.help_widget.source,
    '</script>'
  ].join('\n');
  return html.replace(marker, function () { return injected; });
}

// ── Step 1: Load all plugin JSON files ────────────────────────────────────
function loadPlugins(evolutionBundle) {
  const files = collectJsonFiles(PLUGINS);
  const plugins = [];
  for (const f of files) {
    try {
      const data = JSON.parse(readFile(f));
      // Scenario support artifacts (for example the pinned standards bundle)
      // may live beside manifests. Only an object with a stable plugin id and
      // an explicit UI contract is a built-in plugin definition.
      if (!data || typeof data.id !== 'string' || !data.id ||
          !data.ui || typeof data.ui !== 'object') {
        continue;
      }
      const pluginRoot = path.resolve(PLUGINS) + path.sep;
      const pluginRootReal = fs.realpathSync(PLUGINS) + path.sep;
      function readPluginAsset(relativePath, fieldName) {
        const resolved = path.resolve(path.dirname(f), String(relativePath || ''));
        if (!resolved.startsWith(pluginRoot)) {
          throw new Error(`${fieldName} must stay inside toolbar/plugins`);
        }
        if (!fs.existsSync(resolved)) {
          throw new Error(`${fieldName} not found: ${relativePath}`);
        }
        const real = fs.realpathSync(resolved);
        if (!real.startsWith(pluginRootReal)) {
          throw new Error(`${fieldName} symlink must stay inside toolbar/plugins`);
        }
        return readFile(real);
      }

      // Keep large reviewed UIs and Expert sources as ordinary files, then
      // inline them into the single-file toolbar bundle at build time.
      if (data.ui && data.ui.htmlFile) {
        data.ui.html = readPluginAsset(data.ui.htmlFile, 'ui.htmlFile');
        if (data.id === 'profit-growth-scenario') {
          data.ui.html = injectEvolutionStandards(
            data.ui.html,
            evolutionBundle
          );
        }
        delete data.ui.htmlFile;
      }
      const expertDefs = data.expert_defs || data.expertDefs || [];
      expertDefs.forEach(function (def) {
        if (!def || !def.codeFile) return;
        def.code = readPluginAsset(def.codeFile, 'expert_defs[].codeFile');
        delete def.codeFile;
      });
      plugins.push(data);
    } catch (e) {
      console.warn(`  ⚠ Could not parse ${f}: ${e.message}`);
    }
  }
  console.log(`  Loaded ${plugins.length} plugin definitions`);
  return plugins;
}

// ── Step 2: Build toolbar.js ───────────────────────────────────────────────
function buildToolbar(plugins, evolutionBundle) {
  const parts = [];

  // Build embedded HTML strings (blob URL approach — no local server needed)
  const marketplaceHtml = buildMarketplace(plugins);
  const chatHtml        = buildChat(plugins);
  const formHtml        = buildForm(plugins);
  const libraryHtml     = buildLibrary();
  const brandLogoImage = getBrandLogoData();

  // ── Banner ─────────────────────────────────────────────────────
  parts.push([
    `// Extella Toolbar v6.0 — Modular Build`,
    `// Build: deterministic`,
    `// Modules: src/core/ + src/panels/ + plugins/*.json`,
    `// DO NOT EDIT THIS FILE DIRECTLY — edit sources in src/ and run: node build.js`,
    ``
  ].join('\n'));

  // ── Отпечаток сборки ───────────────────────────────────────────
  // Практика, о которой договорились 29.07: любой отчёт от коллег начинается
  // с вопроса «какая у вас версия». Чтобы на него отвечали за секунду, а не
  // по памяти, кладём в артефакт короткий отпечаток ВХОДОВ сборки.
  // Именно входов, а не времени: гейт воспроизводимости собирает дважды и
  // сравнивает хэши — метка времени его бы уронила.
  const buildFingerprint = require('crypto')
    .createHash('sha256')
    .update(marketplaceHtml)
    .update(chatHtml)
    .update(formHtml)
    .update(libraryHtml)
    .update(JSON.stringify(plugins))
    .digest('hex')
    .slice(0, 7);

  // ── IIFE start ─────────────────────────────────────────────────
  parts.push(`(function () {\n  'use strict';\n\n  var ETB = {};\n`);
  parts.push(`  var ETB_BUILD = ${JSON.stringify(buildFingerprint)};\n  ETB.build = ETB_BUILD;\n`);
  parts.push(
    `  ETB.evolutionStandardsBundle = ${
      jsonForInlineScript(evolutionRuntimeBundle(evolutionBundle))
    };\n`
  );

  // ── Embedded HTML (marketplace + plugin chat + plugin form) ───────────────
  // These are loaded as blob: URLs so no local HTTP server is required.
  parts.push(`  var _ETB_MARKETPLACE_HTML = ${JSON.stringify(marketplaceHtml)};\n`);
  parts.push(`  var _ETB_CHAT_HTML = ${JSON.stringify(chatHtml)};\n`);
  parts.push(`  var _ETB_FORM_HTML = ${JSON.stringify(formHtml)};\n`);
  parts.push(`  var _ETB_LIBRARY_HTML = ${JSON.stringify(libraryHtml)};\n`);
  parts.push(`  var _ETB_BRAND_LOGO = ${JSON.stringify(brandLogoImage)};\n`);

  // ── Built-in plugins constant ──────────────────────────────────
  parts.push(`  // Built-in plugins (injected by build.js from plugins/*.json)\n`);
  parts.push(`  var BUILTIN_PLUGINS = ${JSON.stringify(plugins, null, 2)};\n`);

  // ── Core modules ───────────────────────────────────────────────
  parts.push(`\n  // ── CORE MODULES ──────────────────────────────────────────────────────────\n`);
  for (const name of CORE_ORDER) {
    const p = path.join(SRC, 'core', name);
    if (!fs.existsSync(p)) {
      throw new Error(`Missing required core module: ${name}`);
    }
    parts.push(`\n  // ── ${name} ─────────────────────────────────────────────────────────\n`);
    parts.push(indent(readFile(p), 2));
  }

  // ── Panel modules ──────────────────────────────────────────────
  parts.push(`\n  // ── PANEL MODULES ─────────────────────────────────────────────────────────\n`);
  for (const name of PANELS_ORDER) {
    const p = path.join(SRC, 'panels', name);
    if (!fs.existsSync(p)) {
      console.warn(`  ⚠ Missing panel module: ${name}`);
      continue;
    }
    parts.push(`\n  // ── ${name} ─────────────────────────────────────────────────────────\n`);
    parts.push(indent(readFile(p), 2));
  }

  // ── Init / Bootstrap ───────────────────────────────────────────
  parts.push([
    ``,
    `  // ── BOOTSTRAP ─────────────────────────────────────────────────────────────`,
    `  // Handle only actions marketplace.js does NOT cover.`,
    `  // install / uninstall / open are handled by marketplace.js _msgHandler`,
    `  // to avoid double-firing when the marketplace iframe is open.`,
    `  window.addEventListener('message', function (e) {`,
    `    if (!e.data || e.data.type !== 'etb_plugin_action') return;`,
    `    var action = e.data.action;`,
    `    if (action === 'github_add') {`,
    `      ETB.marketplace.close(); ETB.githubAdd.open();`,
    `    } else if (action === 'github_add_url') {`,
    `      ETB.marketplace.close(); ETB.githubAdd.open(e.data.url || '');`,
    `    } else if (action === 'hf_add') {`,
    `      ETB.marketplace.close(); ETB.hfAdd.open();`,
    `    } else if (action === 'hf_add_url') {`,
    `      ETB.marketplace.close(); ETB.hfAdd.open(e.data.url || '');`,
    `    }`,
    `  });`,
    ``,
    `  // Mount toolbar when DOM is ready`,
    `  function _mount() {`,
    `    // Remove legacy toolbar if present`,
    `    ['#_eFtb', '#ext-toolbar', '#_etbsw', '#_etbpop'].forEach(function (sel) {`,
    `      var el = document.querySelector(sel);`,
    `      if (el && el.parentNode) el.parentNode.removeChild(el);`,
    `    });`,
    `    // Acquire API token from the live Extella session (in-memory only)`,
    `    ETB.auth.initFromSession();`,
    `    ETB.shell.init();`,
    `    ETB.tabs.init();`,
    `    // Best-effort: pull agent-installed plugins from the native registry`,
    `    // through the credential-scrubbing runtime bridge. Gated on a`,
    `    // valid session token so we never hit an empty-token 401 at boot (which`,
    `    // would pop the manual token modal). Offline falls back to the cache.`,
    `    try {`,
    `      ETB.auth.onToken(function () {`,
    `        // Pull the centrally-configured install agent (best-effort, KV mirror).`,
    `        ETB.api.syncInstallAgentFromKV();`,
    `        ETB.api.kvGet('_device_id')`,
    `          .then(function (r) {`,
    `            if (r && r.value) return r.value;`,
    `            try { return (window.extellaDesktop && typeof window.extellaDesktop.getDeviceID === 'function') ? window.extellaDesktop.getDeviceID() : null; }`,
    `            catch (e) { return null; }`,
    `          })`,
    `          .then(function (did) {`,
    `            if (!did) return;`,
    `            return ETB.registry.syncFromDevice(did).then(function (added) {`,
    `              if (added && added.length) ETB.tabs.refresh();`,
    `            });`,
    `          })`,
    `          .catch(function () {});`,
    `      });`,
    `    } catch (e) {}`,
    `  }`,
    ``,
    `  if (document.readyState === 'loading') {`,
    `    document.addEventListener('DOMContentLoaded', _mount);`,
    `  } else {`,
    `    _mount();`,
    `  }`,
    ``,
    `  // Expose ETB globally for debugging`,
    `  window.ETB = ETB;`,
    ``
  ].join('\n'));

  // ── IIFE end ───────────────────────────────────────────────────
  parts.push(`})();\n`);

  return parts.join('');
}

// Indent every line of a string by `n` spaces
function indent(code, n) {
  const prefix = ' '.repeat(n);
  return code.split('\n').map(function (line) {
    return line.length ? prefix + line : line;
  }).join('\n');
}

// JSON embedded inside an HTML <script> must not contain a literal closing
// script tag from an inlined plugin UI. Escape all "<" plus the two JavaScript
// line-separator code points so reviewed HTML remains data, never host markup.
function jsonForInlineScript(value) {
  return JSON.stringify(value, null, 2)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

// ── Step 3: Build plugins_manager.html ────────────────────────────────────
function buildMarketplace(plugins) {
  const template = readFile(path.join(PUBLIC, 'plugins_manager.html'));
  // Отпечаток витрины: короткий хэш её исходника. Нужен, чтобы на вопрос
  // «какая у вас версия» отвечали за секунду — метка видна внизу Рабочего стола.
  // Хэш ИСХОДНИКА, а не времени сборки: гейт воспроизводимости собирает дважды.
  const shopFingerprint = require('crypto')
    .createHash('sha256').update(template).digest('hex').slice(0, 7);
  const _formHtml = buildForm(plugins);
  const _chatHtml = buildChat(plugins);
  const dataVar = `var BUILTIN_PLUGINS_DATA = ${jsonForInlineScript(plugins)};`;
  // Function replacer required: string replacements treat `$'` / `$&` in plugin
  // expert code (regex patterns) as special patterns and corrupt the output.
  return template
    .replaceAll('__ETB_SHOP_BUILD__', shopFingerprint)
    .replaceAll('__EXTELLA_LOGO_DATA__', getBrandLogoData())
    .replaceAll('__EXTELLA_DESKTOP_LOADER_DATA__', getDesktopLoaderData())
    .replace('/* __BUILTIN_PLUGINS_DATA__ */', function () { return dataVar; })
    .replace('/* __PLUGIN_FORM_HTML__ */', function () { return 'var _PLUGIN_FORM_HTML = ' + JSON.stringify(_formHtml).replace(/<\/script/gi, '<\\/script') + ';'; })
    .replace('/* __PLUGIN_CHAT_HTML__ */', function () { return 'var _PLUGIN_CHAT_HTML = ' + JSON.stringify(_chatHtml).replace(/<\/script/gi, '<\\/script') + ';'; });
}

// ── Step 4: Build plugin-chat.html (inject plugin data, same as marketplace) ──
function buildChat(plugins) {
  const template = readFile(path.join(PUBLIC, 'plugin-chat.html'));
  const dataVar = `var BUILTIN_PLUGINS_DATA = ${jsonForInlineScript(plugins)};`;
  return template
    .replaceAll('__EXTELLA_LOGO_DATA__', getBrandLogoData())
    .replace('/* __BUILTIN_PLUGINS_DATA__ */', function () { return dataVar; });
}

// ── Step 4b: Build plugin-form.html (inject plugin data) ──────────────────
function buildForm(plugins) {
  const template = readFile(path.join(PUBLIC, 'plugin-form.html'));
  const dataVar = `var BUILTIN_PLUGINS_DATA = ${jsonForInlineScript(plugins)};`;
  return template
    .replaceAll('__EXTELLA_LOGO_DATA__', getBrandLogoData())
    .replace('/* __BUILTIN_PLUGINS_DATA__ */', function () { return dataVar; });
}

function getBrandLogoData() {
  return fs.existsSync(BRAND_LOGO)
    ? 'data:image/png;base64,' + fs.readFileSync(BRAND_LOGO).toString('base64')
    : '';
}

function getDesktopLoaderData() {
  return fs.existsSync(DESKTOP_LOADER)
    ? 'data:video/webm;base64,' + fs.readFileSync(DESKTOP_LOADER).toString('base64')
    : '';
}

// ── Step 5: Build the embedded Library SPA ─────────────────────────────────
// Reads the Library module's single-file Vite build (../modules/library/dist/
// index.html) and splices a synchronous shim into <head> that lifts credentials
// from the URL hash into window.__MB_* BEFORE the React bundle boots — so the
// SPA's first API request already carries the token (no race with React Query).
//
// IMPORTANT: the SPA routes with createHashRouter, so it reads location.hash as
// the route. The shim therefore STRIPS the credential hash right after reading
// it (history.replaceState) so the router boots on a clean hash (→ /rules)
// instead of choking on `#token=…` and rendering a blank screen.
//
// Returns '' (with a warning) when the build hasn't been produced yet; the
// Library tab then no-ops instead of breaking the toolbar build.
const LIBRARY_DIST = path.join(ROOT, '..', 'modules', 'library', 'dist', 'index.html');

function buildLibrary() {
  if (!fs.existsSync(LIBRARY_DIST)) {
    // Предупреждение в длинном логе — не защита. Живой урок 25-27.07.2026: с 25.07 все
    // релизные артефакты собирались БЕЗ библиотеки (1.1 МБ контента), потому что этот
    // warning никто не читал; у коллег вкладка «Библиотека» была пустой два дня.
    // Поэтому в релизном режиме сборка ПАДАЕТ, а не тихо отдаёт пустую строку.
    const msg = `Library build not found at ${path.relative(ROOT, LIBRARY_DIST)} — ` +
      `run \`npm install && npm run build -w @extella/library\` before building release artifacts.`;
    if (RELEASE_ARTIFACTS) {
      throw new Error('LIBRARY_MISSING_IN_RELEASE: ' + msg);
    }
    console.warn(`  ⚠ ${msg} Library tab will be empty (dev build only).`);
    return '';
  }
  // Отсутствие dist ловится выше, а СТАРЫЙ dist не ловился ничем: он лежит в
  // .gitignore, собирается у каждого локально, и артефакт молча уносил чужую
  // позавчерашнюю сборку Библиотеки. Живой случай 29.07.2026: в собранном
  // toolbar.js всплыл платный agent_extella_default, которого в исходниках
  // Библиотеки уже нет — он приехал из просроченного dist. Гейт account-scope
  // это поймал, но после пуша. Теперь несвежесть видна в момент сборки.
  const LIB_SRC = path.join(ROOT, '..', 'modules', 'library', 'src');
  function newestMtime(dir) {
    let newest = 0;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      const t = st.isDirectory() ? newestMtime(full) : st.mtimeMs;
      if (t > newest) newest = t;
    }
    return newest;
  }
  try {
    if (fs.existsSync(LIB_SRC) &&
        newestMtime(LIB_SRC) > fs.statSync(LIBRARY_DIST).mtimeMs) {
      const stale = 'Библиотека собрана раньше, чем менялись её исходники — ' +
        'артефакт унесёт старую сборку. Выполни `npm run build -w @extella/library`.';
      if (RELEASE_ARTIFACTS) throw new Error('LIBRARY_STALE_IN_RELEASE: ' + stale);
      console.warn(`  ⚠ ${stale}`);
    }
  } catch (e) {
    if (String(e.message || '').startsWith('LIBRARY_STALE_IN_RELEASE')) throw e;
    // Проверка свежести — удобство, а не гейт: сбой обхода не должен ронять сборку.
  }
  const html = readFile(LIBRARY_DIST);
  const shim = [
    '<script>(function(){try{',
    'var h=new URLSearchParams((location.hash||"").replace(/^#/,""));',
    'if(h.get("token"))window.__MB_TOKEN__=h.get("token");',
    'if(h.get("base"))window.__MB_BASE_URL__=h.get("base");',
    'if(h.get("profile"))window.__MB_PROFILE_ID__=h.get("profile");',
    'if(h.get("agent"))window.__MB_AGENT_ID__=h.get("agent");',
    'if(h.get("theme"))window.__MB_THEME__=h.get("theme");',
    // Strip credentials from the hash so HashRouter boots on a clean route.
    // href.split("#") is robust for blob: URLs (unlike location.pathname).
    'history.replaceState(null,"",location.href.split("#")[0]);',
    '}catch(e){}})();</script>'
  ].join('');
  if (html.indexOf('<head>') !== -1) {
    return html.replace('<head>', '<head>' + shim);
  }
  // No literal <head> — prepend; still runs before the body module script.
  console.warn('  ⚠ Library build has no <head> tag — prepending credential shim.');
  return shim + html;
}

// ── Main build ─────────────────────────────────────────────────────────────
function build() {
  console.log('\n🔧 Extella Toolbar — Building...\n');

  const evolutionBundle = loadEvolutionStandardsBundle();
  const plugins = loadPlugins(evolutionBundle);

  console.log('\n📦 Writing output files:');
  const toolbarArtifact = buildToolbar(plugins, evolutionBundle);
  const evolutionConsole = plugins.find(function (plugin) {
    return plugin && plugin.id === 'profit-growth-scenario';
  });
  if (!evolutionConsole || !evolutionConsole.ui ||
      !evolutionConsole.ui.html || evolutionConsole.ui.htmlFile) {
    throw new Error('Evolution Console is missing or its reviewed HTML was not inlined');
  }
  const capabilityStudio = plugins.find(function (plugin) {
    return plugin && plugin.id === 'capability-studio-scenario';
  });
  if (!capabilityStudio || !capabilityStudio.ui ||
      !capabilityStudio.ui.html || capabilityStudio.ui.htmlFile) {
    throw new Error('Capability Studio is missing or its reviewed HTML was not inlined');
  }
  const studioExperts = capabilityStudio.expert_defs ||
    capabilityStudio.expertDefs || [];
  if (!studioExperts.length || studioExperts.some(function (def) {
    return !def.code || def.codeFile;
  })) {
    throw new Error('Capability Studio Expert source was not inlined');
  }
  if (toolbarArtifact.indexOf('profit-growth-scenario') === -1 ||
      toolbarArtifact.indexOf('capability-studio-scenario') === -1) {
    throw new Error('Evolution Console or Capability Studio is absent from the toolbar artifact');
  }
  const providerMarker = 'ETB.evolutionStandardsProvider = (function () {';
  const providerUseMarker = 'var provider = ETB.evolutionStandardsProvider;';
  const providerCount = toolbarArtifact.split(providerMarker).length - 1;
  if (providerCount !== 1 ||
      toolbarArtifact.indexOf(providerUseMarker) === -1 ||
      toolbarArtifact.indexOf(providerMarker) >
        toolbarArtifact.indexOf(providerUseMarker)) {
    throw new Error(
      'Evolution standards provider must appear exactly once before router use'
    );
  }
  writeFile(path.join(OUT, 'toolbar.js'), toolbarArtifact);
  writeFile(path.join(OUT, 'plugins_manager.html'), buildMarketplace(plugins));
  writeFile(path.join(OUT, 'plugin-chat.html'), buildChat(plugins));
  writeFile(path.join(OUT, 'plugin-form.html'), buildForm(plugins));

  writeFile(path.join(ROOT, 'dist_plugins_manager.html'), buildMarketplace(plugins));

  // Checked-in distribution copies are updated only by an explicit release
  // build, so source edits cannot silently diverge from the Node-free handoff.
  if (RELEASE_ARTIFACTS) {
    writeFile(path.join(ROOT, 'toolbar.js'), toolbarArtifact);
    writeFile(path.join(ROOT, '..', 'HANDOFF', 'toolbar.js'), toolbarArtifact);
  }

  // Страж синтаксиса: одна битая запятая в инлайн-скрипте = белый экран витрины
  // у всех пользователей. Компилируем каждый <script> собранных страниц —
  // ошибка валит сборку с точной строкой, а не молча уезжает в прод.
  const vm = require('vm');
  ['plugins_manager.html', 'plugin-chat.html', 'plugin-form.html'].forEach(function (f) {
    const html = fs.readFileSync(path.join(OUT, f), 'utf8');
    (html.match(/<script>[\s\S]*?<\/script>/g) || []).forEach(function (block, i) {
      const code = block.slice('<script>'.length, -'</script>'.length);
      try { new vm.Script(code, { filename: f + '#script' + i }); }
      catch (e) { throw new Error('инлайн-скрипт сломан: ' + f + ' → ' + e.message); }
    });
  });
  console.log('  ✓ Инлайн-скрипты страниц проверены (vm.Script)');

  // Страж канона имён: слова, которые уже переименовывали, не должны
  // возвращаться в видимые тексты — мержи старых веток их воскрешают
  // (случалось: «Визард» и «Сервисы» вернулись со слиянием ws-ui).
  // Комментарии кода из проверки исключены. Список расширять по мере решений:
  // «Фабрика»/«ассистент»/«бот» пока не включены — есть легитимные употребления.
  const CANON_BANNED = [/Визард/, /Строител/, /крут[ия]тся/];
  ['plugins_manager.html', 'plugin-chat.html', 'plugin-form.html'].forEach(function (f) {
    const raw = fs.readFileSync(path.join(OUT, f), 'utf8');
    const scrubbed = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    CANON_BANNED.forEach(function (rx) {
      const m = scrubbed.match(rx);
      if (m) {
        const idx = scrubbed.indexOf(m[0]);
        const ctx = scrubbed.slice(Math.max(0, idx - 60), idx + 60).replace(/\s+/g, ' ');
        throw new Error('канон имён нарушен: «' + m[0] + '» в ' + f + ' → …' + ctx + '…');
      }
    });
  });
  console.log('  ✓ Канон имён соблюдён (Визард/Строитель/«крутятся» не встречаются)');

  console.log('\n✅ Build complete!');

  console.log('\nPackaging — toolbar/build/toolbar.js is a build input for the signed');
  console.log('Extella Client release. Do not deploy this file directly to a user profile.\n');
}

// ── Watch mode ─────────────────────────────────────────────────────────────
function watch() {
  build();
  const chokidar = (() => { try { return require('chokidar'); } catch(e) { return null; } })();
  if (!chokidar) {
    console.log('Install chokidar for watch mode: npm install chokidar');
    return;
  }
  const watcher = chokidar.watch([
    path.join(SRC, '**/*.js'),
    path.join(PLUGINS, '**/*.json'),
    path.join(PLUGINS, '**/*.html'),
    path.join(PLUGINS, '**/*.py'),
    path.join(PUBLIC, '**/*.html')
  ], { ignoreInitial: true });

  watcher.on('change', function (p) {
    console.log(`\n  Changed: ${path.relative(ROOT, p)}`);
    try { build(); } catch (e) { console.error('Build error:', e.message); }
  });
  console.log('Watching for changes... (Ctrl+C to stop)\n');
}

// ── CLI ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.includes('--watch')) {
  watch();
} else {
  try {
    build();
  } catch (e) {
    console.error('\n❌ Build failed:', e.message);
    process.exit(1);
  }
}
