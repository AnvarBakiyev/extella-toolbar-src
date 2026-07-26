'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const toolbarRoot = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(
  toolbarRoot,
  'src',
  'core',
  'evolution-automation-registry.js',
), 'utf8');

function load() {
  const context = { ETB: {} };
  vm.runInNewContext(source, context, {
    filename: 'evolution-automation-registry.js',
  });
  return context.ETB.evolutionAutomationRegistry;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function device(id, manifest, extra = {}) {
  return {
    fileName: `${id}.json`,
    manifest: { id, ...manifest },
    ...extra,
  };
}

function baseInput(overrides = {}) {
  return {
    catalogRecords: [],
    deviceRecords: [],
    platformAgents: [],
    experts: [],
    scheduleStates: [],
    localInstalledIds: [],
    composerInstalledRecords: [],
    checkedAt: '2026-07-26T12:00:00.000Z',
    sourceErrors: [],
    ...overrides,
  };
}

test('SemVer 2.0 accepts dev/beta prereleases and compares without guessing', () => {
  const api = load();
  assert.ok(api.parseSemver('0.3.0-dev.6'));
  assert.ok(api.parseSemver('0.3.0-beta.1'));
  assert.ok(api.parseSemver('1.0.0+device.4'));
  assert.equal(api.parseSemver('v1.0.0'), null);
  assert.equal(api.parseSemver('1.0'), null);
  assert.equal(api.parseSemver('1.0.0-dev.01'), null);
  assert.equal(api.compareSemver('0.3.0-dev.6', '0.3.0-dev.16'), -1);
  assert.equal(api.compareSemver('1.0.0-beta.1', '1.0.0'), -1);
  assert.equal(api.compareSemver('1.0.0+one', '1.0.0+two'), 0);
});

test('missing projection input contract fails closed', () => {
  const api = load();
  const result = plain(api.project({}));
  assert.equal(result.complete, false);
  assert.deepEqual(result.rows, []);
});

test('strict device mask ignores backup-shaped evidence and fails closed', () => {
  const api = load();
  const result = plain(api.project(baseInput({
    catalogRecords: [{
      id: 'travel_like',
      name: 'Travel-like',
      version: '1.0.0',
      status: 'active',
    }],
    deviceRecords: [{
      fileName: 'travel_like.json.bak_20260726',
      manifest: {
        id: 'travel_like',
        category: 'automations',
        type: 'process',
        version: '1.0.0',
        status: 'active',
      },
    }],
    localInstalledIds: ['travel_like'],
  })));
  assert.equal(result.rows[0].flags.installed, false);
  assert.equal(result.rows[0].flags.dead_reference, true);
  assert.equal(result.rows[0].availability, 'dead_reference');
  assert.equal(result.complete, false);
});

test('canonical installed card reconciles platform agents, Experts and schedule', () => {
  const api = load();
  const result = plain(api.project(baseInput({
    catalogRecords: [{
      id: 'lawyer_like',
      name: 'Lawyer-like',
      version: '1.0.0',
      status: 'active',
    }],
    deviceRecords: [device('lawyer_like', {
      category: 'automations',
      type: 'process',
      version: '1.0.0',
      status: 'active',
      synthAgent: { id: 'agent_lawyer' },
      experts: ['lawyer_review', 'lawyer_send'],
      install: { secrets: ['must never leave the manifest'] },
    })],
    localInstalledIds: ['lawyer_like'],
    composerInstalledRecords: [{
      id: 'lawyer_like',
      status: 'installed',
      token: 'must never leave the source',
    }],
    platformAgents: [{ id: 'agent_lawyer' }],
    experts: [{ name: 'lawyer_review' }, { name: 'lawyer_send' }],
    scheduleStates: [{ automation_id: 'lawyer_like', active: false }],
  })));
  const row = result.rows[0];
  assert.equal(row.availability, 'installed');
  assert.deepEqual(row.flags, {
    catalog: true,
    catalog_valid: true,
    installed: true,
    installed_stale: false,
    dead_reference: false,
  });
  assert.equal(row.components.platform_agents[0].state, 'PRESENT');
  assert.ok(row.components.experts.every((entry) => entry.state === 'PRESENT'));
  assert.equal(row.components.schedule.state, 'PAUSED');
  assert.doesNotMatch(JSON.stringify(result), /must never leave/);
});

test('a missing optional Expert stays visible without becoming a dead reference', () => {
  const api = load();
  const result = plain(api.project(baseInput({
    catalogRecords: [{
      id: 'optional_expert_automation',
      version: '1.0.0',
      status: 'active',
    }],
    deviceRecords: [device('optional_expert_automation', {
      category: 'automations',
      type: 'process',
      version: '1.0.0',
      status: 'active',
      experts: ['required_expert'],
      optionalExperts: ['optional_expert'],
    })],
    experts: [{ name: 'required_expert' }],
  })));
  const row = result.rows[0];

  assert.equal(row.flags.dead_reference, false);
  assert.deepEqual(row.components.experts, [{
    id: 'optional_expert',
    state: 'MISSING',
    declared: true,
    orphan: false,
    required: false,
  }, {
    id: 'required_expert',
    state: 'PRESENT',
    declared: true,
    orphan: false,
  }]);
});

test('reviewed 1C migration produces declared dev version and honest stale state', () => {
  const api = load();
  const result = plain(api.project(baseInput({
    catalogRecords: [{
      id: 'extella_1c_agent',
      name: 'Агент 1С',
      version: '0.2.0-beta.1',
      status: 'beta',
    }],
    deviceRecords: [device('extella_1c_agent', {
      category: 'analytics',
      type: 'custom',
      version: '0.3.0-dev.6',
      status: null,
      experts: ['wz_1c'],
    })],
    localInstalledIds: ['extella_1c_agent'],
    experts: [{ name: 'wz_1c' }],
  })));
  const row = result.rows[0];
  assert.equal(row.versions.declared, '0.3.0-dev.16');
  assert.equal(row.versions.installed, '0.3.0-dev.6');
  assert.equal(row.statuses.installed, 'beta');
  assert.equal(row.flags.installed, true);
  assert.equal(row.flags.installed_stale, true);
  assert.equal(row.flags.dead_reference, true);
  assert.equal(row.availability, 'installed_stale');
  assert.deepEqual(row.name, { ru: 'Агент 1С', en: '1C Agent' });
  assert.equal(row.version_declared, '0.3.0-dev.16');
  assert.equal(row.version_installed, '0.3.0-dev.6');
  assert.equal(row.state.status, 'beta');
  assert.equal(row.enabled, 'UNKNOWN');
  assert.equal(row.actions.update, 'NOT_IMPLEMENTED');
  assert.ok(row.evidence.migrations.includes('classification'));
  assert.ok(row.evidence.migrations.includes('status'));
  assert.deepEqual(row.components.platform_agents[0], {
    id: 'UNKNOWN',
    state: 'MISSING',
    declared: true,
    orphan: false,
    source: 'REVIEWED_AGENT_PASSPORT_FACT',
    reviewed_at: '2026-07-26',
  });
  assert.ok(row.evidence.migrations.includes('platform_agent_reference'));
  assert.equal(row.components.services[0].port, 8792);
  assert.equal(row.components.services[0].state, 'UNKNOWN');
  assert.equal(row.components.schedules[0].interval_s, 30);
  assert.equal(row.components.integrations.length, 2);
  assert.deepEqual(row.evidence.reviewed_source, {
    repository: 'github.com/AnvarBakiyev/extella-1c-agent',
    branch: 'codex/1c-capability-contract-hardening',
    sha: 'b9cf98e',
  });
  assert.ok(row.risks.every((risk) => risk.ru && risk.en));
  assert.deepEqual(row.state, {
    source: 'UNKNOWN',
    status: 'beta',
    last_run: null,
    last_result: null,
    last_error: null,
    checked_at: '2026-07-26T12:00:00.000Z',
  });
});

test('Kazakh Lawyer and Travel Agency legacy cards use reviewed status migration', () => {
  const api = load();
  const result = plain(api.project(baseInput({
    catalogRecords: [
      {
        id: 'extella_contract_agent',
        version: '1.0.0',
        status: 'active',
      },
      {
        id: 'extella_travel_agency',
        version: '1.0.0',
        status: 'active',
      },
    ],
    deviceRecords: [
      device('extella_contract_agent', {
        category: 'automations',
        type: 'process',
        version: '1.0.0',
        status: null,
        synthAgent: { id: 'agent_contract' },
        experts: ['contract_pipeline'],
      }),
      device('extella_travel_agency', {
        category: 'automations',
        type: 'process',
        version: '1.0.0',
        status: null,
        synthAgent: { id: 'agent_travel' },
        experts: ['travel_pipeline'],
      }),
    ],
    localInstalledIds: [
      'extella_contract_agent',
      'extella_travel_agency',
    ],
    platformAgents: [{ id: 'agent_contract' }, { id: 'agent_travel' }],
    experts: [{ name: 'contract_pipeline' }, { name: 'travel_pipeline' }],
  })));
  const byId = Object.fromEntries(
    result.rows.map((row) => [row.automation_id, row]),
  );
  assert.equal(byId.extella_contract_agent.statuses.installed, 'active');
  assert.equal(byId.extella_contract_agent.availability, 'installed');
  assert.equal(byId.extella_travel_agency.statuses.installed, 'active');
  assert.equal(byId.extella_travel_agency.availability, 'installed');
  assert.equal(byId.extella_contract_agent.components.services[0].port, 8767);
  assert.equal(byId.extella_travel_agency.components.services[0].port, 8766);
  assert.equal(byId.extella_travel_agency.components.schedules.length, 2);
  assert.deepEqual(byId.extella_travel_agency.evidence.reviewed_source, {
    repository: 'github.com/AnvarBakiyev/extella-travel-agency-pack',
    branch: 'main',
    sha: '1d66267',
  });
});

test('acceptance projection keeps 12 legacy rows and adds all three real automations', () => {
  const api = load();
  const composerRows = [{
    id: 'extella_1c_agent',
    name: 'Агент 1С',
    version: '0.2.0-beta.1',
    status: 'beta',
    installed: false,
  }];
  for (let index = 1; index <= 11; index += 1) {
    composerRows.push({
      id: `composer_automation_${String(index).padStart(2, '0')}`,
      name: `Composer ${index}`,
      installed: false,
    });
  }
  const result = plain(api.project(baseInput({
    catalogRecords: composerRows,
    deviceRecords: [
      device('extella_1c_agent', {
        category: 'analytics',
        type: 'custom',
        schemaVersion: 'extella-process-pack-v1',
        version: '0.3.0-dev.6',
        status: null,
        experts: ['wz_1c'],
      }),
      device('extella_contract_agent', {
        category: 'automations',
        type: 'process',
        version: '0.1.0',
        status: null,
        synthAgent: { id: 'agent_contract_present' },
        experts: ['contract_pipeline'],
      }),
      device('extella_travel_agency', {
        category: 'automations',
        type: 'process',
        version: '0.1.0',
        status: null,
        synthAgent: { id: 'agent_travel_present' },
        experts: ['travel_pipeline'],
      }),
    ],
    localInstalledIds: [
      'extella_1c_agent',
      'extella_contract_agent',
      'extella_travel_agency',
    ],
    platformAgents: [
      { id: 'agent_contract_present' },
      { id: 'agent_travel_present' },
    ],
    experts: [
      { name: 'wz_1c' },
      { name: 'contract_pipeline' },
      { name: 'travel_pipeline' },
    ],
  })));
  const byId = Object.fromEntries(
    result.rows.map((row) => [row.automation_id, row]),
  );

  assert.equal(result.rows.length, 14);
  assert.deepEqual(
    [
      'extella_1c_agent',
      'extella_contract_agent',
      'extella_travel_agency',
    ].filter((id) => byId[id]),
    [
      'extella_1c_agent',
      'extella_contract_agent',
      'extella_travel_agency',
    ],
  );
  assert.equal(byId.extella_1c_agent.flags.installed_stale, true);
  assert.equal(byId.extella_1c_agent.flags.dead_reference, true);
  assert.equal(byId.extella_1c_agent.evidence.catalog_installed, false);
  assert.equal(byId.extella_contract_agent.flags.installed, true);
  assert.equal(byId.extella_travel_agency.flags.installed, true);
  result.rows.forEach((row) => {
    assert.ok(row.versions.declared);
    assert.ok(row.versions.installed);
    assert.ok(row.statuses.catalog);
    assert.ok(row.statuses.installed);
    assert.ok(row.statuses.effective);
  });
  assert.equal(result.complete, false);
});

test('unrelated device plugins and flat install references never become automation rows', () => {
  const api = load();
  const result = plain(api.project(baseInput({
    catalogRecords: [{
      id: 'catalog_automation',
      version: '1.0.0',
      status: 'active',
      installed: false,
    }],
    deviceRecords: [
      device('catalog_automation', {
        category: 'automations',
        type: 'process',
        version: '1.0.0',
        status: 'active',
      }),
      device('ordinary_plugin', {
        category: 'business',
        type: 'application',
        version: '4.5.6',
        status: 'active',
      }),
    ],
    localInstalledIds: [
      'catalog_automation',
      'ordinary_plugin',
      'browser_only_plugin',
    ],
    composerInstalledRecords: [{
      id: 'composer_service',
      kind: 'service',
      status: 'installed',
    }],
  })));

  assert.deepEqual(
    result.rows.map((row) => row.automation_id),
    ['catalog_automation'],
  );
});

test('reviewed source migrations keep the three required automations visible', () => {
  const api = load();
  const result = plain(api.project(baseInput({
    includeReviewedAutomations: true,
  })));

  assert.deepEqual(
    result.rows.map((row) => row.automation_id),
    [
      'extella_1c_agent',
      'extella_contract_agent',
      'extella_travel_agency',
    ],
  );
  result.rows.forEach((row) => {
    assert.equal(row.flags.catalog, false);
    assert.equal(row.flags.installed, false);
    assert.notEqual(row.versions.declared, 'UNKNOWN');
    assert.notEqual(row.statuses.effective, 'UNKNOWN');
  });
  assert.equal(
    result.rows.find(
      (row) => row.automation_id === 'extella_1c_agent',
    ).flags.dead_reference,
    false,
  );
});

test('catalog, stale, dead reference and orphan semantics are deterministic', () => {
  const api = load();
  const result = plain(api.project(baseInput({
    catalogRecords: [
      { id: 'catalog_only', version: '1.0.0', status: 'active' },
      { id: 'dead_one', version: '1.0.0', status: 'active' },
      { id: 'stale_one', version: '2.0.0-beta.1', status: 'beta' },
    ],
    deviceRecords: [
      device('orphan_one', {
        category: 'automations',
        type: 'process',
        version: '1.0.0',
        status: 'active',
      }),
      device('stale_one', {
        category: 'automations',
        type: 'process',
        version: '1.0.0',
        status: 'active',
      }),
    ],
    localInstalledIds: ['dead_one', 'orphan_one', 'stale_one'],
  })));
  const byId = Object.fromEntries(
    result.rows.map((row) => [row.automation_id, row]),
  );
  assert.equal(byId.catalog_only.availability, 'catalog');
  assert.equal(byId.dead_one.availability, 'dead_reference');
  assert.equal(byId.stale_one.availability, 'installed_stale');
  assert.equal(byId.orphan_one.availability, 'installed');
  assert.equal(byId.orphan_one.orphan, true);
  assert.deepEqual(
    result.rows.map((row) => row.automation_id),
    ['catalog_only', 'dead_one', 'orphan_one', 'stale_one'],
  );
  assert.deepEqual(result.counters, {
    total: 4,
    catalog: 3,
    installed: 2,
    installed_stale: 1,
    dead_reference: 1,
    with_risks: 3,
    orphans: 1,
  });
});

test('duplicate IDs and missing required version/status fail closed with UNKNOWN', () => {
  const api = load();
  const duplicate = {
    id: 'duplicate_one',
    version: '1.0.0',
    status: 'active',
  };
  const result = plain(api.project(baseInput({
    catalogRecords: [duplicate, { ...duplicate }],
    deviceRecords: [device('invalid_one', {
      category: 'automations',
      type: 'process',
      version: '',
      status: '',
    })],
    localInstalledIds: ['duplicate_one', 'invalid_one'],
  })));
  const byId = Object.fromEntries(
    result.rows.map((row) => [row.automation_id, row]),
  );
  assert.equal(result.complete, false);
  assert.equal(byId.duplicate_one.flags.catalog, true);
  assert.equal(byId.duplicate_one.flags.catalog_valid, false);
  assert.equal(byId.duplicate_one.availability, 'dead_reference');
  assert.ok(byId.duplicate_one.discrepancies.includes('DUPLICATE_CATALOG_ID'));
  assert.equal(byId.invalid_one.versions.installed, 'UNKNOWN');
  assert.equal(byId.invalid_one.statuses.installed, 'UNKNOWN');
  assert.equal(byId.invalid_one.flags.installed, false);
});

test('local and Composer records are evidence only and never prove installed', () => {
  const api = load();
  const result = plain(api.project(baseInput({
    catalogRecords: [{
      id: 'catalog_ref',
      version: '1.0.0',
      status: 'active',
    }],
    localInstalledIds: ['catalog_ref'],
    composerInstalledRecords: [{
      id: 'catalog_ref',
      version: '1.0.0',
      status: 'installed',
    }],
  })));
  const row = result.rows[0];
  assert.equal(row.flags.installed, false);
  assert.equal(row.flags.dead_reference, true);
  assert.equal(row.evidence.local_installed, true);
  assert.equal(row.evidence.composer_installed, true);
});

test('catalog installed field affects reconciliation but never overrides a strict device card', () => {
  const api = load();
  const result = plain(api.project(baseInput({
    catalogRecords: [{
      id: 'catalog_claims_installed',
      version: '1.0.0',
      status: 'active',
      installed: true,
    }, {
      id: 'catalog_claims_proposal',
      version: '1.0.0',
      status: 'active',
      installed: false,
    }],
    deviceRecords: [device('catalog_claims_proposal', {
      category: 'automations',
      type: 'process',
      version: '1.0.0',
      status: 'active',
    })],
  })));
  const byId = Object.fromEntries(
    result.rows.map((row) => [row.automation_id, row]),
  );
  assert.equal(byId.catalog_claims_installed.flags.installed, false);
  assert.equal(byId.catalog_claims_installed.flags.dead_reference, true);
  assert.ok(byId.catalog_claims_installed.discrepancies.includes(
    'CATALOG_INSTALLATION_MISMATCH',
  ));
  assert.equal(byId.catalog_claims_proposal.flags.installed, true);
  assert.equal(byId.catalog_claims_proposal.availability, 'installed');
  assert.ok(byId.catalog_claims_proposal.discrepancies.includes(
    'CATALOG_INSTALLATION_MISMATCH',
  ));
});

test('source errors keep an explicit incomplete CURRENT_DEVICE projection', () => {
  const api = load();
  const result = plain(api.project(baseInput({
    catalogRecords: [{
      id: 'source_error_one',
      version: '1.0.0',
      status: 'active',
    }],
    sourceErrors: [{
      source: 'device',
      code: 'NETWORK_DETAIL_THAT_MUST_NOT_BE_ECHOED',
      message: 'TOKEN=secret',
    }],
  })));
  assert.equal(result.schema, 'extella.evolution.automation_registry.v1');
  assert.equal(result.scope, 'CURRENT_DEVICE');
  assert.equal(result.checked_at, '2026-07-26T12:00:00.000Z');
  assert.equal(result.complete, false);
  assert.deepEqual(result.source_errors, [{
    source: 'device',
    code: 'SOURCE_UNAVAILABLE',
  }]);
  assert.doesNotMatch(JSON.stringify(result), /TOKEN=secret/);
});

test('canonical catalog shape is accepted and conflicting legacy fields are rejected', () => {
  const api = load();
  const result = plain(api.project(baseInput({
    catalogRecords: [{
      automation_id: 'canonical_one',
      name: { ru: 'Каноническая', en: 'Canonical' },
      version_declared: '1.2.3',
      state: { status: 'active' },
      installed: false,
    }, {
      automation_id: 'conflicting_one',
      id: 'another_one',
      version_declared: '1.0.0',
      version: '2.0.0',
      state: { status: 'active' },
      status: 'beta',
      installed: false,
    }],
  })));
  const byId = Object.fromEntries(
    result.rows.map((row) => [row.automation_id, row]),
  );

  assert.equal(byId.canonical_one.flags.catalog, true);
  assert.equal(byId.canonical_one.flags.catalog_valid, true);
  assert.equal(byId.canonical_one.versions.declared, '1.2.3');
  assert.equal(byId.canonical_one.statuses.catalog, 'active');
  assert.equal(byId.conflicting_one.flags.catalog, true);
  assert.equal(byId.conflicting_one.flags.catalog_valid, false);
  assert.ok(byId.conflicting_one.discrepancies.includes(
    'CATALOG_RECORD_CONFLICT',
  ));
  assert.equal(result.complete, false);
});

test('unavailable browser evidence cannot create a false installation mismatch', () => {
  const api = load();
  const result = plain(api.project(baseInput({
    catalogRecords: [{
      id: 'installed_without_browser_source',
      version: '1.0.0',
      status: 'active',
    }],
    deviceRecords: [device('installed_without_browser_source', {
      category: 'automations',
      type: 'process',
      version: '1.0.0',
      status: 'active',
    })],
    sourceErrors: [{
      source: 'local_installed',
      code: 'BROWSER_STORAGE_UNAVAILABLE',
    }],
  })));
  const row = result.rows[0];

  assert.equal(row.flags.installed, true);
  assert.equal(row.evidence.local_installed, 'UNKNOWN');
  assert.ok(!row.discrepancies.includes('LOCAL_REFERENCE_MISMATCH'));
  assert.equal(result.complete, false);
});

test('unavailable device evidence cannot create a catalog installation mismatch', () => {
  const api = load();
  const result = plain(api.project(baseInput({
    catalogRecords: [{
      id: 'catalog_installation_unknown',
      version: '1.0.0',
      status: 'active',
      installed: true,
    }],
    sourceErrors: [{
      source: 'device',
      code: 'DEVICE_CARDS_UNAVAILABLE',
    }],
  })));
  const row = result.rows[0];

  assert.equal(row.flags.catalog, true);
  assert.equal(row.flags.installed, 'UNKNOWN');
  assert.equal(row.availability, 'catalog');
  assert.ok(!row.discrepancies.includes('CATALOG_INSTALLATION_MISMATCH'));
  assert.equal(row.evidence.catalog_installed, true);
  assert.equal(result.complete, false);
});

test('unavailable sources never turn absence into orphan or dead-reference fact', () => {
  const api = load();
  const result = plain(api.project(baseInput({
    deviceRecords: [device('unknown_catalog_one', {
      category: 'automations',
      type: 'process',
      version: '1.0.0',
      status: 'active',
    })],
    localInstalledIds: ['unknown_catalog_one', 'extella_contract_agent'],
    sourceErrors: [
      { source: 'catalog', code: 'offline' },
      { source: 'device', code: 'offline' },
      { source: 'TOKEN=secret', code: 'TOKEN=secret' },
    ],
  })));
  const byId = Object.fromEntries(
    result.rows.map((row) => [row.automation_id, row]),
  );
  assert.equal(byId.unknown_catalog_one.orphan, null);
  assert.equal(byId.unknown_catalog_one.flags.catalog, 'UNKNOWN');
  assert.equal(byId.unknown_catalog_one.flags.installed, 'UNKNOWN');
  assert.equal(byId.unknown_catalog_one.flags.installed_stale, 'UNKNOWN');
  assert.equal(byId.unknown_catalog_one.flags.dead_reference, 'UNKNOWN');
  assert.equal(byId.unknown_catalog_one.availability, 'UNKNOWN');
  assert.equal(byId.extella_contract_agent.flags.catalog, 'UNKNOWN');
  assert.equal(byId.extella_contract_agent.flags.installed, 'UNKNOWN');
  assert.equal(byId.extella_contract_agent.flags.dead_reference, 'UNKNOWN');
  assert.equal(byId.extella_contract_agent.availability, 'UNKNOWN');
  assert.equal(result.counters.catalog, 0);
  assert.equal(result.counters.installed, 0);
  assert.equal(result.counters.installed_stale, 0);
  assert.equal(result.counters.dead_reference, 0);
  assert.equal(byId.unknown_device_one, undefined);
  assert.doesNotMatch(JSON.stringify(result), /TOKEN=secret/);
});
