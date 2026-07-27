'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const toolbarRoot = path.resolve(__dirname, '..');
const router = fs.readFileSync(
  path.join(toolbarRoot, 'src', 'core', 'router.js'),
  'utf8',
);

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonical(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${canonical(value[key])}`,
  ).join(',')}}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(canonical(value)).digest('hex');
}

function helperHarness() {
  const start = router.indexOf('  function _evolutionExactIds');
  const end = router.indexOf(
    '  function _evolutionEscalationAction',
    start,
  );
  assert.ok(start >= 0 && end > start);
  let sequence = 0;
  const registryHarness = {
    result: null,
    loads: 0,
    contextAssertions: 0,
  };
  const context = {
    ETB: {
      evolutionConsole: {
        canonical,
        sha256(value) {
          return Promise.resolve(sha256(value));
        },
      },
    },
    Promise,
    loadAutomationRegistry() {
      registryHarness.loads += 1;
      return Promise.resolve(registryHarness.result);
    },
    assertContext() {
      registryHarness.contextAssertions += 1;
    },
  };
  vm.runInNewContext(`
    function _evolutionError(code, message) {
      var error = new Error(message || code);
      error.code = code;
      return error;
    }
    function _evolutionClone(value) {
      return value == null ? value : JSON.parse(JSON.stringify(value));
    }
    function _agentControlEventId(prefix) {
      sequence += 1;
      return String(prefix) + '_' + sequence;
    }
    function _evolutionAutomationRegistryLoad(context) {
      return loadAutomationRegistry(context);
    }
    function _agentControlAssertContext(context) {
      return assertContext(context);
    }
    var sequence = 0;
    ${router.slice(start, end)}
    this.helpers = {
      exactIds: _evolutionExactIds,
      validateEscalation: _evolutionValidateEscalationContract,
      buildBulkSpec: _evolutionBuildBulkSpec,
      callAdapter: _evolutionCallAdapter,
      scheduleStateGate: _evolutionScheduleAutomationStateGate,
      requireCurrentScheduleState:
        _evolutionRequireCurrentScheduleAutomationState,
      setAdapter: function (adapter) {
        ETB.evolutionAdapter = adapter;
      }
    };
  `, context, { filename: 'evolution-router-helper-slice.js' });
  context.helpers.registryHarness = registryHarness;
  return context.helpers;
}

function ledgerDiscoveryHarness(rememberedOwner, readLedgerImpl) {
  const start = router.indexOf('  function _evolutionDiscoverLedger');
  const end = router.indexOf('  function _evolutionIssueRows', start);
  assert.ok(start >= 0 && end > start);
  const reads = [];
  const context = {
    ETB: { agentControl: { canonical } },
    Promise,
    rememberedOwner,
    readLedger(id, actorContext) {
      reads.push(id);
      return readLedgerImpl(id, actorContext);
    },
    unexpectedScan() {
      throw new Error('live-agent replacement scan must not run');
    },
  };
  vm.runInNewContext(`
    function _evolutionLedgerOwnerLoad() {
      return rememberedOwner;
    }
    function _evolutionLedgerOwnerSave() {}
    function _agentControlReadLedger(id, actorContext) {
      return readLedger(id, actorContext);
    }
    function _evolutionMapLimit() {
      return unexpectedScan();
    }
    ${router.slice(start, end)}
    this.discoverLedger = _evolutionDiscoverLedger;
  `, context, { filename: 'evolution-router-ledger-discovery-slice.js' });
  return { discoverLedger: context.discoverLedger, reads };
}

function rejectsCode(work, code) {
  const promise = typeof work === 'function'
    ? Promise.resolve().then(work)
    : work;
  return assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

function classSession() {
  return {
    snapshotId: 'fleet_snapshot_exact',
    fleet: {
      rows: [
        {
          platformAgentId: 'agent_a',
          platformPresent: true,
          passportPresent: true,
          standardStatus: 'PASS',
        },
        {
          platformAgentId: 'agent_b',
          platformPresent: true,
          passportPresent: true,
          standardStatus: 'PASS',
        },
      ],
    },
    standardsById: {
      agent_a: {
        passport_ready: true,
        cabinet: { schema: 'extella.agent_cabinet.v1.1' },
      },
      agent_b: {
        passport_ready: true,
        cabinet: { schema: 'extella.agent_cabinet.v1.1' },
      },
    },
    sharedMap: {
      mapSha256: 'a'.repeat(64),
      byGeneId: {
        'gene.approval': {
          geneId: 'gene.approval',
          consumerAgentIds: ['agent_b', 'agent_a'],
          consumers: [
            { platformAgentId: 'agent_a', activeVersion: '1.0.0' },
            { platformAgentId: 'agent_b', activeVersion: '1.0.0' },
          ],
        },
      },
    },
  };
}

function classContract() {
  const candidate = {
      schemaVersion: 'managed-agent-class-candidate.v1',
      sharedGene: { id: 'gene.approval', version: '2.0.0' },
      agents: {
        agent_a: {
          platform_agent_id: 'agent_a',
          sharedGene: {
            id: 'gene.approval',
            fromVersion: '1.0.0',
            version: '2.0.0',
          },
        },
        agent_b: {
          platform_agent_id: 'agent_b',
          sharedGene: {
            id: 'gene.approval',
            fromVersion: '1.0.0',
            version: '2.0.0',
          },
        },
      },
  };
  const candidateSha256 = sha256(candidate);
  return {
    candidate_id: `candidate_gene.approval_${candidateSha256.slice(0, 16)}`,
    candidate_sha256: candidateSha256,
    candidate_bundle: candidate,
    scope: { kind: 'class' },
    source_agent_id: 'agent_a',
    shared_gene_id: 'gene.approval',
    shared_gene_map_sha256: 'a'.repeat(64),
    affected_agent_ids: ['agent_b', 'agent_a'],
    affected_count: 1,
    actor_id: 'account_actor',
  };
}

function managedLedger(ids) {
  const agents = {};
  const pointers = {};
  const versions = {};
  const fullBundle = {
    schemaVersion: 'agent-configuration-bundle.v1',
    agents: {},
    sharedCapabilities: {},
    sharedRules: [],
  };
  ids.forEach((id) => {
    fullBundle.agents[id] = {
      agentId: id,
      agent: { id, name: id },
      inventoryHashes: {},
      inventoryCounts: {},
      knowledge: [],
      localRules: [],
      capabilities: [],
      processes: [],
    };
  });
  ids.forEach((id, index) => {
    const versionId = `version_${index + 1}`;
    agents[id] = { id };
    pointers[id] = versionId;
    versions[versionId] = {
      immutable: true,
      bundleSha256: String(index + 1).repeat(64),
      bundle: plain(fullBundle),
    };
  });
  return {
    agents,
    activeVersionByAgent: pointers,
    versions,
  };
}

test('remembered unavailable ledger owner fails closed without scanning a replacement owner', async () => {
  const harness = ledgerDiscoveryHarness(
    'agent_retired',
    () => Promise.reject(Object.assign(
      new Error('remembered owner cannot be read'),
      { code: 'KV_READ_FAILED' },
    )),
  );
  const result = plain(await harness.discoverLedger(
    ['agent_live_b', 'agent_live_a'],
    { actorId: 'account_actor' },
  ));

  assert.deepEqual(harness.reads, ['agent_retired']);
  assert.equal(result.ledger, null);
  assert.equal(result.ownerAgentId, 'agent_retired');
  assert.deepEqual(
    result.errors.map((error) => error.code),
    ['EVOLUTION_LEDGER_OWNER_UNAVAILABLE'],
  );
});

test('router derives a full immutable candidate and rejects subset or wildcard contracts', async () => {
  const helpers = helperHarness();
  const session = classSession();
  const ledger = managedLedger(['agent_a', 'agent_b']);
  const normalized = plain(await helpers.validateEscalation(
    classContract(),
    session,
    'account_actor',
    ledger,
  ));
  assert.deepEqual(normalized.affected_agent_ids, ['agent_a', 'agent_b']);
  assert.equal(normalized.actor_id, 'account_actor');
  assert.equal(normalized.affected_count, 1);
  assert.equal(
    normalized.candidate_bundle.schemaVersion,
    'agent-configuration-bundle.v1',
  );
  assert.deepEqual(
    Object.keys(normalized.candidate_bundle.agents).sort(),
    ['agent_a', 'agent_b'],
  );
  assert.equal(
    normalized.candidate_bundle.evolutionChange.sharedGeneId,
    'gene.approval',
  );

  const wrongRequestHash = classContract();
  wrongRequestHash.candidate_sha256 = 'f'.repeat(64);
  await rejectsCode(
    () => helpers.validateEscalation(
      wrongRequestHash,
      session,
      'account_actor',
      ledger,
    ),
    'CABINET_CANDIDATE_REQUEST_HASH_MISMATCH',
  );

  const wrongRequestId = classContract();
  wrongRequestId.candidate_id = 'candidate_forged';
  await rejectsCode(
    () => helpers.validateEscalation(
      wrongRequestId,
      session,
      'account_actor',
      ledger,
    ),
    'CABINET_CANDIDATE_REQUEST_ID_MISMATCH',
  );

  const subset = classContract();
  subset.affected_agent_ids = ['agent_a'];
  await rejectsCode(
    () => helpers.validateEscalation(
      subset,
      session,
      'account_actor',
      ledger,
    ),
    'CABINET_SHARED_GENE_CLASS_MISMATCH',
  );

  const wildcard = classContract();
  wildcard.affected_agent_ids = ['*'];
  await rejectsCode(
    () => helpers.validateEscalation(
      wildcard,
      session,
      'account_actor',
      ledger,
    ),
    'AFFECTED_AGENT_IDS_REQUIRED',
  );

  const stale = classContract();
  stale.shared_gene_map_sha256 = 'c'.repeat(64);
  await rejectsCode(
    () => helpers.validateEscalation(
      stale,
      session,
      'account_actor',
      ledger,
    ),
    'CABINET_SHARED_GENE_IMPACT_STALE',
  );

  const unsupportedSchema = classContract();
  unsupportedSchema.candidate_bundle.schemaVersion = 'forged.v9';
  await rejectsCode(
    () => helpers.validateEscalation(
      unsupportedSchema,
      session,
      'account_actor',
      ledger,
    ),
    'CABINET_CANDIDATE_SCHEMA_INVALID',
  );

  const wrongAgentBinding = classContract();
  wrongAgentBinding.candidate_bundle.agents.agent_a.platform_agent_id =
    'agent_b';
  await rejectsCode(
    () => helpers.validateEscalation(
      wrongAgentBinding,
      session,
      'account_actor',
      ledger,
    ),
    'CABINET_CANDIDATE_AGENT_MISMATCH',
  );

  const staleGeneVersion = classContract();
  staleGeneVersion.candidate_bundle.agents.agent_a.sharedGene.fromVersion =
    '0.9.0';
  await rejectsCode(
    () => helpers.validateEscalation(
      staleGeneVersion,
      session,
      'account_actor',
      ledger,
    ),
    'CABINET_CANDIDATE_AGENT_MISMATCH',
  );

  const mutationBearingExtra = classContract();
  mutationBearingExtra.candidate_bundle.agents.agent_a.native_action = {
    delete: true,
  };
  await rejectsCode(
    () => helpers.validateEscalation(
      mutationBearingExtra,
      session,
      'account_actor',
      ledger,
    ),
    'CABINET_CANDIDATE_AGENT_INVALID',
  );

  const forgedActor = classContract();
  forgedActor.actor_id = 'other_account';
  await rejectsCode(
    () => helpers.validateEscalation(
      forgedActor,
      session,
      'account_actor',
      ledger,
    ),
    'CABINET_ESCALATION_ACTOR_MISMATCH',
  );

  const unavailableSourceSession = classSession();
  unavailableSourceSession.fleet.rows[0].platformPresent = false;
  await rejectsCode(
    () => helpers.validateEscalation(
      classContract(),
      unavailableSourceSession,
      'account_actor',
      ledger,
    ),
    'CABINET_SOURCE_AGENT_UNAVAILABLE',
  );
});

test('router builds bulk impact from the current projection instead of client spec', async () => {
  const helpers = helperHarness();
  const session = classSession();
  const ledger = managedLedger(['agent_a', 'agent_b']);
  const ignoredClientSpec = {
    operation_id: 'client_owned',
    target_agent_ids: ['*'],
    before_state_by_target: { '*': { fabricated: true } },
  };
  const spec = plain(await helpers.buildBulkSpec({
    operationType: 'shared_gene_change',
    targetIds: ['agent_b', 'agent_a'],
    sharedGeneId: 'gene.approval',
    desiredVersion: '2.0.0',
    spec: ignoredClientSpec,
  }, session, ledger, 'account_actor'));

  assert.equal(spec.operation_type, 'shared_gene_change');
  assert.deepEqual(spec.target_agent_ids, ['agent_a', 'agent_b']);
  assert.notEqual(spec.operation_id, 'client_owned');
  assert.equal(spec.payload.shared_gene_map_sha256, 'a'.repeat(64));
  assert.equal(
    spec.before_state_by_target.agent_a.active_gene_version,
    '1.0.0',
  );
  assert.equal(
    Object.hasOwn(spec.before_state_by_target, '*'),
    false,
  );

  await rejectsCode(
    () => helpers.buildBulkSpec({
      operationType: 'shared_gene_change',
      targetIds: ['agent_a'],
      sharedGeneId: 'gene.approval',
      desiredVersion: '2.0.0',
    }, session, ledger, 'account_actor'),
    'BULK_SHARED_GENE_CLASS_MISMATCH',
  );
  await rejectsCode(
    () => helpers.buildBulkSpec({
      operationType: 'shared_gene_change',
      targetIds: ['agent_a', 'agent_b'],
      sharedGeneId: 'gene.approval',
      desiredVersion: '*',
    }, session, ledger, 'account_actor'),
    'BULK_SHARED_GENE_VERSION_REQUIRED',
  );
});

test('dead-reference preview captures the exact restorable registry entry', async () => {
  const helpers = helperHarness();
  const session = classSession();
  const registryEntry = {
    platformAgentId: 'agent_dead',
    platform_agent_id: 'agent_dead',
    passport_present: true,
    passport_ready: true,
    checker_report: { ready: true, issues: [] },
    passport: { agent: { platform_agent_id: 'agent_dead' } },
  };
  session.fleet.rows.push({
    platformAgentId: 'agent_dead',
    platformPresent: false,
    passportPresent: true,
    standardStatus: 'DEAD_REFERENCE',
  });
  session.standardsById.agent_dead = registryEntry;
  session.standardsBundle = {
    attestation: { content_sha256: 'e'.repeat(64) },
  };
  const ownerLedger = managedLedger(['agent_a', 'agent_dead']);
  ownerLedger.ownerAgentId = 'agent_dead';
  await rejectsCode(
    () => helpers.buildBulkSpec({
      operationType: 'dead_reference_remove',
      targetIds: ['agent_dead'],
    }, session, ownerLedger, 'account_actor'),
    'EVOLUTION_LEDGER_OWNER_MIGRATION_REQUIRED',
  );

  const ledger = managedLedger(['agent_a', 'agent_dead']);
  ledger.ownerAgentId = 'agent_a';
  const spec = plain(await helpers.buildBulkSpec({
    operationType: 'dead_reference_remove',
    targetIds: ['agent_dead'],
  }, session, ledger, 'account_actor'));

  assert.deepEqual(
    spec.before_state_by_target.agent_dead.registry_entry,
    registryEntry,
  );
  assert.equal(
    spec.before_state_by_target.agent_dead.registry_entry_sha256,
    sha256(registryEntry),
  );
  assert.equal(
    spec.before_state_by_target.agent_dead.registry_bundle_content_sha256,
    'e'.repeat(64),
  );
  assert.equal(
    spec.desired_state_by_target.agent_dead.registry_present,
    false,
  );
});

test('schedule preview requires an adapter and native writes remain transaction-gated', async () => {
  const helpers = helperHarness();
  const session = classSession();
  const ledger = managedLedger(['agent_a', 'agent_b']);
  await rejectsCode(
    () => helpers.buildBulkSpec({
      operationType: 'schedule_pause',
      targetIds: ['agent_a'],
    }, session, ledger, 'account_actor'),
    'NATIVE_SCHEDULE_ADAPTER_UNAVAILABLE',
  );

  const mutationStart = router.indexOf(
    '  function _evolutionEscalationAction',
  );
  const mutationEnd = router.indexOf(
    '  function _evolutionConsoleAction',
    mutationStart,
  );
  const mutationSource = router.slice(mutationStart, mutationEnd);
  for (const adapterMethod of [
    'runClassTest',
    'activateClassStage',
    'observeClassChange',
    'rollbackClassChange',
    'activateBulkStage',
    'observeBulkOperation',
    'rollbackBulkOperation',
  ]) {
    assert.match(
      mutationSource,
      new RegExp(`_evolutionCallAdapter\\(\\s*'${adapterMethod}'`),
    );
  }
  assert.doesNotMatch(mutationSource, /managed_adapter_only/);
  assert.doesNotMatch(
    mutationSource,
    /stage\.targetAgentIds\.map\([\s\S]*?status:\s*'SUCCESS'/,
  );

  let nativeCalls = 0;
  helpers.setAdapter({
    activateClassStage() {
      nativeCalls += 1;
      return { results: [] };
    },
    runClassTest() {
      return { evidence: { source: 'exact-read-only-adapter' } };
    },
  });
  await rejectsCode(
    () => helpers.callAdapter(
      'activateClassStage',
      { candidateId: 'candidate_exact', stageIndex: 0 },
      'CLASS_ACTIVATION_ADAPTER_UNAVAILABLE',
      'class activation requires a connected exact host adapter',
    ),
    'DURABLE_EVOLUTION_TRANSACTION_UNAVAILABLE',
  );
  assert.equal(nativeCalls, 0);
  assert.deepEqual(
    plain(await helpers.callAdapter(
      'runClassTest',
      { candidateId: 'candidate_exact' },
      'EVOLUTION_LAB_ADAPTER_UNAVAILABLE',
      'Evolution Lab evidence requires an adapter',
    )),
    { evidence: { source: 'exact-read-only-adapter' } },
  );
  assert.match(router, /nativeDurableIntent:\s*'PLATFORM_UNAVAILABLE'/);
  assert.match(router, /multiDeviceCompareAndSwap:\s*'PLATFORM_UNAVAILABLE'/);
});

test('schedule mutation gate accepts only current usable state for every affected installed automation', () => {
  const helpers = helperHarness();
  const registry = {
    schema: 'extella.evolution.automation_registry.v1',
    scope: 'CURRENT_DEVICE',
    checked_at: '2026-07-27T10:00:00.000Z',
    rows: [{
      automation_id: 'automation_working',
      flags: { installed: true },
      state: { operational_status: 'WORKING' },
      components: {
        platform_agents: [{ id: 'agent_a', state: 'PRESENT' }],
      },
    }, {
      automation_id: 'automation_stopped',
      flags: { installed: true },
      state: { operational_status: 'NOT_RUNNING' },
      components: {
        platform_agents: [{ id: 'agent_b', state: 'PRESENT' }],
      },
    }, {
      automation_id: 'unrelated_unavailable',
      flags: { installed: true },
      state: { operational_status: 'STATE_UNAVAILABLE' },
      components: {
        platform_agents: [{ id: 'agent_c', state: 'PRESENT' }],
      },
    }],
  };

  assert.deepEqual(
    plain(helpers.scheduleStateGate(registry, ['agent_b', 'agent_a'])),
    {
      checkedAt: '2026-07-27T10:00:00.000Z',
      targetIds: ['agent_a', 'agent_b'],
      automationIds: ['automation_stopped', 'automation_working'],
    },
  );
});

test('schedule mutation gate fails closed for unavailable, unknown, uninstalled and unmapped targets', async () => {
  const helpers = helperHarness();
  const base = {
    schema: 'extella.evolution.automation_registry.v1',
    scope: 'CURRENT_DEVICE',
    checked_at: '2026-07-27T10:00:00.000Z',
    rows: [{
      automation_id: 'automation_exact',
      flags: { installed: true },
      state: { operational_status: 'WORKING' },
      components: {
        platform_agents: [{ id: 'agent_a', state: 'PRESENT' }],
      },
    }],
  };
  for (const status of ['STATE_UNAVAILABLE', 'UNKNOWN']) {
    const registry = plain(base);
    registry.rows[0].state.operational_status = status;
    await rejectsCode(
      () => helpers.scheduleStateGate(registry, ['agent_a']),
      'SCHEDULE_AUTOMATION_STATE_REQUIRED',
    );
  }
  const uninstalled = plain(base);
  uninstalled.rows[0].flags.installed = false;
  await rejectsCode(
    () => helpers.scheduleStateGate(uninstalled, ['agent_a']),
    'SCHEDULE_AUTOMATION_STATE_REQUIRED',
  );
  const ambiguousInstallation = plain(base);
  ambiguousInstallation.rows.push({
    automation_id: 'automation_installation_unknown',
    flags: { installed: 'UNKNOWN' },
    state: { operational_status: 'WORKING' },
    components: {
      platform_agents: [{ id: 'agent_a', state: 'PRESENT' }],
    },
  });
  await rejectsCode(
    () => helpers.scheduleStateGate(
      ambiguousInstallation,
      ['agent_a'],
    ),
    'SCHEDULE_AUTOMATION_STATE_REQUIRED',
  );
  await rejectsCode(
    () => helpers.scheduleStateGate(base, ['agent_unmapped']),
    'SCHEDULE_AUTOMATION_STATE_REQUIRED',
  );
  const idCollision = plain(base);
  idCollision.rows[0].automation_id = 'agent_collision';
  await rejectsCode(
    () => helpers.scheduleStateGate(idCollision, ['agent_collision']),
    'SCHEDULE_AUTOMATION_STATE_REQUIRED',
  );
  for (const componentState of ['MISSING', 'UNKNOWN']) {
    const unprovenMapping = plain(base);
    unprovenMapping.rows[0].components.platform_agents[0].state =
      componentState;
    await rejectsCode(
      () => helpers.scheduleStateGate(unprovenMapping, ['agent_a']),
      'SCHEDULE_AUTOMATION_STATE_REQUIRED',
    );
  }
  await rejectsCode(
    () => helpers.scheduleStateGate({
      ...base,
      scope: 'STALE_UI_COPY',
    }, ['agent_a']),
    'SCHEDULE_AUTOMATION_STATE_REQUIRED',
  );
});

test('schedule mutation gate reloads authoritative Registry state and ignores stale UI evidence', async () => {
  const helpers = helperHarness();
  const workingRegistry = {
    schema: 'extella.evolution.automation_registry.v1',
    scope: 'CURRENT_DEVICE',
    checked_at: '2026-07-27T10:00:00.000Z',
    rows: [{
      automation_id: 'automation_exact',
      flags: { installed: true },
      state: { operational_status: 'WORKING' },
      components: {
        platform_agents: [{ id: 'agent_a', state: 'PRESENT' }],
      },
    }],
  };
  helpers.registryHarness.result = { registry: workingRegistry };
  await helpers.requireCurrentScheduleState(
    { actorId: 'account_actor', staleUiRegistry: workingRegistry },
    ['agent_a'],
  );

  const unavailableRegistry = plain(workingRegistry);
  unavailableRegistry.checked_at = '2026-07-27T10:00:01.000Z';
  unavailableRegistry.rows[0].state.operational_status =
    'STATE_UNAVAILABLE';
  helpers.registryHarness.result = { registry: unavailableRegistry };
  await rejectsCode(
    () => helpers.requireCurrentScheduleState(
      { actorId: 'account_actor', staleUiRegistry: workingRegistry },
      ['agent_a'],
    ),
    'SCHEDULE_AUTOMATION_STATE_REQUIRED',
  );
  assert.equal(helpers.registryHarness.loads, 2);
  assert.equal(helpers.registryHarness.contextAssertions, 2);

  const bulkStart = router.indexOf('  function _evolutionBulkAction');
  const bulkEnd = router.indexOf(
    '  function _evolutionConsoleAction',
    bulkStart,
  );
  const bulkSource = router.slice(bulkStart, bulkEnd);
  assert.match(
    bulkSource,
    /operationType === 'schedule_pause' \|\|\s*operationType === 'schedule_resume'[\s\S]*?_evolutionRequireCurrentScheduleAutomationState\(\s*context,\s*scheduleTargets\s*\)[\s\S]*?performBulkStep\(\)/,
  );
  assert.doesNotMatch(
    bulkSource,
    /data\.(automationRegistry|automation_registry|automationState|automation_state)/,
  );
});

test('persisted mutation invalidates its account-bound fleet snapshot', () => {
  const persistStart = router.indexOf('  function _evolutionPersist');
  const persistEnd = router.indexOf(
    '  function _evolutionClone',
    persistStart,
  );
  const mutationStart = router.indexOf('  function _evolutionMutation');
  const mutationEnd = router.indexOf(
    '  function _evolutionExactIds',
    mutationStart,
  );
  const persist = router.slice(persistStart, persistEnd);
  const mutation = router.slice(mutationStart, mutationEnd);
  assert.match(persist, /session\.complete = false/);
  assert.match(persist, /session\.snapshotId = ''/);
  assert.match(persist, /_evolutionFleetSession = null/);
  assert.match(
    mutation,
    /function \(\) \{[\s\S]*?_evolutionFleetLoad\(context\)\.then\(function \(\) \{[\s\S]*?session = _evolutionRequireSession\(data, context, true\);[\s\S]*?_evolutionReadOrCreateLedger\(session, context\)/,
    'every mutation must re-read and re-bind the exact current fleet snapshot',
  );
});

test('Evolution Receipts are chronological and mutation responses bind exact action receipts', () => {
  const rowsStart = router.indexOf('  function _evolutionReceiptRows');
  const rowsEnd = router.indexOf('  function _evolutionFleetLoad', rowsStart);
  const actionStart = router.indexOf('  function _evolutionLastReceipt');
  const actionEnd = router.indexOf('  function _evolutionMutation', actionStart);
  assert.ok(rowsStart >= 0 && rowsEnd > rowsStart);
  assert.ok(actionStart >= 0 && actionEnd > actionStart);
  const context = {};
  vm.runInNewContext(`
    ${router.slice(rowsStart, rowsEnd)}
    ${router.slice(actionStart, actionEnd)}
    this.receiptHelpers = {
      rows: _evolutionReceiptRows,
      latest: _evolutionLastReceipt,
      escalation: _evolutionEscalationActionReceipt,
      bulk: _evolutionBulkActionReceipt
    };
  `, context, { filename: 'evolution-router-receipt-slice.js' });
  const ledger = {
    evolution: {
      receipts: {
        evolution_receipt_z: {
          id: 'evolution_receipt_z',
          at: '2026-07-26T10:00:00.000Z',
        },
        evolution_receipt_old: {
          id: 'evolution_receipt_old',
          at: '2026-07-25T10:00:00.000Z',
        },
        evolution_receipt_a: {
          id: 'evolution_receipt_a',
          at: '2026-07-26T10:00:00.000Z',
        },
        evolution_receipt_action: {
          id: 'evolution_receipt_action',
          at: '2026-07-24T10:00:00.000Z',
        },
      },
    },
  };
  assert.deepEqual(
    plain(context.receiptHelpers.rows(ledger).map((row) => row.id)),
    [
      'evolution_receipt_action',
      'evolution_receipt_old',
      'evolution_receipt_a',
      'evolution_receipt_z',
    ],
  );
  assert.equal(
    context.receiptHelpers.latest(ledger).id,
    'evolution_receipt_z',
  );
  assert.equal(
    context.receiptHelpers.escalation(
      ledger,
      { test: { receiptId: 'evolution_receipt_action' } },
      'escalation_test',
    ).id,
    'evolution_receipt_action',
  );
  assert.equal(
    context.receiptHelpers.bulk(
      ledger,
      {
        activation: {
          planReceiptId: 'evolution_receipt_old',
          nextStageIndex: 1,
          stages: [{
            summaryReceiptId: 'evolution_receipt_action',
          }],
        },
      },
      'bulk_stage',
    ).id,
    'evolution_receipt_action',
  );
});

test('Agent Passport draft requires a canonical production-registry MISSING row', () => {
  const start = router.indexOf('  function _evolutionPassportDraft');
  const end = router.indexOf('  function _evolutionLastReceipt', start);
  assert.ok(start >= 0 && end > start);
  const source = router.slice(start, end);
  assert.match(source, /!session\.standardsAvailable/);
  assert.match(source, /fleetRow\.passportPresent !== false/);
  assert.match(source, /fleetRow\.standardStatus !== 'PASSPORT_MISSING'/);
  assert.match(source, /AGENT_PASSPORT_NOT_MISSING/);
});
