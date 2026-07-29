const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');

const toolbarRoot = path.resolve(__dirname, '..');
const scenarioRoot = path.join(toolbarRoot, 'plugins', 'scenarios');
const manifestPath = path.join(scenarioRoot, 'capability-studio.json');
const htmlPath = path.join(scenarioRoot, 'profit-growth.html');
const expertPath = path.join(scenarioRoot, 'profit-growth-expert.py');

test('Capability Studio has its own manifest and retains the no-write demo Expert', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.id, 'capability-studio-scenario');
  assert.equal(manifest.name, 'Студия способностей');
  assert.equal(manifest.version, '0.3.0');
  assert.equal(manifest.ui.type, 'html');
  assert.equal(manifest.ui.htmlFile, 'profit-growth.html');
  assert.equal(manifest.ui.tokenless, true);
  assert.equal(manifest.expert_defs.length, 1);
  assert.equal(manifest.expert_defs[0].name, 'xtl_capability_studio_profitability_v1');
  assert.equal(manifest.owned_experts, true);
  assert.equal(manifest.expert_defs[0].global, true);
  assert.equal(manifest.capabilities.length, 1);
  assert.equal(
    manifest.capabilities[0].id,
    'profitability_calculation',
  );
  assert.ok(manifest.capabilities.every((capability) => capability.external_writes === false));
});

test('Capability Studio assets retain the toolbar bridge and explicit safety contract', () => {
  assert.ok(fs.existsSync(htmlPath), 'profit-growth.html must exist');
  const html = fs.readFileSync(htmlPath, 'utf8');
  for (const marker of [
    'etb_ui_health',
    'etb_agents_list',
    'etb_run_expert',
    'etb_run_agent',
    'xtl_capability_studio_profitability_v1',
    'external_writes',
    'POLICY_V1',
    'POLICY_V2',
    'PROVEN_CAPABILITIES',
    'data-capability-count="30"',
    'etb_governance_probe',
    'capabilitiesView',
    'memoryView',
    'global=true',
    'Автоматическая подгрузка global Rule моделью пока работает нестабильно',
    'input_sha256 не подтверждает отправленные данные',
    'result_sha256 не подтверждает полученный результат',
    'preview=1',
    'Content-Security-Policy',
    'event.source !== window.parent',
    'etb_agent_control',
    'etb_agent_control_result',
    'etb_account_reset',
    'OPERATION_OUTCOME_UNKNOWN',
    'overviewView',
    'agentsView',
    'governanceView',
    'playgroundView',
    'versionsView',
    'evidenceView',
    'controlExactPublishReady',
    'PLATFORM_RBAC_UNAVAILABLE',
    'effectiveConfigCompleteness',
    'Ordinary Extella chats and agent/run calls outside this adapter are not version-bound',
    'DEMO · IN-MEMORY',
  ]) {
    assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('Capability Studio UI has valid script, unique DOM ids, and an exact demo publish gate', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const scriptStart = html.indexOf('<script>');
  const scriptEnd = html.lastIndexOf('</script>');
  assert.ok(scriptStart >= 0 && scriptEnd > scriptStart);
  const script = html.slice(scriptStart + '<script>'.length, scriptEnd);
  const syntax = spawnSync(process.execPath, ['--check', '-'], {
    input: script,
    encoding: 'utf8',
  });
  assert.equal(syntax.status, 0, syntax.stderr);

  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'all document ids must be unique');
  for (const view of [
    'capabilities',
    'scenario',
    'memory',
  ]) {
    assert.match(html, new RegExp(`data-studio-view="${view}"`));
  }
  const requestedViewStart = html.indexOf(
    "var requestedView = new URLSearchParams(location.search).get('view');",
  );
  const requestedViewEnd = html.indexOf(
    "if (PREVIEW) {",
    requestedViewStart,
  );
  assert.ok(requestedViewStart >= 0 && requestedViewEnd > requestedViewStart);
  const requestedViewSource = html.slice(
    requestedViewStart,
    requestedViewEnd,
  );
  assert.match(
    requestedViewSource,
    /\[\s*'capabilities', 'scenario', 'memory'\s*\]/,
  );
  assert.doesNotMatch(
    requestedViewSource,
    /'overview'|'agents'|'governance'|'playground'|'versions'|'evidence'/,
    'legacy one-agent control views must remain unreachable',
  );
  assert.match(
    script,
    /ledger\.currentDraftId !== draft\.id[\s\S]*?ledger\.currentTestRunId !== testRun\.id/,
  );
  assert.match(
    script,
    /testRun\.draftSha256 !== draft\.draftSha256[\s\S]*?testRun\.candidateBundleSha256 !== draft\.candidateBundleSha256/,
  );
  assert.match(script, /testRun\.coverage\.boundary !== true/);
  assert.match(script, /Number\(testRun\.writeAttempts \|\| 0\) !== 0/);
  assert.match(script, /controlPublishBtn'\)\.disabled = state\.control\.busy \|\| !publishReady/);
});

test('preview calculation mirrors Python half-even rounding at exact ties', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const start = html.indexOf('    function deterministicHalfEven');
  const end = html.indexOf('    async function sha256', start);
  assert.ok(start >= 0 && end > start);
  const context = {};
  vm.runInNewContext(
    `${html.slice(start, end)}\nthis.halfEven = deterministicHalfEven;`,
    context,
  );
  assert.equal(context.halfEven(2.5), 2);
  assert.equal(context.halfEven(3.5), 4);
  assert.equal(context.halfEven(-1.5), -2);
  assert.equal(context.halfEven(-2.5), -2);
});

test('capability catalog contains exactly 30 unique proven entries with honest coverage', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const catalog = html.match(/var PROVEN_CAPABILITIES = \[([\s\S]*?)\n    \];\n    var state =/);
  assert.ok(catalog, 'PROVEN_CAPABILITIES array must be present');
  const ids = [...catalog[1].matchAll(/\bid:\s*'([^']+)'/g)].map((match) => match[1]);
  assert.equal(ids.length, 30);
  assert.equal(new Set(ids).size, 30);
  const coverage = [...catalog[1].matchAll(/\bcoverage:\s*'(live|surface|evidence)'/g)]
    .map((match) => match[1]);
  assert.equal(coverage.length, 30);
  assert.equal(coverage.filter((value) => value === 'live').length, 12);
  assert.equal(coverage.filter((value) => value === 'surface').length, 10);
  assert.equal(coverage.filter((value) => value === 'evidence').length, 8);
  assert.match(catalog[1], /composition\.agent_to_agent[\s\S]*?coverage:\s*'evidence'/);
  assert.match(catalog[1], /evolution\.one_to_many_handler_evolution[\s\S]*?coverage:\s*'evidence'/);
});

test('calculation is deterministic and includes the full cost stack', () => {
  const python = [
    'import importlib.util, json, sys',
    'spec = importlib.util.spec_from_file_location("profit_growth", sys.argv[1])',
    'mod = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(mod)',
    'args = dict(revenue=1000000, cogs=500000, returns_loss=20000, commission=50000, logistics=30000, ad_spend=200000)',
    'first = json.loads(mod.xtl_capability_studio_profitability_v1(**args))',
    'second = json.loads(mod.xtl_capability_studio_profitability_v1(**args))',
    'print(json.dumps({"first": first, "same": first == second}))',
  ].join('; ');
  const run = spawnSync('python3', ['-c', python, expertPath], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.same, true);
  assert.equal(result.first.status, 'success');
  assert.equal(result.first.profit, 200000);
  assert.equal(result.first.margin_bps, 2000);
  assert.deepEqual(result.first.applied_costs, [
    'cogs',
    'returns_loss',
    'commission',
    'logistics',
    'ad_spend',
  ]);
  assert.equal(result.first.external_writes, false);
  assert.match(result.first.result_sha256, /^[a-f0-9]{64}$/);
});

test('calculation rejects non-finite numeric inputs without crashing', () => {
  const python = [
    'import importlib.util, json, sys',
    'spec = importlib.util.spec_from_file_location("profit_growth", sys.argv[1])',
    'mod = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(mod)',
    'values = [float("nan"), float("inf"), float("-inf")]',
    'rows = [json.loads(mod.xtl_capability_studio_profitability_v1(revenue=value)) for value in values]',
    'print(json.dumps(rows))',
  ].join('; ');
  const run = spawnSync('python3', ['-c', python, expertPath], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const rows = JSON.parse(run.stdout);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.status === 'error'));
  assert.ok(rows.every((row) => row.error_code === 'INVALID_TYPE'));
});

test('calculation rejects arithmetic overflow without crashing', () => {
  const python = [
    'import importlib.util, json, sys',
    'spec = importlib.util.spec_from_file_location("profit_growth", sys.argv[1])',
    'mod = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(mod)',
    'row = json.loads(mod.xtl_capability_studio_profitability_v1(revenue=1e308, cogs=1e308, returns_loss=1e308))',
    'print(json.dumps(row))',
  ].join('; ');
  const run = spawnSync('python3', ['-c', python, expertPath], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const row = JSON.parse(run.stdout);
  assert.equal(row.status, 'error');
  assert.equal(row.error_code, 'ARITHMETIC_OVERFLOW');
});

test('verified SHA-256 fails closed when WebCrypto is unavailable', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.match(html, /WebCrypto SHA-256 недоступен; проверяемый запуск остановлен/);
  assert.doesNotMatch(html, /Math\.imul\(h1/);
});

test('router forces tool-free direct agent interpretation', () => {
  const router = fs.readFileSync(path.join(toolbarRoot, 'src', 'core', 'router.js'), 'utf8');
  assert.match(router, /e\.data\.type === 'etb_run_agent'/);
  assert.match(router, /tool_choice:\s*'none'/);
  assert.match(router, /tools:\s*\[\]/);
  assert.match(router, /Anthropic models are disabled for this Studio scenario/);
  assert.match(router, /_studioBoundedNumber\(e\.data\.runTimeout,\s*180,\s*10,\s*180\)/);
  assert.match(router, /_studioBoundedNumber\(e\.data\.maxOutputTokens,\s*700,\s*128,\s*900\)/);
  assert.match(router, /type:\s*'etb_agent_result'/);
  assert.match(router, /if \(!ui\.tokenless\) initPayload\.token = token/);
  assert.match(router, /iframe\.setAttribute\('sandbox',\s*'allow-scripts'\)/);
  assert.doesNotMatch(router, /sandbox['"],\s*['"][^'"]*allow-same-origin/);
  assert.match(router, /expert is not allowed for Capability Studio/);
  assert.doesNotMatch(router, /return iframes\.length === 1 \? iframes\[0\] : null/);
});

test('governance lab is bounded to marked temporary global objects', () => {
  const router = fs.readFileSync(path.join(toolbarRoot, 'src', 'core', 'router.js'), 'utf8');
  const api = fs.readFileSync(path.join(toolbarRoot, 'src', 'core', 'api.js'), 'utf8');
  assert.match(router, /e\.data\.type === 'etb_governance_probe'/);
  assert.match(router, /\^XTL-STUDIO-GOV-\[A-Z0-9_-\]\{8,64\}\$/);
  assert.match(router, /action6 === 'create'/);
  assert.match(router, /action6 === 'verify'/);
  assert.match(router, /action6 === 'update'/);
  assert.match(router, /action6 === 'cleanup'/);
  assert.match(router, /plugin === canonical/);
  assert.match(router, /bridge not granted to this plugin/);
  assert.match(router, /ETB\.api\.agentsList\(\)/);
  assert.match(router, /store:\s*false/);
  assert.match(router, /_studioBoundedNumber\(e\.data\.maxOutputTokens,\s*700,\s*128,\s*900\)/);
  assert.match(router, /conceptAddScoped\(conceptText6,\s*\{\s*agentId:\s*owner6,\s*global:\s*true\s*\}\)/);
  assert.match(router, /ruleAddScoped\(ruleText6,\s*\{\s*agentId:\s*owner6,\s*global:\s*true\s*\}\)/);
  assert.match(router, /_studioConfirmedCleanup/);
  assert.match(router, /_studioSerialize\(marker6/);
  assert.match(router, /_studioListAllConcepts/);
  assert.match(router, /panel\.__etbStudioClosing/);
  assert.match(router, /response\.deleted !== true/);
  assert.match(router, /verifiedAbsent:\s*true/);
  assert.match(router, /_recoverStudioGovernance/);
  assert.match(router, /onSessionChange[\s\S]*?_recoverStudioGovernance\(0\)/);
  assert.match(router, /userId:\s*_studioCurrentUserId\(\)/);
  assert.match(router, /_studioSessionAccountValid/);
  assert.match(router, /__etbBeforeHide/);
  assert.match(api, /_post\('\/api\/concept\/delete'/);
  assert.match(api, /_post\('\/api\/rules\/delete'/);
  assert.match(api, /_post\('\/api\/rules\/update'/);
  assert.match(api, /global:\s*opts\.global === true/);
  assert.match(api, /offset:\s*Math\.max\(0,\s*Number\(opts\.offset \|\| 0\)\)/);
});

function cleanupHarness(api) {
  const router = fs.readFileSync(path.join(toolbarRoot, 'src', 'core', 'router.js'), 'utf8');
  const start = router.indexOf('  function _studioMarkerValid');
  const end = router.indexOf('  // A crash or Desktop restart', start);
  assert.ok(start >= 0 && end > start, 'cleanup helpers must be extractable');
  const storage = new Map();
  const context = {
    ETB: {
      api,
      auth: {
        getUserId() { return 'aaaaaaaaaaaaaaaaaaaaaaaa'; },
      },
    },
    STUDIO_GOV_SESSION_KEY: 'test_studio_session',
    _studioCleanupTimer: null,
    _studioOperationChains: {},
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, value); },
      removeItem(key) { storage.delete(key); },
    },
    setTimeout() { return 1; },
    clearTimeout() {},
    console,
  };
  vm.runInNewContext(
    router.slice(start, end) +
      '\nthis.confirmedCleanup = _studioConfirmedCleanup;' +
      '\nthis.serialize = _studioSerialize;' +
      '\nthis.listAllConcepts = _studioListAllConcepts;' +
      '\nthis.apiOk = _studioApiOk;',
    context,
  );
  return context;
}

test('confirmed cleanup rejects an unconfirmed delete and preserves recovery state', async () => {
  let conceptListCalls = 0;
  const harness = cleanupHarness({
    conceptListScoped: async () => {
      conceptListCalls += 1;
      return {
        status: 'success',
        results: [{ id: 11, global: true, text: 'XTL-STUDIO-GOV-ABCDEFGH CONCEPT' }],
      };
    },
    ruleListScoped: async () => ({ status: 'success', results: [] }),
    conceptDeleteScoped: async () => ({ status: 'success', deleted: false }),
    ruleDeleteScoped: async () => ({ status: 'success', deleted: true }),
  });
  await assert.rejects(
    harness.confirmedCleanup({
      marker: 'XTL-STUDIO-GOV-ABCDEFGH',
      ownerAgentId: 'agent_owner',
      userId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    }),
    /concept delete not confirmed/,
  );
  assert.equal(conceptListCalls, 1, 'must stop before claiming post-delete absence');
});

test('confirmed cleanup re-reads and proves marked objects are absent', async () => {
  let deleted = false;
  let conceptListCalls = 0;
  const harness = cleanupHarness({
    conceptListScoped: async () => {
      conceptListCalls += 1;
      return {
        status: 'success',
        results: deleted
          ? []
          : [{ id: 12, global: true, text: 'XTL-STUDIO-GOV-ABCDEFGH CONCEPT' }],
      };
    },
    ruleListScoped: async () => ({ status: 'success', results: [] }),
    conceptDeleteScoped: async () => {
      deleted = true;
      return { status: 'success', deleted: true };
    },
    ruleDeleteScoped: async () => ({ status: 'success', deleted: true }),
  });
  const result = await harness.confirmedCleanup({
    marker: 'XTL-STUDIO-GOV-ABCDEFGH',
    ownerAgentId: 'agent_owner',
    userId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  });
  assert.equal(result.verifiedAbsent, true);
  assert.equal(result.deletedConcepts, 1);
  assert.equal(conceptListCalls, 2, 'must list before and after deletion');
});

test('cleanup waits for a late in-flight create before proving absence', async () => {
  let exists = false;
  let releaseCreate;
  let markCreateStarted;
  const createGate = new Promise((resolve) => { releaseCreate = resolve; });
  const createStarted = new Promise((resolve) => { markCreateStarted = resolve; });
  const marker = 'XTL-STUDIO-GOV-ABCDEFGH';
  const harness = cleanupHarness({
    conceptListScoped: async () => ({
      status: 'success',
      results: exists ? [{ id: 13, global: true, text: marker + ' CONCEPT' }] : [],
    }),
    ruleListScoped: async () => ({ status: 'success', results: [] }),
    conceptDeleteScoped: async () => {
      exists = false;
      return { status: 'success', deleted: true };
    },
    ruleDeleteScoped: async () => ({ status: 'success', deleted: true }),
  });

  const lateCreate = harness.serialize(marker, async () => {
    markCreateStarted();
    await createGate;
    exists = true;
  });
  await createStarted;
  const cleanup = harness.confirmedCleanup({
    marker,
    ownerAgentId: 'agent_owner',
    userId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  });
  releaseCreate();
  await lateCreate;
  const result = await cleanup;

  assert.equal(result.verifiedAbsent, true);
  assert.equal(result.deletedConcepts, 1);
  assert.equal(exists, false, 'late object must be removed before recovery marker can clear');
});

test('confirmed cleanup finds a marked Concept beyond the first 500 rows', async () => {
  const marker = 'XTL-STUDIO-GOV-ABCDEFGH';
  const firstPage = Array.from({ length: 500 }, (_, index) => ({
    id: index + 1,
    global: true,
    text: 'UNRELATED-' + index,
  }));
  const offsets = [];
  let deleted = false;
  const harness = cleanupHarness({
    conceptListScoped: async (opts) => {
      offsets.push(opts.offset);
      if (opts.offset === 0) {
        return { status: 'success', results: firstPage, count: deleted ? 500 : 501 };
      }
      return {
        status: 'success',
        results: deleted ? [] : [{ id: 999, global: true, text: marker + ' CONCEPT' }],
        count: deleted ? 500 : 501,
      };
    },
    ruleListScoped: async () => ({ status: 'success', results: [] }),
    conceptDeleteScoped: async (id) => {
      assert.equal(id, 999);
      deleted = true;
      return { status: 'success', deleted: true };
    },
    ruleDeleteScoped: async () => ({ status: 'success', deleted: true }),
  });

  const result = await harness.confirmedCleanup({
    marker,
    ownerAgentId: 'agent_owner',
    userId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  });
  assert.equal(result.verifiedAbsent, true);
  assert.equal(result.deletedConcepts, 1);
  assert.deepEqual(offsets, [0, 500, 0, 500]);
});

test('cleanup never proves absence with a different signed-in account', async () => {
  let reads = 0;
  const harness = cleanupHarness({
    conceptListScoped: async () => {
      reads += 1;
      return { status: 'success', results: [] };
    },
    ruleListScoped: async () => ({ status: 'success', results: [] }),
    conceptDeleteScoped: async () => ({ status: 'success', deleted: true }),
    ruleDeleteScoped: async () => ({ status: 'success', deleted: true }),
  });

  await assert.rejects(
    harness.confirmedCleanup({
      marker: 'XTL-STUDIO-GOV-ABCDEFGH',
      ownerAgentId: 'agent_owner',
      userId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
    }),
    /invalid studio cleanup session/,
  );
  assert.equal(reads, 0, 'must not query or clear objects in the wrong account');
});

test('governance API validator rejects FastAPI validation envelopes', () => {
  const harness = cleanupHarness({});
  assert.throws(
    () => harness.apiOk({ detail: [{ msg: 'rule_id is invalid' }] }, 'delete'),
    /rule_id is invalid/,
  );
});

test('build inlines reviewed HTML and Expert source files', () => {
  const build = fs.readFileSync(path.join(toolbarRoot, 'build.js'), 'utf8');
  assert.match(build, /data\.ui\.htmlFile/);
  assert.match(build, /def\.codeFile/);
  assert.match(build, /must stay inside toolbar\/plugins/);
  assert.match(build, /fs\.realpathSync\(resolved\)/);
  assert.match(build, /symlink must stay inside toolbar\/plugins/);
  assert.match(build, /function jsonForInlineScript/);
  assert.match(build, /\.replace\(\/<\/g,\s*'\\\\u003c'\)/);
  assert.match(build, /Capability Studio is absent from the toolbar artifact/);
  assert.match(build, /path\.join\(PLUGINS,\s*'\*\*\/\*\.html'\)/);
  assert.match(build, /path\.join\(PLUGINS,\s*'\*\*\/\*\.py'\)/);
});

test('scenario is visible in the normal curated program catalog', () => {
  const marketplace = fs.readFileSync(
    path.join(toolbarRoot, 'public', 'plugins_manager.html'),
    'utf8',
  );
  assert.match(marketplace, /'profit-growth-scenario':\s*\{\s*biz:'work'/);
});

test('live smoke selects account agents dynamically and keeps Agent calls ephemeral', () => {
  const smoke = fs.readFileSync(
    path.join(toolbarRoot, 'tests', 'live-profit-growth-smoke.py'),
    'utf8',
  );
  assert.match(smoke, /DEFAULT_AGENT = "agent_extella_alibaba_default"/);
  assert.match(smoke, /agents = choose_agents\(post\(token,\s*"\/api\/agent\/list",\s*\{\}\)\)/);
  assert.match(smoke, /"store": False/);
  // canon-ok: проверка утверждает ОТСУТСТВИЕ зашитого id — это охранник того же
  // канона, что и гейт; ругаться на него значит запрещать саму проверку
  assert.doesNotMatch(smoke, /agent_XwZBKvd8dD70jKvW4WrZm/);  // canon-ok: проверка требует ОТСУТСТВИЯ id
});

test('uninstall removes only Experts explicitly owned by the Studio manifest', () => {
  const marketplaceHost = fs.readFileSync(
    path.join(toolbarRoot, 'src', 'panels', 'marketplace.js'),
    'utf8',
  );
  assert.match(marketplaceHost, /unPlugin\.owned_experts === true/);
  assert.match(marketplaceHost, /declared\.indexOf\(name\) !== -1/);
  assert.match(marketplaceHost, /ETB\.api\.deleteExpert\(name\)/);
  assert.match(marketplaceHost, /ETB\.api\.getExpert\(name,\s*\{\s*global:\s*true\s*\}\)/);
  assert.match(marketplaceHost, /Expert still exists after delete/);
  assert.match(marketplaceHost, /ETB\.registry\.install\(pluginId\)/);
  assert.match(marketplaceHost, /type:\s*'etb_uninstall_result'/);
});

test('one-time ownership migration prevents the Capability Studio Expert from being orphaned', () => {
  const registrySource = fs.readFileSync(
    path.join(toolbarRoot, 'src', 'core', 'registry.js'),
    'utf8',
  );
  function storage(initial) {
    const values = new Map(Object.entries(initial || {}));
    return {
      getItem(key) {
        return values.has(key) ? values.get(key) : null;
      },
      setItem(key, value) {
        values.set(key, String(value));
      },
      removeItem(key) {
        values.delete(key);
      },
      values,
    };
  }

  const upgraded = storage({
    etb_plugins_installed_v1: JSON.stringify(['profit-growth-scenario']),
  });
  const upgradedContext = {
    ETB: {},
    BUILTIN_PLUGINS: [],
    localStorage: upgraded,
    console,
  };
  vm.runInNewContext(registrySource, upgradedContext);
  assert.deepEqual(
    JSON.parse(upgraded.getItem('etb_plugins_installed_v1')).sort(),
    ['capability-studio-scenario', 'profit-growth-scenario'],
  );
  assert.equal(
    upgraded.getItem('etb_evolution_studio_ownership_migration_v1'),
    'done',
  );

  const fresh = storage({
    etb_evolution_studio_ownership_migration_v1: 'done',
    etb_plugins_installed_v1: JSON.stringify(['profit-growth-scenario']),
  });
  vm.runInNewContext(registrySource, {
    ETB: {},
    BUILTIN_PLUGINS: [],
    localStorage: fresh,
    console,
  });
  assert.deepEqual(
    JSON.parse(fresh.getItem('etb_plugins_installed_v1')),
    ['profit-growth-scenario'],
    'fresh post-split Evolution Console installs must not auto-install Studio',
  );
});

test('device sync recovers Capability Studio ownership after a cleared local cache', async () => {
  const registrySource = fs.readFileSync(
    path.join(toolbarRoot, 'src', 'core', 'registry.js'),
    'utf8',
  );
  const values = new Map();
  const localStorage = {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
  const legacyManifest = {
    id: 'profit-growth-scenario',
    owned_experts: true,
    experts: ['xtl_capability_studio_profitability_v1'],
    expert_defs: [{
      name: 'xtl_capability_studio_profitability_v1',
    }],
    ui: { type: 'html', html: '<p>legacy device cache</p>' },
  };
  const context = {
    ETB: {
      api: {
        saveExpert() {
          return Promise.resolve({ status: 'success' });
        },
        runExpert() {
          return Promise.resolve({
            result: JSON.stringify({ m: [legacyManifest], t: [] }),
          });
        },
      },
      router: { evict() {} },
    },
    BUILTIN_PLUGINS: [
      { id: 'profit-growth-scenario' },
      { id: 'capability-studio-scenario' },
    ],
    localStorage,
    console,
    Promise,
  };
  vm.runInNewContext(registrySource, context);
  assert.equal(
    localStorage.getItem('etb_evolution_studio_ownership_migration_v1'),
    'done',
    'bootstrap marker is written before asynchronous device sync',
  );

  await context.ETB.registry.syncFromDevice('', '');
  assert.deepEqual(
    JSON.parse(localStorage.getItem('etb_plugins_installed_v1')).sort(),
    ['capability-studio-scenario', 'profit-growth-scenario'],
  );
});
