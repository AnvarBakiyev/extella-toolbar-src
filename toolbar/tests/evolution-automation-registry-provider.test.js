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
      if (key === '_mkt_automations') {
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
      if (key === '_mkt_installed') {
        return Promise.resolve({
          value: JSON.stringify({
            items: [{ kind: 'service', id: 'extella_1c_agent' }],
          }),
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
    'extella.evolution.automation-registry-sources.v1',
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

  const catalogRead = calls.find(
    (call) => call.method === 'kvGet' &&
      call.key === '_mkt_automations',
  );
  const composerRead = calls.find(
    (call) => call.method === 'kvGet' &&
      call.key === '_mkt_installed',
  );
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

test('schedule KV is read only with an explicit scope and missing scope stays visible', async () => {
  const calls = [];
  const provider = loadProvider();
  const api = successfulApi(calls, {
    kvGet(key) {
      if (key === '_mkt_automations') {
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
      if (key === '_mkt_installed') {
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

  const scheduleReads = calls.filter(
    (call) => call.method === 'kvGet' &&
      call.key.indexOf('_mkt_') !== 0,
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
