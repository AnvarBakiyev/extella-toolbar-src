'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const toolbarRoot = path.resolve(__dirname, '..');
const router = fs.readFileSync(
  path.join(toolbarRoot, 'src', 'core', 'router.js'),
  'utf8',
);
const registry = fs.readFileSync(
  path.join(toolbarRoot, 'src', 'core', 'registry.js'),
  'utf8',
);

function loadMapper() {
  const start = router.indexOf(
    '  function _evolutionAutomationSourceName(source)',
  );
  const end = router.indexOf(
    '  function _evolutionAutomationRegistryLoad(context)',
    start,
  );
  assert.ok(start >= 0 && end > start, 'registry source mapper must exist');
  const context = {
    _evolutionError(code, message) {
      return Object.assign(new Error(message), { code });
    },
  };
  vm.runInNewContext(
    `${router.slice(start, end)}
this.mapProjection = _evolutionAutomationProjectionInput;`,
    context,
  );
  return context.mapProjection;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('router maps the provider snapshot into the exact pure projection input', () => {
  const mapProjection = loadMapper();
  const result = plain(mapProjection({
    schemaVersion: 'extella.evolution.automation-registry-sources.v3',
    collectedAt: '2026-07-26T20:00:00.000Z',
    complete: false,
    deviceInventory: {
      schema: 'extella.evolution.device_inventory.v1',
      available: false,
      classification_complete: false,
      counts: {
        discovered: null,
        business_automations: null,
        system_surfaces: null,
        unclassified: null,
      },
      rows: [],
    },
    sources: {
      catalog: { available: false, errors: [{}] },
      composerInstalled: { available: true, errors: [] },
      browserInstalled: { available: true, errors: [] },
      platformAgents: { available: true, errors: [] },
      platformExperts: { available: true, errors: [] },
      schedules: { available: true, errors: [] },
      automationStates: { available: true, errors: [] },
      automationRuns: { available: true, errors: [] },
      schedulerIndex: { available: true, errors: [] },
      deviceCards: { available: false, errors: [{}] },
    },
    catalogItems: [{ id: 'extella_1c_agent' }],
    deviceCardRows: [{
      filename: 'extella_1c_agent.json',
      manifest: { id: 'extella_1c_agent' },
    }],
    platformAgentRows: [{ id: 'agent_live' }],
    platformExpertRows: [{ name: 'wz_1c' }],
    browserInstalledIds: ['extella_1c_agent'],
    composerInstalledItems: [{
      id: 'extella_1c_agent',
      status: 'installed',
    }],
    scheduleFacts: [{
      available: true,
      descriptor: { automationId: 'extella_1c_agent' },
      value: true,
    }, {
      available: true,
      descriptor: { automationId: 'extella_travel_agency' },
      value: { paused: true },
    }, {
      available: false,
      descriptor: { automationId: 'ignored_failed_schedule' },
      value: true,
    }],
    runtimeStateRows: [{
      automationId: 'extella_1c_agent',
      runtime: {
        configured: true,
        state: { available: false, responded: true },
      },
    }],
    automationStateFacts: [{
      automationId: 'extella_1c_agent',
      available: true,
      present: true,
      value: { enabled: true, status: 'active' },
    }],
    automationRunFacts: [{
      automationId: 'extella_1c_agent',
      available: true,
      present: true,
      value: { latest: { ts: 1785100000000, ok: true }, count: 1 },
    }],
    schedulerIndexSids: ['wz_20260709_travel'],
    errors: [{
      source: '_mkt_automations',
      code: 'GLOBAL_KV_SOURCE_UNAVAILABLE',
      detail: 'must not enter the projection',
    }, {
      source: 'DEVICE_CARDS',
      code: 'DEVICE_SCANNER_UNAVAILABLE',
    }, {
      source: 'UNREVIEWED_SOURCE',
      code: 'UNREVIEWED_CODE',
    }],
  }));

  assert.deepEqual(result.catalogRecords, [{ id: 'extella_1c_agent' }]);
  assert.deepEqual(result.deviceRecords, [{
    filename: 'extella_1c_agent.json',
    manifest: { id: 'extella_1c_agent' },
  }]);
  assert.deepEqual(result.platformAgents, [{ id: 'agent_live' }]);
  assert.deepEqual(result.experts, [{ name: 'wz_1c' }]);
  assert.deepEqual(result.localInstalledIds, ['extella_1c_agent']);
  assert.deepEqual(result.composerInstalledRecords, [{
    id: 'extella_1c_agent',
    status: 'installed',
  }]);
  assert.deepEqual(result.scheduleStates, [{
    automation_id: 'extella_1c_agent',
    active: true,
  }, {
    automation_id: 'extella_travel_agency',
    active: false,
  }]);
  assert.deepEqual(result.runtimeStates, [{
    automation_id: 'extella_1c_agent',
    runtime: {
      configured: true,
      state: { available: false, responded: true },
    },
  }]);
  assert.deepEqual(result.automationStates, [{
    automation_id: 'extella_1c_agent',
    available: true,
    present: true,
    value: { enabled: true, status: 'active' },
  }]);
  assert.deepEqual(result.automationRuns, [{
    automation_id: 'extella_1c_agent',
    available: true,
    present: true,
    value: { latest: { ts: 1785100000000, ok: true }, count: 1 },
  }]);
  assert.deepEqual(result.schedulerIndexSids, ['wz_20260709_travel']);
  assert.deepEqual(result.sourceErrors, [{
    source: 'catalog',
    code: 'GLOBAL_KV_SOURCE_UNAVAILABLE',
  }, {
    source: 'device',
    code: 'DEVICE_SCANNER_UNAVAILABLE',
  }, {
    source: 'UNKNOWN',
    code: 'UNREVIEWED_CODE',
  }]);
  assert.deepEqual(result.sourceAvailability, {
    catalog: false,
    device: false,
    platform_agents: true,
    experts: true,
    schedules: true,
    runtime_state: false,
    automation_state: true,
    automation_runs: true,
    scheduler_index: true,
    local_installed: true,
    composer_installed: true,
  });
  assert.equal(result.sourceSnapshotComplete, false);
  assert.equal(result.includeReviewedAutomations, true);
  assert.equal(result.checkedAt, '2026-07-26T20:00:00.000Z');
  assert.doesNotMatch(JSON.stringify(result), /must not enter/);
});

test('provider contract rejects silent empty snapshots', () => {
  const mapProjection = loadMapper();
  assert.throws(
    () => mapProjection({}),
    (error) => {
      assert.equal(error.code, 'AUTOMATION_REGISTRY_SOURCE_CONTRACT_INVALID');
      return true;
    },
  );
});

test('provider contract rejects a contradictory complete source snapshot', () => {
  const mapProjection = loadMapper();
  assert.throws(
    () => mapProjection({
      schemaVersion: 'extella.evolution.automation-registry-sources.v3',
      collectedAt: '2026-07-26T20:00:00.000Z',
      complete: true,
      deviceInventory: {
        schema: 'extella.evolution.device_inventory.v1',
        available: true,
        classification_complete: true,
        counts: {
          discovered: 0,
          business_automations: 0,
          system_surfaces: 0,
          unclassified: 0,
        },
        rows: [],
      },
      sources: {
        catalog: { available: false, errors: [] },
        composerInstalled: { available: true, errors: [] },
        browserInstalled: { available: true, errors: [] },
        platformAgents: { available: true, errors: [] },
        platformExperts: { available: true, errors: [] },
        schedules: { available: true, errors: [] },
        automationStates: { available: true, errors: [] },
        automationRuns: { available: true, errors: [] },
        schedulerIndex: { available: true, errors: [] },
        deviceCards: { available: true, errors: [] },
      },
      catalogItems: [],
      deviceCardRows: [],
      platformAgentRows: [],
      platformExpertRows: [],
      scheduleFacts: [],
      runtimeStateRows: [],
      automationStateFacts: [],
      automationRunFacts: [],
      schedulerIndexSids: [],
      browserInstalledIds: [],
      composerInstalledItems: [],
      errors: [],
    }),
    (error) => {
      assert.equal(error.code, 'AUTOMATION_REGISTRY_SOURCE_CONTRACT_INVALID');
      return true;
    },
  );
});

test('registry load is account-fenced and does not invoke legacy mutation paths', () => {
  const start = router.indexOf(
    '  function _evolutionAutomationRegistryLoad(context)',
  );
  const end = router.indexOf(
    '  function _evolutionRequireSession(',
    start,
  );
  assert.ok(start >= 0 && end > start);
  const source = router.slice(start, end);
  assert.match(source, /assertContext:\s*function \(\) \{/);
  assert.match(source, /_agentControlAssertContext\(context\)/);
  assert.match(
    source,
    /projector\.project\(\s*_evolutionAutomationProjectionInput\(sources\)\s*\)/,
  );
  assert.doesNotMatch(source, /_evolutionFleetLoad\(context\)/);
  assert.match(
    source,
    /registry:\s*registry,\s*inventory:\s*sources\.deviceInventory,\s*legacy:\s*null/,
  );
  assert.match(source, /ADVANCED_EVOLUTION_NOT_LOADED/);
  assert.match(
    router,
    /if \(action === 'automation_registry_load'\) \{\s*return _evolutionAutomationRegistryLoad\(context\);/,
  );
});

test('current-device scanner performs no provisioning, deletion, or cache mutation', () => {
  const start = registry.indexOf('    scanDeviceManifests: function (deviceId)');
  const end = registry.indexOf('    syncFromDevice: function', start);
  assert.ok(start >= 0 && end > start);
  const source = registry.slice(start, end);
  assert.match(source, /_etb_evolution_registry_scan_v1/);
  assert.match(source, /ETB\.api\.runExpert\(fnName,\s*\{\},\s*\{/);
  assert.match(source, /target:\s*exactDeviceId/);
  assert.match(source, /global:\s*true/);
  assert.doesNotMatch(
    source,
    /saveExpert|deleteExpert|addCustom|localStorage|os\.remove|unlink|rmtree/,
  );
  assert.doesNotMatch(
    source,
    /runExpert\(fnName,[\s\S]*?\.catch\([\s\S]*?runExpert\(fnName/,
    'the exact current-device target must have no untargeted fallback',
  );
});
