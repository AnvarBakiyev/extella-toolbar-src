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
const contractSource = fs.readFileSync(
  path.join(
    toolbarRoot,
    'src',
    'core',
    'evolution-agent-control-contract.js',
  ),
  'utf8',
);

const ACTOR = 'account_owner_1';
const SNAPSHOT = 'fleet_snapshot_1';

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonical(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonical(value[key])}`,
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

function agentControlContract(overrides = {}) {
  return {
    surface: 'agent_control_center',
    engine: 'ETB.agentControl',
    shared_ledger_with: 'agent_cabinet',
    operations: [
      { code: 'createDraft', order: 1, ru: 'Черновик', en: 'Draft', requires: [] },
      { code: 'analyzeImpact', order: 2, ru: 'Влияние', en: 'Impact', requires: ['createDraft'] },
      { code: 'runPlayground', order: 3, ru: 'Проверка', en: 'Playground', requires: ['createDraft'] },
      { code: 'publishDraft', order: 4, ru: 'Публикация', en: 'Publish', requires: ['analyzeImpact', 'runPlayground'] },
      { code: 'runActive', order: 5, ru: 'Запуск', en: 'Run active', requires: ['publishDraft'] },
      { code: 'rollback', order: 6, ru: 'Откат', en: 'Roll back', requires: ['publishDraft'] },
    ],
    publish_gates: [
      { code: 'IMPACT_ANALYZED', ru: 'Влияние проверено', en: 'Impact checked' },
      { code: 'PLAYGROUND_GREEN', ru: 'Проверка пройдена', en: 'Playground passed' },
      { code: 'ROLLBACK_AVAILABLE', ru: 'Откат доступен', en: 'Rollback available' },
      { code: 'READ_BACK_CONFIRMED', ru: 'Результат перечитан', en: 'Read-back confirmed' },
    ],
    limits: [
      { ru: 'Не создаёт агентов.', en: 'Does not create agents.' },
      { ru: 'Не меняет защиту данных.', en: 'Does not change data protection.' },
      { ru: 'Не ведёт отдельный журнал.', en: 'Keeps no separate ledger.' },
      { ru: 'Неизвестное остаётся неизвестным.', en: 'Unknown remains unknown.' },
    ],
    ...overrides,
  };
}

function sourcePassport(id) {
  return {
    source_passport_id: `passport_${id}`,
    path: `passports/${id}.yaml`,
    platform_agent_id: id,
    sha256: 'a'.repeat(64),
  };
}

function readyStandard(id, control) {
  return {
    platform_agent_id: id,
    passport_ready: true,
    cabinet: {
      schema: 'extella.agent_cabinet.v1.1',
      agent_control: control,
    },
  };
}

function fleetRow(id) {
  return {
    platformAgentId: id,
    platformPresent: true,
    passportPresent: true,
    standardStatus: 'PASS',
  };
}

function session(options = {}) {
  const standards = options.standards || [];
  const sources = Object.prototype.hasOwnProperty.call(options, 'sources') ?
    options.sources : standards.map((row) => sourcePassport(row.platform_agent_id));
  const standardsById = Object.fromEntries(
    standards.map((row) => [row.platform_agent_id, row]),
  );
  const rows = options.fleetRows || standards.map(
    (row) => fleetRow(row.platform_agent_id),
  );
  return {
    actorId: ACTOR,
    epoch: 1,
    snapshotId: SNAPSHOT,
    standardsAvailable: options.standardsAvailable !== false,
    standardsError: options.standardsError || null,
    standardsBundle: options.noSources ? {} : { sources: { passports: sources } },
    standardsById,
    platformById: Object.fromEntries(
      rows.filter((row) => row.platformPresent).map((row) => [
        row.platformAgentId,
        { platform_agent_id: row.platformAgentId },
      ]),
    ),
    fleet: { rows },
  };
}

function agentControlSlice() {
  const start = router.indexOf('  function _evolutionAgentControlLoad(');
  const end = router.indexOf('  function _evolutionTrustedPublishRequest(', start);
  assert.ok(start >= 0 && end > start, 'agent-control loader must be extractable');
  return router.slice(start, end);
}

function harness(fleetSession) {
  const context = {
    __session: fleetSession,
    ETB: { evolutionConsole: { canonical } },
    Promise,
  };
  vm.runInNewContext(contractSource, context, {
    filename: 'evolution-agent-control-contract.js',
  });
  vm.runInNewContext(`
    var _evolutionFleetSession = __session;
    function _evolutionError(code, message) {
      var error = new Error(message || code);
      error.code = code;
      return error;
    }
    function _evolutionRequireSession(data, context) {
      var current = _evolutionFleetSession;
      if (!current || current.actorId !== context.actorId ||
          current.epoch !== context.epoch) {
        throw _evolutionError('FLEET_SNAPSHOT_REQUIRED');
      }
      if (String(data && data.snapshotId || '') !== current.snapshotId) {
        throw _evolutionError('FLEET_SNAPSHOT_MISMATCH');
      }
      return current;
    }
    ${agentControlSlice()}
    this.loadAgentControl = function (data, context) {
      return _evolutionAgentControlLoad(data, context);
    };
  `, context, { filename: 'evolution-agent-control-router-slice.js' });
  return context;
}

function load(runtime, snapshotId = SNAPSHOT, actorId = ACTOR) {
  return runtime.loadAgentControl(
    { snapshotId },
    { actorId, epoch: 1 },
  );
}

test('Agent change-management projection is read-only and returns no inventory', async () => {
  const control = agentControlContract();
  const runtime = harness(session({
    standards: [readyStandard('agent_alpha', control)],
  }));
  const result = plain(await load(runtime));

  assert.deepEqual(Object.keys(result).sort(), [
    'agent_passport_count',
    'captured_at',
    'contract',
    'error_code',
    'fleet_snapshot_id',
    'mutations_allowed',
    'owner_account_id',
    'schema',
    'status',
  ]);
  assert.equal(result.schema, 'extella.evolution.agent_control_surface.v1');
  assert.equal(result.owner_account_id, ACTOR);
  assert.equal(result.fleet_snapshot_id, SNAPSHOT);
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.agent_passport_count, 1);
  assert.equal(result.mutations_allowed, false);
  assert.equal(result.error_code, null);
  assert.deepEqual(result.contract, control);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'ledger_status'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'agents'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'sources'), false);
});

test('five ready Agent Passports with one canonical Cabinet contract stay AVAILABLE', async () => {
  const ids = [
    'agent_alpha',
    'agent_beta',
    'agent_gamma',
    'agent_delta',
    'agent_epsilon',
  ];
  const runtime = harness(session({
    standards: ids.map((id) => readyStandard(id, agentControlContract())),
  }));
  const result = plain(await load(runtime));

  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.agent_passport_count, 5);
  assert.equal(result.mutations_allowed, false);
  assert.equal(result.error_code, null);
  assert.deepEqual(result.contract, agentControlContract());
});

test('an unready or dead declared passport never projects a ready subset', async () => {
  const alpha = readyStandard('agent_alpha', agentControlContract());
  const betaUnready = readyStandard('agent_beta', agentControlContract());
  betaUnready.passport_ready = false;
  const unready = plain(await load(harness(session({
    standards: [alpha, betaUnready],
    sources: [sourcePassport('agent_alpha'), sourcePassport('agent_beta')],
  }))));
  assert.equal(unready.status, 'CONTRACT_UNAVAILABLE');
  assert.equal(
    unready.error_code,
    'AGENT_CONTROL_PASSPORT_SET_INCOMPLETE',
  );
  assert.equal(unready.agent_passport_count, 2);
  assert.equal(unready.contract, null);

  const beta = readyStandard('agent_beta', agentControlContract());
  const dead = plain(await load(harness(session({
    standards: [alpha, beta],
    sources: [sourcePassport('agent_alpha'), sourcePassport('agent_beta')],
    fleetRows: [
      fleetRow('agent_alpha'),
      {
        ...fleetRow('agent_beta'),
        platformPresent: false,
        standardStatus: 'DEAD_REFERENCE',
      },
    ],
  }))));
  assert.equal(dead.status, 'CONTRACT_UNAVAILABLE');
  assert.equal(
    dead.error_code,
    'AGENT_CONTROL_PASSPORT_SET_INCOMPLETE',
  );
  assert.equal(dead.contract, null);
});

test('an unbound source is outside the live Cabinet cohort', async () => {
  const alpha = readyStandard('agent_alpha', agentControlContract());
  const unbound = sourcePassport('agent_unbound');
  unbound.platform_agent_id = null;
  const unboundResult = plain(await load(harness(session({
    standards: [alpha],
    sources: [sourcePassport('agent_alpha'), unbound],
  }))));
  assert.equal(unboundResult.status, 'AVAILABLE');
  assert.equal(unboundResult.agent_passport_count, 1);
  assert.equal(unboundResult.error_code, null);
  assert.deepEqual(unboundResult.contract, agentControlContract());

  const onlyUnbound = plain(await load(harness(session({
    standards: [],
    sources: [unbound],
  }))));
  assert.equal(onlyUnbound.status, 'CONTRACT_UNAVAILABLE');
  assert.equal(
    onlyUnbound.error_code,
    'AGENT_CONTROL_PASSPORT_SET_INCOMPLETE',
  );
  assert.equal(onlyUnbound.agent_passport_count, 1);
  assert.equal(onlyUnbound.contract, null);

  const extraStandard = plain(await load(harness(session({
    standards: [alpha, readyStandard('agent_extra', agentControlContract())],
    sources: [sourcePassport('agent_alpha')],
  }))));
  assert.equal(extraStandard.status, 'CONTRACT_UNAVAILABLE');
  assert.equal(
    extraStandard.error_code,
    'AGENT_CONTROL_PASSPORT_SOURCE_INVALID',
  );
  assert.equal(extraStandard.contract, null);
});

test('unavailable standards remain unknown rather than zero passports', async () => {
  const runtime = harness(session({
    standardsAvailable: false,
    standardsError: { code: 'not a safe reason!' },
    sources: [],
  }));
  const result = plain(await load(runtime));

  assert.equal(result.status, 'STANDARDS_UNAVAILABLE');
  assert.equal(result.agent_passport_count, null);
  assert.equal(result.contract, null);
  assert.equal(result.mutations_allowed, false);
  assert.equal(result.error_code, 'PRODUCTION_STANDARDS_UNAVAILABLE');
});

test('only an attested empty source list produces NO_AGENT_PASSPORTS', async () => {
  const empty = plain(await load(harness(session({ sources: [] }))));
  assert.equal(empty.status, 'NO_AGENT_PASSPORTS');
  assert.equal(empty.agent_passport_count, 0);
  assert.equal(empty.contract, null);
  assert.equal(empty.mutations_allowed, false);

  const unready = {
    platform_agent_id: 'agent_unready',
    passport_ready: false,
    cabinet: null,
  };
  const nonEmpty = plain(await load(harness(session({
    standards: [unready],
    sources: [sourcePassport('agent_unready')],
    fleetRows: [fleetRow('agent_unready')],
  }))));
  assert.equal(nonEmpty.status, 'CONTRACT_UNAVAILABLE');
  assert.equal(
    nonEmpty.error_code,
    'AGENT_CONTROL_PASSPORT_SET_INCOMPLETE',
  );
  assert.equal(nonEmpty.agent_passport_count, 1);
  assert.notEqual(nonEmpty.status, 'NO_AGENT_PASSPORTS');
});

test('missing, malformed and divergent Cabinet contracts all close the surface', async () => {
  const missing = readyStandard('agent_missing', null);
  const missingResult = plain(await load(harness(session({
    standards: [missing],
  }))));
  assert.equal(missingResult.status, 'CONTRACT_UNAVAILABLE');
  assert.equal(missingResult.error_code, 'AGENT_CONTROL_CONTRACT_UNAVAILABLE');

  const malformedControl = agentControlContract();
  malformedControl.operations[0].requires = ['publishDraft'];
  const malformedResult = plain(await load(harness(session({
    standards: [readyStandard('agent_invalid', malformedControl)],
  }))));
  assert.equal(malformedResult.status, 'CONTRACT_UNAVAILABLE');
  assert.equal(
    malformedResult.error_code,
    'AGENT_CONTROL_CONTRACT_OPERATION_SEQUENCE_INVALID',
  );

  const alpha = agentControlContract();
  const beta = agentControlContract();
  beta.limits[0].en = 'Does not create any agents.';
  const mismatchResult = plain(await load(harness(session({
    standards: [
      readyStandard('agent_alpha', alpha),
      readyStandard('agent_beta', beta),
    ],
  }))));
  assert.equal(mismatchResult.status, 'CONTRACT_MISMATCH');
  assert.equal(mismatchResult.error_code, 'AGENT_CONTROL_CONTRACT_MISMATCH');
  assert.equal(mismatchResult.agent_passport_count, 2);
  assert.equal(mismatchResult.contract, null);
});

test('a missing source declaration remains UNKNOWN and account/snapshot fences apply', async () => {
  const runtime = harness(session({ noSources: true }));
  const unknown = plain(await load(runtime));
  assert.equal(unknown.status, 'UNKNOWN');
  assert.equal(unknown.agent_passport_count, null);
  assert.equal(unknown.error_code, 'AGENT_PASSPORT_SOURCES_UNKNOWN');

  assert.throws(
    () => load(runtime, 'other_snapshot'),
    (error) => error && error.code === 'FLEET_SNAPSHOT_MISMATCH',
  );
  assert.throws(
    () => load(runtime, SNAPSHOT, 'other_account'),
    (error) => error && error.code === 'FLEET_SNAPSHOT_REQUIRED',
  );
});

test('Agent Cabinet projection stays read-only while publish is a separate fenced route', () => {
  const source = agentControlSlice();
  assert.match(source, /_evolutionRequireSession\(data, context, false\)/);
  assert.match(source, /session\.standardsBundle/);
  assert.match(router, /if \(action === 'agent_control_load'\)/);
  assert.doesNotMatch(source, /_evolutionBundle\(|kvGet|kvSet|localStorage|_agentControlWrite|_agentControlAction|etb_agent_control|\btoken\b/);
  assert.doesNotMatch(
    router,
    /action === 'agent_control_publish'|action === 'agent_control_create'/,
  );
  assert.match(router, /if \(action === 'etb_evolution_publish'\)/);
  assert.doesNotMatch(router, /e\.data\.type === 'etb_evolution_publish'/);
});
