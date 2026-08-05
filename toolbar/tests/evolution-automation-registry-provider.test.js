'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const toolbarRoot = path.resolve(__dirname, '..');
const providerPath = path.join(
  toolbarRoot,
  'src',
  'core',
  'evolution-automation-registry-provider.js',
);
const providerSource = fs.readFileSync(providerPath, 'utf8');

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadProvider(options = {}) {
  const context = {
    ETB: {
      registry: options.registry,
    },
    console,
  };
  if (options.window) context.window = options.window;
  vm.runInNewContext(providerSource, context, { filename: providerPath });
  return context.ETB.evolutionAutomationRegistryProvider;
}

function memoryStorage(value) {
  const calls = [];
  return {
    calls,
    getItem(key) {
      calls.push({ method: 'getItem', key });
      return value;
    },
    setItem() {
      calls.push({ method: 'setItem' });
      throw new Error('provider must never write localStorage');
    },
    removeItem() {
      calls.push({ method: 'removeItem' });
      throw new Error('provider must never write localStorage');
    },
  };
}

function successfulApi(calls, overrides = {}) {
  return {
    kvGet(key, scope) {
      calls.push({ method: 'kvGet', key, scope: plain(scope) });
      if (overrides.kvGet) return overrides.kvGet(key, scope);
      if (key === 'extella:automations:v2') {
        return Promise.resolve({
          value: JSON.stringify({
            items: [{
              id: 'extella_1c_agent',
              installed: false,
              version: '0.2.0-beta.1',
            }],
          }),
        });
      }
      if (key === 'extella:installed:v2') {
        return Promise.resolve({
          value: JSON.stringify({
            items: [{ kind: 'service', id: 'extella_1c_agent' }],
          }),
        });
      }
      if (key.startsWith('agent_state:')) {
        return Promise.resolve({
          value: JSON.stringify({ status: 'active' }),
        });
      }
      if (key.startsWith('agent_runs:')) {
        return Promise.resolve({
          value: JSON.stringify({
            runs: [{ ts: 1785100000000, ok: true, note: 'not projected' }],
          }),
        });
      }
      if (key === 'sched:__index__') {
        return Promise.resolve({
          value: JSON.stringify({ sids: ['wz_20260709_travel'] }),
        });
      }
      return Promise.resolve({ value: JSON.stringify(true) });
    },
    agentsList() {
      calls.push({ method: 'agentsList' });
      return Promise.resolve({
        status: 'success',
        agents: [{
          id: 'agent_live',
          name: 'Live Agent',
          provider: 'alibaba',
          model: 'qwen',
          instructions: 'must not enter registry evidence',
        }],
      });
    },
    expertsListScoped(scope) {
      calls.push({
        method: 'expertsListScoped',
        scope: plain(scope),
      });
      return Promise.resolve({
        status: 'success',
        results: [{
          expert_name: 'wz_1c',
          expert_description: '1C orchestrator',
          code: 'must not enter registry evidence',
        }],
      });
    },
  };
}

test('provider reads every source with exact scopes and performs no writes', async () => {
  const calls = [];
  const scanCalls = [];
  const storage = memoryStorage(JSON.stringify([
    'extella_1c_agent',
    'orphan_browser_id',
    'extella_1c_agent',
  ]));
  const provider = loadProvider();
  const snapshot = await provider.load({
    api: successfulApi(calls),
    storage,
    deviceId: 'device-current-exact',
    now: '2026-07-26T20:00:00.000Z',
    schedulerScopeAgentId: 'agent_scheduler_exact',
    scheduleSources: [{
      automationId: 'extella_travel_agency',
      key: 'sched:wz_20260709_travel',
      agentId: 'agent_wizard_exact',
    }],
    scanDeviceCards(deviceId) {
      scanCalls.push(deviceId);
      return Promise.resolve({
        entries: [{
          filename: 'extella_1c_agent.json',
          manifest: {
            id: 'extella_1c_agent',
            version: '0.3.0-dev.6',
            experts: ['wz_1c'],
          },
        }],
        backupFilesIgnored: 102,
        invalidFilesIgnored: 0,
      });
    },
  });

  assert.equal(
    snapshot.schemaVersion,
    'extella.evolution.automation-registry-sources.v3',
  );
  assert.equal(snapshot.collectedAt, '2026-07-26T20:00:00.000Z');
  assert.equal(snapshot.complete, true);
  assert.deepEqual(scanCalls, ['device-current-exact']);
  assert.deepEqual(storage.calls, [{
    method: 'getItem',
    key: 'etb_plugins_installed_v1',
  }]);
  assert.deepEqual(
    plain(snapshot.browserInstalledIds),
    ['extella_1c_agent', 'orphan_browser_id'],
  );
  assert.deepEqual(plain(snapshot.automationStateFacts), [{
    available: true,
    present: true,
    automationId: 'extella_1c_agent',
    key: 'agent_state:extella_1c_agent',
    scope: {},
    value: { enabled: true, status: 'active' },
    errors: [],
  }]);
  assert.deepEqual(
    plain(snapshot.automationRunFacts[0].value),
    {
      latest: { ts: 1785100000000, ok: true },
      count: 1,
    },
  );
  assert.deepEqual(plain(snapshot.schedulerIndexSids), [
    'wz_20260709_travel',
  ]);
  assert.deepEqual(plain(snapshot.platformAgentRows), [{
    id: 'agent_live',
    name: 'Live Agent',
    provider: 'alibaba',
    model: 'qwen',
  }]);
  assert.deepEqual(plain(snapshot.platformExpertRows), [{
    name: 'wz_1c',
    description: '1C orchestrator',
  }]);
  assert.equal(snapshot.sources.deviceCards.backupFilesIgnored, 102);
  assert.deepEqual(
    plain(snapshot.deviceCardRows.map((row) => row.filename)),
    ['extella_1c_agent.json'],
  );
  assert.deepEqual(plain(snapshot.deviceInventory.counts), {
    discovered: 1,
    business_automations: 1,
    system_surfaces: 0,
    unclassified: 0,
  });
  assert.equal(snapshot.deviceInventory.classification_complete, true);

  const catalogRead = calls.find(
    (call) => call.method === 'kvGet' &&
      call.key === 'extella:automations:v2',
  );
  const composerRead = calls.find(
    (call) => call.method === 'kvGet' &&
      call.key === 'extella:installed:v2',
  );
  // Регресс 28.07.2026: общие реестры читаются по СВОБОДНЫМ именам обычным общим чтением.
  // Старые имена отравлены близнецами и отдавали 0 записей при 12 целых; закрепление агента
  // лечило это, но упиралось в запрет платного Claude. Свежее имя снимает конфликт целиком —
  // никакого agentId здесь быть не должно.
  assert.deepEqual(catalogRead.scope, {
    global: true,
  });
  assert.deepEqual(composerRead.scope, {
    global: true,
  });
  assert.deepEqual(
    calls.find((call) => call.method === 'expertsListScoped').scope,
    {
      global: true,
    },
  );
  assert.deepEqual(
    calls.find(
      (call) => call.method === 'kvGet' &&
        call.key === 'sched:wz_20260709_travel',
    ).scope,
    {
      global: false,
      agentId: 'agent_wizard_exact',
    },
  );
  assert.deepEqual(
    calls.find(
      (call) => call.method === 'kvGet' &&
        call.key === 'agent_state:extella_1c_agent',
    ).scope,
    {},
  );
  assert.deepEqual(
    calls.find(
      (call) => call.method === 'kvGet' &&
        call.key === 'agent_runs:extella_1c_agent',
    ).scope,
    {},
  );
  assert.deepEqual(
    calls.find(
      (call) => call.method === 'kvGet' &&
        call.key === 'sched:__index__',
    ).scope,
    {
      agentId: 'agent_scheduler_exact',
    },
  );
});

test('device inventory classifies canonical evidence and never grows the reviewed migration list', () => {
  const provider = loadProvider();
  const inventory = plain(provider.deviceCardInventory({
    available: true,
    cards: [{
      manifest: {
        id: 'new_passported_product',
        name: 'New passported product',
        automation: { automation_id: 'new_passported_product' },
      },
    }, {
      manifest: {
        id: 'new_process_product',
        category: 'automations',
        type: 'process',
      },
    }, {
      manifest: {
        id: 'new_snake_schema_product',
        schema_version: 'extella-process-pack-v1',
      },
    }, {
      manifest: { id: 'extella_anon', system: true },
    }, {
      manifest: {
        id: 'extella_recruiter',
        category: 'work',
        type: 'custom',
      },
    }, {
      manifest: {
        id: 'mismatched_passport',
        automation: { automation_id: 'another_product' },
      },
    }],
  }));

  assert.deepEqual(inventory.counts, {
    discovered: 6,
    business_automations: 3,
    system_surfaces: 1,
    unclassified: 2,
  });
  assert.equal(inventory.classification_complete, false);
  assert.deepEqual(
    inventory.rows.map((row) => [row.id, row.kind, row.evidence]),
    [
      ['new_passported_product', 'BUSINESS_AUTOMATION', 'AUTOMATION_PASSPORT'],
      ['new_process_product', 'BUSINESS_AUTOMATION', 'PROCESS_MANIFEST'],
      ['new_snake_schema_product', 'BUSINESS_AUTOMATION', 'PROCESS_MANIFEST'],
      ['extella_anon', 'SYSTEM_SURFACE', 'SYSTEM_MARKER'],
      ['extella_recruiter', 'UNCLASSIFIED', 'CLASSIFICATION_MISSING'],
      ['mismatched_passport', 'UNCLASSIFIED', 'CLASSIFICATION_MISSING'],
    ],
  );
});

test('malformed run history fails closed instead of selecting an older success', async () => {
  const calls = [];
  const api = successfulApi(calls);
  const defaultKvGet = api.kvGet;
  api.kvGet = function (key, scope) {
    if (key === 'agent_runs:extella_1c_agent') {
      calls.push({ method: 'kvGet', key, scope: plain(scope) });
      return Promise.resolve({
        value: JSON.stringify({
          runs: [
            { ts: 'not-a-time', ok: false },
            { ts: '2026-07-27T09:15:00.000Z', ok: true },
          ],
        }),
      });
    }
    return defaultKvGet(key, scope);
  };
  const provider = loadProvider();
  const snapshot = await provider.load({
    api,
    storage: memoryStorage('[]'),
    deviceId: 'device-current-exact',
    now: '2026-07-27T10:00:00.000Z',
    schedulerScopeAgentId: 'agent_scheduler_exact',
    scanDeviceCards() {
      return Promise.resolve({
        entries: [{
          filename: 'extella_1c_agent.json',
          manifest: {
            id: 'extella_1c_agent',
            category: 'automations',
            type: 'process',
            version: '0.3.0-dev.6',
          },
        }],
        backupFilesIgnored: 102,
        invalidFilesIgnored: 0,
      });
    },
  });
  const fact = snapshot.automationRunFacts[0];

  assert.equal(snapshot.sources.automationRuns.available, false);
  assert.equal(fact.available, false);
  assert.equal(fact.present, false);
  assert.equal(fact.value, null);
  assert.ok(fact.errors.some(
    (error) => error.code === 'AUTOMATION_RUNS_UNAVAILABLE',
  ));
});

test('strict device validation admits only top-level <id>.json with stem equal to manifest.id', () => {
  const provider = loadProvider();
  const result = plain(provider.normalizeDeviceScan({
    entries: [
      {
        filename: 'extella_1c_agent.json',
        manifest: { id: 'extella_1c_agent', version: '0.3.0-dev.6' },
      },
      {
        filename: 'extella_1c_agent.json.bak_20260726',
        manifest: { id: 'extella_1c_agent' },
      },
      {
        filename: 'nested/extella_contract_agent.json',
        manifest: { id: 'extella_contract_agent' },
      },
      {
        filename: 'extella_travel_agency.json',
        manifest: { id: 'another_id' },
      },
      {
        filename: 'bad name.json',
        manifest: { id: 'bad name' },
      },
      {
        filename: 'Uppercase_ID.json',
        manifest: { id: 'Uppercase_ID' },
      },
      {
        filename: 'extella_1c_agent.json',
        manifest: { id: 'extella_1c_agent' },
      },
      {
        manifest: { id: 'missing_filename' },
      },
    ],
  }));

  assert.deepEqual(result.cards, [{
    filename: 'extella_1c_agent.json',
    manifest: { id: 'extella_1c_agent', version: '0.3.0-dev.6' },
    runtime: null,
  }]);
  assert.equal(result.backupFilesIgnored, 1);
  assert.equal(result.invalidFilesIgnored, 6);
  assert.deepEqual(
    result.errors.map((error) => error.code).sort(),
    [
      'DEVICE_CARD_FILENAME_INVALID',
      'DEVICE_CARD_FILENAME_REQUIRED',
      'DEVICE_CARD_FILENAME_REQUIRED',
      'DEVICE_CARD_FILENAME_INVALID',
      'DEVICE_CARD_ID_FILENAME_MISMATCH',
      'DUPLICATE_DEVICE_CARD_ID',
    ].sort(),
  );
  result.errors.forEach((error) => {
    assert.ok(error.message_ru);
    assert.ok(error.message_en);
  });
});

test('device runtime evidence is whitelisted before it reaches the projection', () => {
  const provider = loadProvider();
  const result = plain(provider.normalizeDeviceScan({
    entries: [{
      filename: 'extella_travel_agency.json',
      manifest: {
        id: 'extella_travel_agency',
        version: '1.0.0',
      },
      runtime: {
        configured: true,
        port: 8766,
        secret: 'must not pass',
        health: {
          available: true,
          responded: true,
          status_code: 200,
          value: { ok: true, token: 'must not pass' },
        },
        state: {
          available: true,
          responded: true,
          status_code: 200,
          value: {
            enabled: true,
            active_version: '1.0.0',
            last_run: null,
            last_result: null,
            last_error: null,
            schedules: [{
              id: 'campaigns_birthday',
              active: false,
              next_run: null,
              location: 'external_cron',
              secret: 'must not pass',
            }],
            checked_at: '2026-07-27T00:00:00Z',
            token: 'must not pass',
          },
        },
      },
    }],
  }));

  assert.equal(result.cards[0].runtime.state.available, true);
  assert.equal(
    result.cards[0].runtime.state.value.schedules[0].next_run,
    null,
  );
  assert.doesNotMatch(JSON.stringify(result.cards[0].runtime), /secret|token/);
});

test('a browser cache cannot make DEVICE_CARDS green when the scanner is unavailable', async () => {
  const calls = [];
  const provider = loadProvider();
  const snapshot = await provider.load({
    api: successfulApi(calls),
    storage: memoryStorage(JSON.stringify(['extella_1c_agent'])),
    deviceId: 'device-current-exact',
    now: '2026-07-26T20:00:00.000Z',
  });

  assert.equal(snapshot.complete, false);
  assert.equal(snapshot.sources.browserInstalled.available, true);
  assert.equal(snapshot.sources.deviceCards.available, false);
  assert.deepEqual(plain(snapshot.deviceCardRows), []);
  assert.ok(snapshot.errors.some(
    (error) => error.code === 'DEVICE_SCANNER_UNAVAILABLE',
  ));
});

test('scanner rejection count keeps the source snapshot explicitly incomplete', async () => {
  const calls = [];
  const provider = loadProvider();
  const snapshot = await provider.load({
    api: successfulApi(calls),
    storage: memoryStorage('[]'),
    deviceId: 'device-current-exact',
    now: '2026-07-26T20:00:00.000Z',
    scanDeviceCards() {
      return Promise.resolve({
        entries: [{
          filename: 'extella_1c_agent.json',
          manifest: {
            id: 'extella_1c_agent',
            version: '0.3.0-dev.6',
          },
        }],
        invalidFilesIgnored: 1,
      });
    },
  });

  assert.equal(snapshot.sources.deviceCards.available, true);
  assert.equal(snapshot.sources.deviceCards.invalidFilesIgnored, 1);
  assert.equal(snapshot.complete, false);
  assert.ok(snapshot.errors.some(
    (error) => error.code === 'DEVICE_CARD_FILES_REJECTED',
  ));
});

test('default scanner receives the current desktop target once and never falls back', async () => {
  const calls = [];
  const scanCalls = [];
  const provider = loadProvider({
    registry: {
      scanDeviceManifests(deviceId) {
        scanCalls.push(deviceId);
        return Promise.resolve({
          entries: [{
            filename: 'extella_contract_agent.json',
            manifest: { id: 'extella_contract_agent', version: '0.1.0' },
          }],
        });
      },
    },
    window: {
      extellaDesktop: {
        getDeviceID() {
          return 'desktop-device-current';
        },
      },
    },
  });
  const snapshot = await provider.load({
    api: successfulApi(calls),
    storage: memoryStorage('[]'),
    now: '2026-07-26T20:00:00.000Z',
  });

  assert.equal(snapshot.sources.deviceCards.available, true);
  assert.deepEqual(scanCalls, ['desktop-device-current']);
});

test('an explicit failed host device lookup never falls back to a different target', async () => {
  const calls = [];
  const scanCalls = [];
  const provider = loadProvider({
    registry: {
      scanDeviceManifests(deviceId) {
        scanCalls.push(deviceId);
        return Promise.resolve({ entries: [] });
      },
    },
    window: {
      extellaDesktop: {
        getDeviceID() {
          return 'different-untrusted-device';
        },
      },
    },
  });
  const snapshot = await provider.load({
    api: successfulApi(calls),
    storage: memoryStorage('[]'),
    deviceId: '',
    deviceIdError: 'host could not prove the current device',
    now: '2026-07-26T20:00:00.000Z',
  });

  assert.equal(snapshot.sources.deviceCards.available, false);
  assert.deepEqual(scanCalls, []);
  assert.ok(snapshot.sources.deviceCards.errors.some(
    (error) => error.code === 'DEVICE_CARDS_UNAVAILABLE' &&
      error.detail === 'host could not prove the current device',
  ));
});

test('schedule KV is read only with an explicit scope and missing scope stays visible', async () => {
  const calls = [];
  const provider = loadProvider();
  const api = successfulApi(calls, {
    kvGet(key) {
      if (key === 'extella:automations:v2') {
        return Promise.resolve({
          value: JSON.stringify({
            items: [{
              id: 'extella_travel_agency',
              components: {
                schedules: [{
                  active_key: 'sched:travel:active',
                  agent_id: 'agent_travel_exact',
                }, {
                  active_key: 'ta:inbound:enabled',
                }],
              },
            }],
          }),
        });
      }
      if (key === 'extella:installed:v2') {
        return Promise.resolve({ value: '{"items":[]}' });
      }
      return Promise.resolve({ value: 'true' });
    },
  });
  const snapshot = await provider.load({
    api,
    storage: memoryStorage('[]'),
    deviceId: 'device-current',
    now: '2026-07-26T20:00:00.000Z',
    scanDeviceCards() {
      return Promise.resolve({ entries: [] });
    },
  });

  // Отбираем чтения расписаний ПО СУЩЕСТВУ, а не «всё, что не витрина»: после переноса
  // реестров в свободные имена (28.07) исключение по префиксу _mkt_ перестало их отсекать.
  const scheduleReads = calls.filter(
    (call) => call.method === 'kvGet' && call.key.indexOf('sched:') === 0,
  );
  assert.deepEqual(scheduleReads, [{
    method: 'kvGet',
    key: 'sched:travel:active',
    scope: { global: false, agentId: 'agent_travel_exact' },
  }]);
  assert.equal(snapshot.sources.schedules.available, false);
  assert.equal(snapshot.scheduleFacts.length, 2);
  assert.ok(snapshot.errors.some(
    (error) => error.code === 'SCHEDULE_SCOPE_REQUIRED',
  ));
});

test('scheduler index locator is exact, ignores lookalike copies, and never falls back global', async () => {
  const calls = [];
  const provider = loadProvider();
  const api = successfulApi(calls);
  api.agentsList = () => Promise.resolve({
    status: 'success',
    agents: [{
      id: 'agent_scheduler_namespace',
      name: 'Extella (Claude)',
      provider: 'anthropic',
      model: 'claude-sonnet',
    }, {
      id: 'agent_scheduler_copy',
      name: 'Extella (Claude) — Copy',
      provider: 'anthropic',
      model: 'claude-sonnet',
    }],
  });
  const snapshot = await provider.load({
    api,
    storage: memoryStorage('[]'),
    deviceId: 'device-current',
    scanDeviceCards() {
      return Promise.resolve({ entries: [] });
    },
  });

  assert.equal(snapshot.sources.schedulerIndex.available, true);
  assert.deepEqual(plain(snapshot.sources.schedulerIndex.scope), {
    agentId: 'agent_scheduler_namespace',
  });
  const reads = calls.filter(
    (call) => call.method === 'kvGet' &&
      call.key === 'sched:__index__',
  );
  assert.equal(reads.length, 1);
  assert.equal(Object.hasOwn(reads[0].scope, 'global'), false);
});

test('valid empty scheduler index proves absence while missing or invalid index stays unavailable', async () => {
  const provider = loadProvider();
  const base = {
    storage: memoryStorage('[]'),
    deviceId: 'device-current',
    schedulerScopeAgentId: 'agent_scheduler_exact',
    scanDeviceCards() {
      return Promise.resolve({ entries: [] });
    },
  };
  const emptyCalls = [];
  const empty = await provider.load({
    ...base,
    api: successfulApi(emptyCalls, {
      kvGet(key) {
        if (key === 'extella:automations:v2' || key === 'extella:installed:v2') {
          return Promise.resolve({ value: '{"items":[]}' });
        }
        if (key === 'sched:__index__') {
          return Promise.resolve({ value: '{"sids":[]}' });
        }
        return Promise.resolve({ value: '{}' });
      },
    }),
  });
  assert.equal(empty.sources.schedulerIndex.available, true);
  assert.deepEqual(plain(empty.schedulerIndexSids), []);

  const invalidCalls = [];
  const invalid = await provider.load({
    ...base,
    api: successfulApi(invalidCalls, {
      kvGet(key) {
        if (key === 'extella:automations:v2' || key === 'extella:installed:v2') {
          return Promise.resolve({ value: '{"items":[]}' });
        }
        if (key === 'sched:__index__') {
          return Promise.resolve({ value: '{"wrong":[]}' });
        }
        return Promise.resolve({ value: '{}' });
      },
    }),
  });
  assert.equal(invalid.sources.schedulerIndex.available, false);
  assert.deepEqual(plain(invalid.schedulerIndexSids), []);
  assert.ok(invalid.errors.some(
    (error) => error.code === 'SCHEDULER_INDEX_UNAVAILABLE',
  ));
});

test('account context changes reject the whole read instead of returning a partial snapshot', async () => {
  const calls = [];
  const pending = [];
  let valid = true;
  const provider = loadProvider();
  const api = successfulApi(calls, {
    kvGet() {
      return new Promise((resolve) => pending.push(resolve));
    },
  });
  const load = provider.load({
    api,
    storage: memoryStorage('[]'),
    deviceId: 'device-current',
    scanDeviceCards() {
      return new Promise((resolve) => pending.push(resolve));
    },
    assertContext() {
      if (!valid) {
        const error = new Error('account context changed');
        error.code = 'ACCOUNT_SESSION_CHANGED';
        throw error;
      }
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  valid = false;
  pending.forEach((resolve, index) => {
    resolve(index < 2 ? { value: '{"items":[]}' } : { entries: [] });
  });
  await assert.rejects(load, (error) => {
    assert.equal(error.code, 'ACCOUNT_SESSION_CHANGED');
    return true;
  });
});

test('provider source remains ES5-compatible and contains no write API', () => {
  assert.doesNotMatch(providerSource, /\b(?:const|let|class)\b|=>|\?\./);
  assert.doesNotMatch(
    providerSource,
    /\.(?:kvSet|saveExpert|addCustom|install|uninstall|removeCustom)\s*\(/,
  );
  assert.doesNotMatch(
    providerSource,
    /localStorage\.(?:setItem|removeItem|clear)\s*\(/,
  );
});
