'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const toolbarRoot = path.resolve(__dirname, '..');
const source = fs.readFileSync(
  path.join(
    toolbarRoot,
    'src',
    'core',
    'evolution-automation-inventory.js',
  ),
  'utf8',
);

function inventory() {
  const context = { ETB: {}, Date };
  vm.runInNewContext(source, context, {
    filename: 'evolution-automation-inventory.js',
  });
  return context.ETB.evolutionAutomationInventory;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const checkedAt = '2026-07-26T21:30:00.000Z';

test('normalizes installed 1C, Kazakh Lawyer and Travel application agents', () => {
  const manifests = [
    {
      id: 'extella_1c_agent',
      name: 'Агент 1С',
      category: 'analytics',
      type: 'custom',
      version: '0.3.0-dev.6',
      standalone: true,
      experts: ['wz_1c'],
      optionalExperts: ['one_c'],
      service: {
        isApp: true,
        port: 8792,
        healthPath: '/api/health',
      },
      conceptTexts: ['private content must not be copied'],
    },
    {
      id: 'extella_contract_agent',
      name: 'Kazakh Lawyer',
      category: 'automations',
      type: 'process',
      version: '1.0.0',
      experts: ['p2d4_run_pipeline'],
      channels: { email: 'smtp details', whatsapp: 'token details' },
      synthAgent: {
        id: 'agent_lawyer',
        name: 'Internal Qwen',
        api_key: 'must-not-leak',
      },
      knowledgeBase: { name: 'Гражданский кодекс РК' },
      service: { isApp: true, port: 8767, healthPath: '/x/status' },
    },
    {
      id: 'extella_travel_agency',
      name: 'Travel Agency',
      category: 'automations',
      type: 'process',
      version: '0.1.0',
      experts: ['ta_run_lead_pipeline'],
      orchestrator: 'ta_run_lead_pipeline',
      schedule: {
        kvKey: 'sched:wz_travel',
        mechanism: 'wz_scheduler_tick',
      },
      params: { agent_id: 'agent_travel' },
      service: { isApp: true, port: 8766, healthPath: '/x/status' },
    },
    {
      id: 'ordinary_toolbar_plugin',
      name: 'Not a business automation',
      category: 'business',
      type: 'application',
    },
  ];
  const services = [
    {
      id: 'extella_1c_agent',
      status: 'running',
      desired: 'on',
      canStart: false,
      canStop: true,
    },
    {
      id: 'extella_contract_agent',
      status: 'running',
      desired: 'on',
      canStart: false,
      canStop: true,
    },
    {
      id: 'extella_travel_agency',
      status: 'running',
      desired: 'on',
      canStart: false,
      canStop: true,
    },
  ];

  const result = plain(inventory().normalize(manifests, services, {
    checkedAt,
    complete: true,
    evidence: [{ source: 'DEVICE_REGISTRY', checkedAt }],
  }));

  assert.equal(result.schema, 'extella.evolution.automation_inventory.v1');
  assert.equal(result.scope, 'CURRENT_DEVICE');
  assert.deepEqual(result.rows.map((row) => row.id).sort(), [
    'extella_1c_agent',
    'extella_contract_agent',
    'extella_travel_agency',
  ]);
  assert.deepEqual(result.counters, {
    total: 3,
    running: 3,
    stopped: 0,
    unknown: 0,
    withWarnings: 3,
  });
  assert.equal(
    result.rows.find((row) => row.id === 'extella_1c_agent')
      .components.experts.length,
    2,
  );
  assert.equal(
    result.rows.find((row) => row.id === 'extella_contract_agent')
      .components.integrations.length,
    2,
  );
  assert.equal(
    result.rows.find((row) => row.id === 'extella_travel_agency')
      .components.schedules.length,
    1,
  );
  assert.doesNotMatch(JSON.stringify(result), /private content|must-not-leak|smtp details|token details/);
});

test('running is not treated as health evidence and actions require exact booleans', () => {
  const result = plain(inventory().normalize([{
    id: 'extella_1c_agent',
    name: 'Агент 1С',
    standalone: true,
    service: { isApp: true },
  }], [{
    id: 'extella_1c_agent',
    status: 'running',
    desired: 'on',
    canStart: false,
    canStop: true,
  }], { checkedAt }));
  const row = result.rows[0];
  assert.equal(row.runtime.status, 'RUNNING');
  assert.equal(row.runtime.health, 'UNKNOWN');
  assert.deepEqual(row.actions, {
    start: 'UNAVAILABLE',
    stop: 'AVAILABLE',
    update: 'UNAVAILABLE',
    rollback: 'UNAVAILABLE',
  });
  assert.ok(row.warnings.some((warning) => warning.code === 'HEALTH_UNKNOWN'));
});

test('missing Activity Center remains unknown and makes projection incomplete', () => {
  const result = plain(inventory().normalize([{
    id: 'extella_contract_agent',
    name: 'Kazakh Lawyer',
    category: 'automations',
    type: 'process',
    version: '1.0.0',
  }], null, {
    checkedAt,
    complete: false,
    sourceErrors: [{
      source: 'ACTIVITY_CENTER',
      code: 'ACTIVITY_CENTER_SERVICES_UNAVAILABLE',
    }],
  }));
  assert.equal(result.complete, false);
  assert.equal(result.rows[0].runtime.status, 'UNKNOWN');
  assert.equal(result.rows[0].runtime.health, 'UNKNOWN');
  assert.equal(result.rows[0].actions.start, 'UNAVAILABLE');
  assert.ok(result.rows[0].warnings.some(
    (warning) => warning.code === 'ACTIVITY_CENTER_UNAVAILABLE',
  ));
});

test('duplicate automation ids fail closed and are excluded from rows', () => {
  const result = plain(inventory().normalize([
    {
      id: 'duplicate_agent',
      name: 'First',
      category: 'automations',
      type: 'process',
    },
    {
      id: 'duplicate_agent',
      name: 'Second',
      category: 'automations',
      type: 'process',
    },
  ], [], { checkedAt }));
  assert.equal(result.complete, false);
  assert.deepEqual(result.rows, []);
  assert.equal(result.warnings[0].code, 'DUPLICATE_AUTOMATION_ID');
});

test('only explicit platform agent bindings are emitted and never verified by inference', () => {
  const result = plain(inventory().normalize([{
    id: 'extella_travel_agency',
    name: 'Travel',
    category: 'automations',
    type: 'process',
    params: { agent_id: 'agent_exact' },
    description: 'Agent agent_guessed must not become a binding',
  }], [], { checkedAt }));
  assert.deepEqual(result.rows[0].components.platformAgents, [{
    id: 'agent_exact',
    name: null,
    role: null,
    source: 'manifest.params.agent_id',
    verified: false,
  }]);
});
