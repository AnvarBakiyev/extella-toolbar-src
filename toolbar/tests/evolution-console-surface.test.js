'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');

const toolbarRoot = path.resolve(__dirname, '..');
const scenarioRoot = path.join(toolbarRoot, 'plugins', 'scenarios');
const evolutionManifestPath = path.join(scenarioRoot, 'profit-growth.json');
const evolutionHtmlPath = path.join(scenarioRoot, 'evolution-console.html');
const evolutionScannerPath = path.join(
  scenarioRoot,
  'evolution-registry-scanner.py',
);
const studioManifestPath = path.join(scenarioRoot, 'capability-studio.json');
const studioHtmlPath = path.join(scenarioRoot, 'profit-growth.html');
const routerPath = path.join(toolbarRoot, 'src', 'core', 'router.js');
const pluginsManagerPath = path.join(toolbarRoot, 'public', 'plugins_manager.html');

const evolutionManifest = JSON.parse(
  fs.readFileSync(evolutionManifestPath, 'utf8'),
);
const evolutionHtml = fs.readFileSync(evolutionHtmlPath, 'utf8');
const evolutionScanner = fs.readFileSync(evolutionScannerPath, 'utf8');
const studioManifest = JSON.parse(
  fs.readFileSync(studioManifestPath, 'utf8'),
);
const studioHtml = fs.readFileSync(studioHtmlPath, 'utf8');
const router = fs.readFileSync(routerPath, 'utf8');
const pluginsManager = fs.readFileSync(pluginsManagerPath, 'utf8');

function regexEscape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function inlineScripts(html) {
  return [...html.matchAll(
    /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi,
  )].map((match) => match[1]);
}

test('Evolution Console manifest keeps exact product naming and a read-only surface contract', () => {
  assert.equal(evolutionManifest.id, 'profit-growth-scenario');
  assert.equal(evolutionManifest.name, 'Evolution Console');
  assert.equal(
    evolutionManifest.tagline,
    'Ваши автоматизации — просто и честно',
  );
  assert.equal(
    evolutionManifest.description,
    'Evolution Console показывает, что работает, что остановлено и где нужна помощь. Каталог отделён от установленных автоматизаций, а неизвестное состояние не подменяется успехом.',
  );
  assert.equal(evolutionManifest.version, '0.10.0');
  assert.deepEqual(evolutionManifest.pills, [
    'Автоматизации',
    'Состояние',
    'Evolution Lab',
  ]);
  assert.equal(evolutionManifest.trust_tier, 'verified');
  assert.equal(evolutionManifest.ui.type, 'html');
  assert.equal(evolutionManifest.ui.htmlFile, 'evolution-console.html');
  assert.equal(evolutionManifest.ui.tokenless, true);
  assert.equal(evolutionManifest.ui.expectsHealth, true);
  assert.equal(evolutionManifest.owned_experts, true);
  assert.deepEqual(evolutionManifest.experts, [
    '_etb_evolution_registry_scan_v1',
  ]);
  assert.equal(evolutionManifest.expert_defs.length, 1);
  assert.equal(
    evolutionManifest.expert_defs[0].name,
    '_etb_evolution_registry_scan_v1',
  );
  assert.equal(
    evolutionManifest.expert_defs[0].codeFile,
    'evolution-registry-scanner.py',
  );
  assert.equal(evolutionManifest.expert_defs[0].global, true);
  assert.equal(
    evolutionManifest.expert_defs[0].sourceSha256,
    crypto.createHash('sha256').update(evolutionScanner).digest('hex'),
  );
  assert.ok(
    evolutionManifest.capabilities.every(
      (capability) => capability.external_writes === false,
    ),
  );
  assert.deepEqual(
    evolutionManifest.capabilities.map((capability) => capability.id).sort(),
    [
      'agent_change_management',
      'agent_passport_risks',
      'automation_registry',
      'data_protection_posture',
      'evolution_lab',
      'evolution_loop',
      'mcp_read_inventory',
      'shared_genes_map',
    ],
  );
  assert.equal(
    evolutionManifest.capabilities.find(
      (capability) => capability.id === 'automation_registry',
    ).expert_name,
    '_etb_evolution_registry_scan_v1',
  );
  assert.match(evolutionScanner, /<id>\.json|strict|fullmatch/);
  assert.doesNotMatch(
    evolutionScanner,
    /\bos\.(?:remove|unlink|rmdir)\b|\bshutil\.rmtree\b|open\([^)]*,\s*["'](?:w|a|x)/,
  );
  assert.equal(
    evolutionManifest.capabilities.find(
      (capability) => capability.id === 'automation_registry',
    ).version,
    'EVOLUTION_AUTOMATION_REGISTRY_V2',
  );
  assert.equal(
    evolutionManifest.capabilities.find(
      (capability) => capability.id === 'mcp_read_inventory',
    ).version,
    'EVOLUTION_MCP_READ_CONTRACT_V1_1',
  );
  assert.equal(
    evolutionManifest.capabilities.find(
      (capability) => capability.id === 'agent_change_management',
    ).version,
    'EVOLUTION_AGENT_CONTROL_SURFACE_V1',
  );

  const completeSurface = `${JSON.stringify(evolutionManifest)}\n${evolutionHtml}`;
  for (const canonicalName of [
    'Extella Evolution',
    'Evolution Console',
    'Agent Passport',
    'Agent Genome',
    'Shared Gene',
    'Agent Cabinet',
    'Evolution Lab',
    'Evolution Loop',
    'Evolution Receipt',
  ]) {
    assert.match(
      completeSurface,
      new RegExp(regexEscape(canonicalName)),
      `${canonicalName} must use the mandatory naming dictionary`,
    );
  }
  assert.doesNotMatch(completeSurface, /Центр управления агентами/);
  assert.match(evolutionHtml, /catalogUnknown:'Каталог недоступен'/);
  assert.match(
    evolutionHtml,
    /installationUnknown:'Установка не подтверждена'/,
  );
  assert.match(evolutionHtml, /catalogUnknown:'Catalog unavailable'/);
  assert.match(
    evolutionHtml,
    /installationUnknown:'Installation not confirmed'/,
  );
});

test('Evolution Console HTML has valid inline scripts and unique document IDs', () => {
  assert.match(
    evolutionHtml,
    /<title>Extella Evolution · Evolution Console<\/title>/,
  );
  assert.doesNotMatch(evolutionHtml, /<script\b[^>]*\bsrc\s*=/i);
  const scripts = inlineScripts(evolutionHtml);
  assert.ok(scripts.length >= 2, 'reviewed inline scripts must be present');
  scripts.forEach((script, index) => {
    const syntax = spawnSync(process.execPath, ['--check', '-'], {
      input: script,
      encoding: 'utf8',
    });
    assert.equal(
      syntax.status,
      0,
      `inline script ${index + 1} is invalid:\n${syntax.stderr}`,
    );
  });

  const ids = [...evolutionHtml.matchAll(/\sid="([^"]+)"/g)]
    .map((match) => match[1]);
  assert.ok(ids.length > 20, 'surface must expose its reviewed structural IDs');
  assert.equal(new Set(ids).size, ids.length, 'all document IDs must be unique');
  for (const viewId of [
    'fleetView',
    'risksView',
    'genesView',
    'escalationsView',
    'bulkView',
    'receiptsView',
  ]) {
    assert.match(evolutionHtml, new RegExp(`id="${viewId}"`));
  }
});

test('Evolution Console uses only the approved brand palette and never uses Petrol for actions', () => {
  const approvedColors = new Set([
    'C57E33', 'D4984F', 'A5632A', 'D4944A', 'E0A85E',
    '2F6B66', '3D8078', '24544F', 'B7CEC9', '5FA8A0', '6BB3AA',
    '0A0A0A', '1A1A1A', '2A2A2A', 'F0F0F0', 'D8D8D8', 'B0B0B0',
    '8C8C8C', 'AAAAAA', 'FAFAF8', 'F5F3EE', 'EBE8E1', 'D4B896',
    '0E0E0E', '181818', '222222', '000000',
    '1F7A4D', '57B37E', 'A63A2E', 'E8705F',
  ]);
  const usedColors = [...evolutionHtml.matchAll(/#([0-9a-f]{6})\b/gi)]
    .map((match) => match[1].toUpperCase());
  assert.ok(usedColors.length > 0);
  assert.deepEqual(
    [...new Set(usedColors.filter((color) => !approvedColors.has(color)))],
    [],
  );
  assert.doesNotMatch(evolutionHtml, /#C49C70/i);
  assert.match(
    evolutionHtml,
    /--warn:#E0A85E;--bad:#E8705F;--good:#57B37E/,
  );
  assert.match(
    evolutionHtml,
    /--warn:#A5632A;--bad:#A63A2E;--good:#1F7A4D/,
  );
  assert.match(evolutionHtml, /\.primary\{background:var\(--gold\)/);
  assert.match(evolutionHtml, /\.btn\.gold,.gold\{background:var\(--gold\)/);
  assert.doesNotMatch(
    evolutionHtml,
    /\.(?:primary|btn\.gold)[^{]*\{[^}]*var\(--petrol\)/,
  );
  assert.match(evolutionHtml, /\.tab\.on\{[^}]*color:var\(--petrol\)/);
  assert.match(evolutionHtml, /\.step\.on\{[^}]*color:var\(--petrol\)/);
});

test('Evolution Console status meaning is explicit without relying on color', () => {
  assert.match(
    evolutionHtml,
    /\.state\{[^}]*background:var\(--panel2\)/,
  );
  assert.match(
    evolutionHtml,
    /function statusMark\(kind\)\{return kind==='good'\?'✓':kind==='bad'\?'✕':'⚠';\}/,
  );
  assert.match(
    evolutionHtml,
    /if\(status==='WORKING'\)return \{status:status,kind:'good',mark:'✓',label:t\('automationWorking'\)\}/,
  );
  assert.match(
    evolutionHtml,
    /if\(status==='STATE_UNAVAILABLE'\)return \{status:status,kind:'warn',mark:'⚠',label:t\('automationStateUnavailable'\)\}/,
  );
  assert.match(
    evolutionHtml,
    /if\(status==='NOT_RUNNING'\)return \{status:status,kind:'warn',mark:'○',label:t\('automationNotRunning'\)\}/,
  );
  assert.match(
    evolutionHtml,
    /ready\?'✓ PRODUCTION READY · ':'⚠ PRODUCTION BLOCKED · '/,
  );
  assert.match(
    evolutionHtml,
    /var phase=i<n\?'COMPLETE':i===n\?'CURRENT':'PENDING',mark=i<n\?'✓':i===n\?'→':'○'/,
  );
  assert.match(evolutionHtml, /<small>'\+phase\+'<\/small>/);
});

test('Evolution Console tokenless iframe and host use one exact fenced bridge contract', () => {
  const requestType = evolutionHtml.match(
    /postMessage\(Object\.assign\(\{type:'([^']+)',reqId:id,action:action\}/,
  );
  const resultType = evolutionHtml.match(
    /if\(d\.type==='([^']+_result)'\)/,
  );
  assert.ok(requestType, 'iframe request message type must be explicit');
  assert.ok(resultType, 'iframe result message type must be explicit');
  assert.equal(resultType[1], `${requestType[1]}_result`);

  const requestStart = evolutionHtml.indexOf('    function request(action,payload)');
  const requestEnd = evolutionHtml.indexOf('    function demoProjection()', requestStart);
  assert.ok(requestStart >= 0 && requestEnd > requestStart);
  const requestSource = evolutionHtml.slice(requestStart, requestEnd);
  assert.doesNotMatch(requestSource, /\btoken\b/i);
  assert.match(evolutionHtml, /if\(event\.source!==window\.parent\)return/);
  assert.match(
    evolutionHtml,
    /type:'etb_ui_health',ok:true,pluginId:'profit-growth-scenario'/,
  );

  assert.match(
    router,
    new RegExp(`e\\.data\\.type === '${regexEscape(requestType[1])}'`),
    'host must listen for the exact iframe request type',
  );
  assert.match(
    router,
    new RegExp(`type:\\s*'${regexEscape(resultType[1])}'`),
    'host must reply with the exact iframe result type',
  );
  assert.match(router, /var src\w* = _srcIframe\(e\);\s*if \(!src\w*\) return;/);
  assert.match(router, /if \(!_isBuiltinEvolutionConsole\(\)\)/);
  assert.match(router, /plugin === canonical/);
  assert.match(router, /ui\.tokenless === true/);
  assert.match(
    router,
    /if \(_isBuiltinEvolutionConsole\(\)\) \{[\s\S]*?'sandbox',\s*'allow-scripts allow-downloads'/,
    'the opaque Evolution iframe may download reviewed CSV and Agent Passport drafts',
  );
  assert.doesNotMatch(
    router,
    /sandbox['"],\s*['"][^'"]*allow-same-origin/,
  );
  assert.match(router, /if \(!ui\.tokenless\) initPayload\.token = token/);
});

test('Evolution Console CSV export neutralizes spreadsheet formulas and quotes cells', () => {
  const cellFunction = evolutionHtml.match(
    /function cell\(v\)\{([\s\S]*?)\}body=keys\.join/,
  );
  assert.ok(cellFunction, 'CSV cell encoder must be present');
  const context = {};
  vm.runInNewContext(
    `function cell(v){${cellFunction[1]}}\nthis.cell = cell;`,
    context,
  );

  assert.equal(context.cell('safe'), '"safe"');
  assert.equal(context.cell('a"b'), '"a""b"');
  assert.equal(context.cell('=2+2'), '"\'=2+2"');
  assert.equal(context.cell('+cmd'), '"\'+cmd"');
  assert.equal(context.cell('-10'), '"\'-10"');
  assert.equal(context.cell('@SUM(A1:A2)'), '"\'@SUM(A1:A2)"');
});

test('automation registry surface exposes no automation state-changing action', () => {
  assert.match(
    evolutionHtml,
    /Реестр только читает источники и вычисляет расхождения/,
  );
  assert.match(
    evolutionHtml,
    /The registry only reads sources and computes discrepancies/,
  );
  assert.doesNotMatch(evolutionHtml, /data-automation-action=/);
  assert.doesNotMatch(
    router,
    /action === 'automation_(?:enable|disable|update|rollback|delete|install)'/,
  );
  assert.match(router, /action === 'automation_registry_load'/);
});

test('data protection is a read-only per-agent posture in Console and settings stay in Agent Cabinet', () => {
  assert.equal(
    evolutionManifest.capabilities.find(
      (capability) => capability.id === 'data_protection_posture',
    ).version,
    'EVOLUTION_MASKING_POSTURE_V1',
  );
  assert.match(evolutionHtml, /id="countProtectedAgents"/);
  assert.match(
    evolutionHtml,
    /protectedAgents:'с подтверждёнными PRE \+ POST'/,
  );
  assert.match(
    evolutionHtml,
    /protectedAgents:'with verified PRE \+ POST'/,
  );
  assert.match(evolutionHtml, /dataProtection:'Защита данных'/);
  assert.match(evolutionHtml, /dataProtection:'Data protection'/);
  assert.match(
    evolutionHtml,
    /maskingSettingsCabinet:'Настройки находятся в Agent Cabinet\.'/,
  );
  assert.match(
    evolutionHtml,
    /maskingSettingsCabinet:'Settings are in Agent Cabinet\.'/,
  );
  assert.match(evolutionHtml, /data-masking-posture=/);
  assert.match(evolutionHtml, /function maskingAutomationAgentIds\(\)/);
  assert.match(
    evolutionHtml,
    /automationFlags\(row\)\.installed===true/,
    'the N/M denominator must come from installed business automations',
  );
  assert.match(evolutionHtml, /function maskingCoverageText\(\)/);
  assert.match(
    evolutionHtml,
    /String\(snapshot\.availability\|\|''\)\.toUpperCase\(\)!=='AVAILABLE'/,
    'an unavailable local source must render an unknown N/M numerator',
  );
  assert.match(
    evolutionHtml,
    /ids\.some\(function\(id\)\{return !rows\.some\(function\(row\)\{return String\(row&&row\.agent_id\|\|''\)===id;\}\);\}\)\)return'—\/'\+total/,
    'a composed automation agent missing from the posture snapshot must keep N unknown',
  );
  assert.match(
    evolutionHtml,
    /capturedAt<now-5\*60\*1000\|\|capturedAt>now\+60\*1000/,
    'stale or implausibly future posture must never stay green in the UI',
  );
  for (const cabinetOnlyField of [
    'names_mode',
    'field_hints',
    'reveal_policy',
    'share_key_cross_device',
  ]) {
    assert.doesNotMatch(
      evolutionHtml,
      new RegExp(regexEscape(cabinetOnlyField)),
      `${cabinetOnlyField} must not create a second Agent Cabinet form`,
    );
  }
  assert.doesNotMatch(evolutionHtml, /vault\.key|vault_key|encrypted_mapping/);

  const postureStart = router.indexOf(
    '  function _evolutionMaskingPostureLoad(',
  );
  const postureEnd = router.indexOf(
    '  function _evolutionLastReceipt(',
    postureStart,
  );
  assert.ok(postureStart >= 0 && postureEnd > postureStart);
  const postureRouter = router.slice(postureStart, postureEnd);
  assert.match(postureRouter, /loadMaskingPostures/);
  assert.match(postureRouter, /device_only: true/);
  assert.match(postureRouter, /profile_id: 'default'/);
  assert.match(postureRouter, /unavailableSnapshot/);
  assert.match(postureRouter, /now: new Date\(\)\.toISOString\(\)/);
  assert.doesNotMatch(
    postureRouter,
    /kvGet|kvSet|localStorage|vault\.key|mapping|raw_audit|\btoken\b/i,
  );
  assert.match(router, /action === 'masking_posture_load'/);
  assert.match(
    pluginsManager,
    /'profit-growth-scenario': \{[^}\n]*name:'Evolution Console'/,
  );
  assert.doesNotMatch(
    pluginsManager,
    /'profit-growth-scenario': \{[^}\n]*name:'Консоль агентов'/,
  );
});

test('Agent change management is an internal read-only Evolution Console view', () => {
  const advancedStart = evolutionHtml.indexOf('id="advancedNav"');
  const advancedEnd = evolutionHtml.indexOf('</details>', advancedStart);
  const advancedNav = evolutionHtml.slice(advancedStart, advancedEnd);
  const viewStart = evolutionHtml.indexOf('id="agentControlView"');
  const viewEnd = evolutionHtml.indexOf('</main>', viewStart);
  const view = evolutionHtml.slice(viewStart, viewEnd);
  const loaderStart = evolutionHtml.indexOf('    function validAgentControlSurface(');
  const loaderEnd = evolutionHtml.indexOf('    function clearLegacyFleet(', loaderStart);
  const loader = evolutionHtml.slice(loaderStart, loaderEnd);
  const routerStart = router.indexOf('  function _evolutionAgentControlLoad(');
  const routerEnd = router.indexOf('  function _evolutionLastReceipt(', routerStart);
  const routerSlice = router.slice(routerStart, routerEnd);

  assert.match(advancedNav, /data-view="agentControl"/);
  assert.doesNotMatch(advancedNav, /data-primary-surface/);
  assert.match(view, /data-evolution-view="agent-control"/);
  assert.match(view, /id="agentControlRefreshBtn"/);
  assert.match(view, /id="agentControlOperations"/);
  assert.match(view, /id="agentControlGates"/);
  assert.match(view, /id="agentControlLimits"/);
  assert.doesNotMatch(view, /agent_control_publish|data-agent-control-action/);
  assert.doesNotMatch(evolutionHtml, /etb_agent_control/);
  assert.match(evolutionHtml, /agentControlBoundary:'Этот раздел только читает канонический контракт/);
  assert.match(evolutionHtml, /agentControlBoundary:'This section only reads the canonical contract/);
  assert.match(evolutionHtml, /agentControlRequires:'Зависит от'/);
  assert.match(evolutionHtml, /agentControlRequires:'Requires'/);
  assert.match(loader, /request\('agent_control_load'/);
  assert.match(
    loader,
    /status==='STANDARDS_UNAVAILABLE'\|\|status==='UNKNOWN'\)return count===null/,
  );
  assert.match(loader, /status==='NO_AGENT_PASSPORTS'\)return count===0/);
  assert.match(loader, /surface\.mutations_allowed!==false/);
  assert.match(loader, /var operationNames=\{\};contract\.operations\.forEach/);
  assert.match(loader, /operationNames\[code\]\|\|code/);
  assert.doesNotMatch(loader, /status=\+esc\(surface\.status\)|ledger=/);
  assert.match(routerSlice, /session\.standardsBundle\.sources/);
  assert.match(routerSlice, /mutations_allowed: false/);
  assert.doesNotMatch(
    routerSlice,
    /kvGet|kvSet|_agentControlWrite|_agentControlAction|etb_agent_control|agent_control_publish/,
  );
});

test('B4 automation state is three-valued, factual, localized, and fail-closed', () => {
  for (const status of ['WORKING', 'STATE_UNAVAILABLE', 'NOT_RUNNING']) {
    assert.match(
      evolutionHtml,
      new RegExp(`'${status}'`),
      `${status} must remain an explicit machine-readable state`,
    );
  }
  for (const copy of [
    "automationWorking:'Работает'",
    "automationStateUnavailable:'Не удалось проверить состояние'",
    "automationNotRunning:'Не запущена'",
    "automationWorking:'Working'",
    "automationStateUnavailable:'Couldn’t check status'",
    "automationNotRunning:'Not running'",
  ]) {
    assert.match(evolutionHtml, new RegExp(regexEscape(copy)));
  }
  assert.match(
    evolutionHtml,
    /function automationOperationalStatus\(row\)[\s\S]{0,320}\['WORKING','STATE_UNAVAILABLE','NOT_RUNNING'\]/,
  );
  assert.match(evolutionHtml, /data-automation-state=/);
  for (const field of [
    'active_version',
    'last_run',
    'last_result',
    'last_error',
  ]) {
    assert.match(
      evolutionHtml,
      new RegExp(`data-state-field="${field}"`),
      `${field} must be rendered as an explicit state fact`,
    );
  }
  assert.match(
    evolutionHtml,
    /function unknownFact\(v\)\{return v==null\|\|v===''[\s\S]{0,80}UNKNOWN/,
  );
  assert.match(
    evolutionHtml,
    /function factText\(v\)\{return unknownFact\(v\)\?t\('unknown'\):String\(v\);\}/,
  );
  assert.match(
    evolutionHtml,
    /error\[WLANG==='en'\?'message_en':'message_ru'\]/,
    'last_error must select the service-provided localized message',
  );
  assert.match(
    evolutionHtml,
    /esc\(factText\(message\)\)[\s\S]{0,100}<small class="mono">'\+esc\(code\)\+'<\/small>/,
    'the localized service message stays primary while its exact error code remains reachable',
  );
  assert.match(evolutionHtml, /row&&row\.action_gates/);
  assert.match(
    evolutionHtml,
    /\['enable_disable',t\('actionEnableDisable'\)\],\['update',t\('actionUpdate'\)\],\['rollback',t\('actionRollback'\)\]/,
  );
  assert.match(evolutionHtml, /data-action-gate=/);
  const actionGateStart = evolutionHtml.indexOf(
    'function renderAutomationActionGates(row)',
  );
  const actionGateEnd = evolutionHtml.indexOf(
    'function mcpName(row)',
    actionGateStart,
  );
  assert.ok(actionGateStart >= 0 && actionGateEnd > actionGateStart);
  const actionGateRenderer = evolutionHtml.slice(
    actionGateStart,
    actionGateEnd,
  );
  assert.match(actionGateRenderer, /actionGateMessage\(gate,status\)/);
  assert.doesNotMatch(
    actionGateRenderer,
    /<button\b|\bdisabled\b/,
    'read-only evidence must not expose unusable automation buttons',
  );
  assert.match(
    evolutionHtml,
    /view\.status==='STATE_UNAVAILABLE'\|\|view\.status==='UNKNOWN'/,
  );
  assert.doesNotMatch(evolutionHtml, /data-automation-action=/);
});

test('B4 schedule status separates operation from reference integrity', () => {
  assert.match(
    evolutionHtml,
    /operational_status:'NO_SCHEDULE',reference_status:'MISSING'/,
    'preview must exercise the live Travel no-schedule plus dead-reference case',
  );
  assert.match(evolutionHtml, /scheduleNone:'Расписания нет'/);
  assert.match(evolutionHtml, /scheduleNone:'No schedule'/);
  assert.match(
    evolutionHtml,
    /if\(status==='NO_SCHEDULE'\)return \{status:status,kind:'',mark:'○',label:t\('scheduleNone'\)\}/,
    'NO_SCHEDULE must stay neutral rather than masquerading as working or error',
  );
  assert.match(
    evolutionHtml,
    /if\(status==='MISSING'\)return \{status:status,kind:'bad',mark:'✕',label:t\('scheduleMissingHuman'\)\}/,
  );
  assert.match(evolutionHtml, /scheduleMissingHuman:'Расписание не найдено\.'/);
  assert.match(evolutionHtml, /scheduleMissingHuman:'Schedule could not be found\.'/);
  assert.match(evolutionHtml, /data-schedule-operational=/);
  assert.match(evolutionHtml, /data-schedule-reference=/);
  assert.match(
    evolutionHtml,
    /<details class="technical-details"><summary>'\+esc\(t\('technicalEvidence'\)\)\+'<\/summary>/,
    'raw schedule enums remain reachable only after progressive disclosure',
  );
  assert.match(evolutionHtml, /item\.operational_status\|\|item\.operationalStatus/);
  assert.match(evolutionHtml, /item\.reference_status\|\|item\.referenceStatus/);
});

test('B4 keeps an unknown dead-reference fact unknown in UI and exports', () => {
  assert.match(
    evolutionHtml,
    /dead_reference:triFlag\(flags\.dead_reference\)/,
  );
  assert.match(
    evolutionHtml,
    /f==='dead'&&flags\.dead_reference!==true/,
  );
  assert.match(
    evolutionHtml,
    /flags\.dead_reference==='UNKNOWN'/,
  );
  assert.match(
    evolutionHtml,
    /<details class="technical-details" data-technical-details="collapsed">/,
    'unknown integrity evidence must remain available without leaking into the closed card summary',
  );
});

test('B4 schedule bulk flow rechecks automation state before every dependent step', () => {
  assert.match(evolutionHtml, /function scheduleAutomationStateGate\(\)/);
  assert.match(
    evolutionHtml,
    /state\.automationRegistry\.rows\.filter\(function\(row\)\{return automationFlags\(row\)\.installed===true;\}\)/,
  );
  assert.match(
    evolutionHtml,
    /allowed:rows\.length>0&&unavailable\.length===0/,
  );
  assert.match(
    evolutionHtml,
    /scheduleAdapterAvailable\(\)&&scheduleAutomationStateGate\(\)\.allowed/,
  );
  assert.match(
    evolutionHtml,
    /scheduleOperation&&!scheduleStateGate\.allowed\?t\('scheduleStateRequired'\)/,
  );
  assert.match(
    evolutionHtml,
    /if\(\(type==='schedule_pause'\|\|type==='schedule_resume'\)&&!scheduleAutomationStateGate\(\)\.allowed\)\{showError\(t\('scheduleStateRequired'\)\);return;\}/,
  );
  assert.match(
    evolutionHtml,
    /if\(bulkOperationRequiresAutomationState\(state\.bulk\)&&!scheduleAutomationStateGate\(\)\.allowed\)throw new Error\(t\('scheduleStateRequired'\)\)/,
  );
  assert.match(evolutionHtml, /data-bulk-state-gate="STATE_REQUIRED"/);
});

test('Evolution Console contains fleet context only and delegates one-agent view to Agent Cabinet', () => {
  for (const forbiddenPersonalControl of [
    'controlAgent1',
    'controlAgent2',
    'controlDraftBtn',
    'controlPlaygroundBtn',
    'controlPublishBtn',
    'PROVEN_CAPABILITIES',
    'xtl_capability_studio_profitability_v1',
    'data-studio-view=',
  ]) {
    assert.doesNotMatch(
      evolutionHtml,
      new RegExp(regexEscape(forbiddenPersonalControl)),
    );
  }
  assert.match(evolutionHtml, /openCabinet:'Открыть Agent Cabinet'/);
  assert.match(evolutionHtml, /EXTELLA_EVOLUTION_STANDARD_ARTIFACTS/);
  assert.match(
    evolutionHtml,
    /typeof window\.renderCabinet!=='function'/,
    'Console must use the generated Agent Cabinet artifact',
  );
  assert.match(evolutionHtml, /renderCabinet\(cab,'cabinetHost','passport'\)/);
});

test('Evolution Console clears every account-bound UI slice before a new init', () => {
  const resetStart = evolutionHtml.indexOf('    function resetAccountState(message)');
  const resetEnd = evolutionHtml.indexOf(
    '    document.querySelectorAll(\'.tab\')',
    resetStart,
  );
  assert.ok(resetStart >= 0 && resetEnd > resetStart);
  const resetSource = evolutionHtml.slice(resetStart, resetEnd);

  for (const clearedField of [
    'state.automationRegistry=null',
    'state.automationRegistryError=null',
    'state.actorId=null',
    'state.projection=null',
    'state.stableIdRequired=[]',
    'state.stableTargetBySource=Object.create(null)',
    'state.shared=null',
    'state.standards=null',
    'state.platform=null',
    'state.ledger=null',
    'state.escalations=[]',
    'state.bulk=null',
    'state.receipts=[]',
    'state.draft=null',
    'state.cabinetAgentId=null',
    'state.cabinetGeneId=null',
    'state.cabinetArtifactBase=null',
    'state.currentEscalationId=null',
    'state.selectedEscalationId=null',
    'state.bulkOperations=[]',
    'state.currentBulkOperationId=null',
    'state.selectedBulkOperationId=null',
    'state.selectedBulkGeneId=null',
    'state.selectedBulkIds=[]',
    'state.lastEscalationEvidence=null',
    'state.lastBulkEvidence=null',
  ]) {
    assert.match(resetSource, new RegExp(regexEscape(clearedField)));
  }
  assert.match(resetSource, /state\.pending\.clear\(\)/);
  assert.match(resetSource, /clearMaskingPostures\(\)/);
  assert.match(resetSource, /el\('cabinetHost'\)\.innerHTML=''/);
  assert.match(resetSource, /el\('cabinetOverlay'\)\.classList\.remove\('on'\)/);
  assert.match(resetSource, /window\._cab=null/);
  assert.match(resetSource, /renderAll\(\)/);
  assert.match(
    evolutionHtml,
    /if\(d\.type==='etb_init'\)\{resetAccountState\(''\)/,
  );
  assert.match(
    evolutionHtml,
    /d\.type==='etb_account_reset'\|\|d\.type==='etb_logout'\|\|d\.type==='etb_session_reset'/,
  );
});

test('Evolution Console uses exact API fields and canonical checker facts', () => {
  assert.match(evolutionHtml, /row\.automation_id\|\|''/);
  assert.match(evolutionHtml, /row\.flags&&typeof row\.flags==='object'/);
  assert.match(evolutionHtml, /flags\.installed_stale===true/);
  assert.match(evolutionHtml, /flags\.dead_reference===true/);
  assert.match(evolutionHtml, /versions\.declared\|\|row\.version_declared/);
  assert.match(evolutionHtml, /versions\.installed\|\|row\.version_installed/);
  assert.match(evolutionHtml, /installed_stale · /);
  assert.match(evolutionHtml, /dead_reference · /);
  assert.match(evolutionHtml, /e\.candidateBundleSha256\|\|e\.candidate_sha256/);
  assert.doesNotMatch(evolutionHtml, /draftSha256|draft_sha256/);
  assert.match(evolutionHtml, /r\.type\|\|'Evolution Receipt'/);
  assert.match(evolutionHtml, /r\.sha256\|\|'—'/);
  assert.doesNotMatch(evolutionHtml, /receiptSha256|\br\.kind\|\||\br\.action\|\|/);

  assert.match(evolutionHtml, /i\.severity\|\|'unknown'/);
  assert.match(evolutionHtml, /i\.path\|\|'—'/);
  assert.match(evolutionHtml, /function isInactiveRow\(r\)/);
  assert.match(evolutionHtml, /r\.activityState!=='KNOWN'/);
  assert.match(evolutionHtml, /30\*24\*60\*60\*1000/);
  assert.doesNotMatch(evolutionHtml, /activityState!=='INACTIVE'/);
  assert.match(
    evolutionHtml,
    /r\.platformPresent===true&&r\.registryPresent===false&&r\.standard\.status==='MISSING'/,
  );
  assert.match(
    evolutionHtml,
    /type:'application\/yaml;charset=utf-8'/,
    'JSON serialization is YAML 1.2-compatible and must use the YAML filename/MIME contract',
  );
  assert.match(evolutionHtml, /'agent_passport_'\+agentId\+'\.yaml'/);
});

test('Stable-ID-required passports bind only an explicit source Passport to an exact live agentId', () => {
  assert.match(evolutionHtml, /id="stableIdRequiredList"/);
  assert.match(evolutionHtml, /stableIdRequired:'Нужен стабильный ID'/);
  assert.match(evolutionHtml, /stableIdRequired:'Stable ID required'/);
  assert.match(
    evolutionHtml,
    /state\.stableIdRequired=Array\.isArray\(result\.stableIdRequired\)\?result\.stableIdRequired:\[\]/,
  );

  const stableStart = evolutionHtml.indexOf('    function stableIdLiveRows()');
  const stableEnd = evolutionHtml.indexOf(
    '    function geneConsumerVersion(',
    stableStart,
  );
  assert.ok(stableStart >= 0 && stableEnd > stableStart);
  const stableSource = evolutionHtml.slice(stableStart, stableEnd);
  assert.match(stableSource, /entry\.sourcePassport/);
  assert.match(stableSource, /entry\.sourcePath/);
  assert.match(stableSource, /entry\.name/);
  assert.match(stableSource, /entry\.passportSha256/);
  assert.match(stableSource, /entry\.checkerIssues/);
  assert.match(
    stableSource,
    /r\.platformPresent===true&&r\.registryPresent===false&&r\.standard&&r\.standard\.status==='MISSING'/,
  );
  assert.match(stableSource, /<option value="'\+esc\(row\.agentId\)/);
  assert.match(stableSource, /source&&selected\?'':'disabled'/);
  assert.match(
    stableSource,
    /downloadDraft\(agentId,source\)/,
  );
  assert.match(
    stableSource,
    /entry\.sourcePassport===source/,
  );
  assert.match(
    stableSource,
    /stableIdLiveRows\(\)\.some\(function\(row\)\{return row\.agentId===agentId;\}\)/,
  );
  assert.doesNotMatch(stableSource, /entry\.name\s*===|row\.name\s*===/);
  assert.doesNotMatch(
    stableSource,
    /(?:entry|row)\.name[^;\n]*(?:toLowerCase|localeCompare|indexOf)/,
  );

  assert.match(
    evolutionHtml,
    /async function downloadDraft\(agentId,sourcePassport\)/,
  );
  assert.match(evolutionHtml, /var payload=\{agentId:agentId\}/);
  assert.match(
    evolutionHtml,
    /if\(sourcePassport\)payload\.sourcePassport=sourcePassport/,
  );
  assert.match(
    evolutionHtml,
    /if\(action!=='fleet_load'&&action!=='automation_registry_load'&&state\.projection&&!payload\.snapshotId\)/,
    'passport draft requests must inherit the exact current snapshotId',
  );
});

test('Evolution Console follows explicit current ledger pointers, never object insertion order', () => {
  assert.match(evolutionHtml, /state\.actorId=result\.actorId\|\|null/);
  assert.match(evolutionHtml, /function cabinetActorId\(\)\{return String\(state\.actorId\|\|''\);\}/);
  assert.match(
    evolutionHtml,
    /state\.currentEscalationId=ev&&ev\.currentEscalationId\|\|null/,
  );
  assert.match(
    evolutionHtml,
    /state\.currentBulkOperationId=ev&&ev\.currentBulkOperationId\|\|null/,
  );
  assert.match(evolutionHtml, /id="escalationSelect"/);
  assert.match(evolutionHtml, /id="bulkOperationSelect"/);
  assert.doesNotMatch(evolutionHtml, /state\.escalations\[0\]/);
});

test('Shared Genes and Cabinet build an exact class escalation outside the canonical widget', () => {
  assert.match(evolutionHtml, /geneConsumerVersion\(g,id\)/);
  assert.match(evolutionHtml, /data-class-gene=/);
  assert.match(evolutionHtml, /changeAsClass:'Изменить как класс'/);
  assert.match(evolutionHtml, /renderCabinet\(cab,'cabinetHost','passport'\)/);
  assert.match(
    evolutionHtml,
    /guard\.affected_count=Math\.max\(0,\(gene\.consumerAgentIds\|\|\[\]\)\.length-1\)/,
  );
  assert.doesNotMatch(evolutionHtml, /candidate_impacts|must_show_ru=|must_show_en=/);
  assert.match(
    evolutionHtml,
    /await request\('cabinet_get',\{agentId:agentId\}\)/,
  );
  assert.match(evolutionHtml, /if\(!PREVIEW\)return null/);
  for (const cabinetStyleAlias of [
    '--silver:',
    '--sans:',
    '.btn{',
    '.btn.gold',
    '.btn.ghost',
    '.btn.sm',
  ]) {
    assert.match(
      evolutionHtml,
      new RegExp(regexEscape(cabinetStyleAlias)),
    );
  }

  for (const exactContractField of [
    'source_agent_id',
    'shared_gene_id',
    'shared_gene_map_sha256',
    'affected_agent_ids',
    'affected_count',
    'candidate_sha256',
    'candidate_bundle',
  ]) {
    assert.match(
      evolutionHtml,
      new RegExp(regexEscape(exactContractField)),
    );
  }
  assert.match(
    evolutionHtml,
    /affected_count:Math\.max\(0,affected\.length-1\)/,
  );
  assert.match(
    evolutionHtml,
    /candidate_bundle\.sharedGene\.id!==gene\.geneId/,
  );
  assert.match(
    evolutionHtml,
    /Object\.keys\(contract\.candidate_bundle\.agents\)\.sort\(\)/,
  );
  assert.match(
    evolutionHtml,
    /new CustomEvent\('extella_agent_cabinet_escalation',\{detail:contract\}\)/,
  );
});

test('Bulk preview targets only current visible canonical rows and is adapter-gated', () => {
  assert.match(evolutionHtml, /function eligibleBulkRows\(\)/);
  assert.match(evolutionHtml, /var type=el\('bulkType'\)\.value,rows=legacyVisibleRows\(\)/);
  assert.match(
    evolutionHtml,
    /ids\.some\(function\(id\)\{return allowed\.indexOf\(id\)===-1;\}\)/,
  );
  assert.match(
    evolutionHtml,
    /payload=\{operationType:type,targetIds:ids\}/,
  );
  assert.match(evolutionHtml, /payload\.sharedGeneId=gene\.geneId/);
  assert.match(evolutionHtml, /payload\.desiredVersion=version/);
  assert.match(
    evolutionHtml,
    /canonical\(allowed\.slice\(\)\.sort\(\)\)===canonical\(classIds\)/,
  );
  assert.match(
    evolutionHtml,
    /selected=isGene&&classComplete\?allowed\.slice\(\)\.sort\(\)/,
  );
  assert.match(evolutionHtml, /function bulkFormMatchesOperation\(operation\)/);
  assert.match(
    evolutionHtml,
    /payload\.desired_version===el\('bulkVersionInput'\)\.value\.trim\(\)/,
  );
  assert.doesNotMatch(evolutionHtml, /prepareEvolutionBulkSpec|payload\.spec=/);
  assert.match(evolutionHtml, /scheduleAdapterAvailable\(\)/);
  assert.match(evolutionHtml, /adapterAvailable\('scheduleStateAdapter'\)/);
  assert.match(evolutionHtml, /standardDataMode\(\)==='PRODUCTION'/);
});

test('Evolution UI never synthesizes native or Evolution Lab success and refreshes after mutations', () => {
  assert.match(
    evolutionHtml,
    /adapterAvailable\('evolutionLabAdapter'\)/,
  );
  assert.match(evolutionHtml, /classActivationAdapter/);
  assert.match(evolutionHtml, /classObservationAdapter/);
  assert.match(evolutionHtml, /classRollbackAdapter/);
  assert.match(evolutionHtml, /scheduleStateAdapter/);
  assert.match(evolutionHtml, /bulkActivationAdapter/);
  assert.match(evolutionHtml, /bulkObservationAdapter/);
  assert.match(evolutionHtml, /bulkRollbackAdapter/);
  assert.match(evolutionHtml, /nativeDurableIntent/);
  assert.match(evolutionHtml, /multiDeviceCompareAndSwap/);
  assert.doesNotMatch(
    evolutionHtml,
    /payload\.evidence|evolution_lab_evidence|evolutionLabEvidence/,
  );
  assert.match(evolutionHtml, /host-adapter Evolution Receipts/);
  assert.match(
    evolutionHtml,
    /if\(!await loadFleet\(\)\)throw new Error/,
  );
  for (const mutationPath of [
    "refreshAfterMutation('escalation',r)",
    "refreshAfterMutation('bulk',r)",
  ]) {
    assert.match(evolutionHtml, new RegExp(regexEscape(mutationPath)));
  }
});

test('Sandbox language state is memory-only and honors etb_init.lang', () => {
  assert.match(evolutionHtml, /var WLANG = 'ru'/);
  assert.doesNotMatch(evolutionHtml, /localStorage|location\.reload/);
  assert.match(
    evolutionHtml,
    /String\(d\.lang\|\|''\)\.toLowerCase\(\)\.indexOf\('en'\)===0/,
  );
  // ПЕРЕВЁРНУТО 29.07 по замечанию Эллы. Тест закреплял СВОЙ переключатель языка —
  // то есть фиксировал нарушение канона: «окно не заводит свой переключатель темы и
  // языка, тему и язык бери из etb_theme и etb_init». Локальный тумблер и давал то, что
  // она увидела: английский интерфейс при русской витрине. Теперь требуем обратного.
  assert.doesNotMatch(evolutionHtml, /id="langBtn"/,
    'у окна не должно быть своей кнопки языка — язык приходит от витрины');
  assert.doesNotMatch(evolutionHtml, /WLANG=WLANG==='ru'\?'en':'ru'/,
    'локальное переключение языка запрещено каноном');
});

test('Capability Studio remains a separate demo product and keeps the old reviewed assets', () => {
  assert.equal(studioManifest.id, 'capability-studio-scenario');
  assert.equal(studioManifest.name, 'Студия способностей');
  assert.equal(studioManifest.ui.htmlFile, 'profit-growth.html');
  assert.equal(studioManifest.ui.tokenless, true);
  assert.equal(studioManifest.owned_experts, true);
  assert.equal(
    studioManifest.expert_defs[0].name,
    'xtl_capability_studio_profitability_v1',
  );
  assert.notEqual(studioManifest.id, evolutionManifest.id);
  assert.notEqual(studioManifest.ui.htmlFile, evolutionManifest.ui.htmlFile);
  assert.match(studioHtml, /<title>Студия способностей — Extella<\/title>/);
  assert.match(
    studioHtml,
    /Отдельный демо-каталог, не часть Extella Evolution/,
  );
  assert.match(studioHtml, /data-studio-view="capabilities"/);
  assert.match(studioHtml, /data-studio-view="scenario"/);
  assert.match(studioHtml, /data-studio-view="memory"/);
  assert.match(studioHtml, /PROVEN_CAPABILITIES/);
  assert.doesNotMatch(evolutionHtml, /Студия способностей/);
});
