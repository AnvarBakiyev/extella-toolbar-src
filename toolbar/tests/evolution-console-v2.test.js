'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { TextEncoder } = require('node:util');

const toolbarRoot = path.resolve(__dirname, '..');
const corePath = path.join(
  toolbarRoot,
  'src',
  'core',
  'evolution-console.js',
);
const coreSource = fs.readFileSync(corePath, 'utf8');
const ACTOR = 'actor_evolution_owner';
const NOW = '2026-07-26T08:00:00.000Z';
const HASH_ZERO = '0'.repeat(64);

function loadCore(options = {}) {
  const context = {
    ETB: {},
    console,
  };
  if (options.withCrypto !== false) {
    context.crypto = webcrypto;
    context.TextEncoder = TextEncoder;
  }
  vm.runInNewContext(coreSource, context, { filename: corePath });
  return context.ETB.evolutionConsole;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

async function rejectsCode(work, expectedCode) {
  let caught = null;
  try {
    await (typeof work === 'function' ? work() : work);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `expected rejection ${expectedCode}`);
  assert.equal(caught.code, expectedCode);
  return caught;
}

function cabinet({
  name,
  owner = 'Анвар',
  model = 'qwen-3.7',
  version = '1.0.0',
  genome = [],
}) {
  return {
    schema: 'extella.agent_cabinet.v1.1',
    passport: {
      identity: {
        name,
        owner,
        model_profile: model,
        active_version: version,
      },
      genome,
      attention: {
        shared_genes: genome
          .filter((entry) => entry.provenance === 'global')
          .map((entry) => entry.capability),
      },
    },
    declared_behaviour: { steps: [] },
    actual_behaviour: { evidence_sources: [], limits: { ru: [], en: [] } },
    evolution: { cycle: [], shared_change_guard: {} },
  };
}

async function makeLedger(api) {
  const fullBundle = {
    schemaVersion: 'agent-configuration-bundle.v1',
    agents: {
      agent_a: {
        agentId: 'agent_a',
        agent: { id: 'agent_a', name: 'Agent A' },
        inventoryHashes: {},
        inventoryCounts: {},
        knowledge: [],
        localRules: [],
        capabilities: [],
        processes: [],
      },
      agent_b: {
        agentId: 'agent_b',
        agent: { id: 'agent_b', name: 'Agent B' },
        inventoryHashes: {},
        inventoryCounts: {},
        knowledge: [],
        localRules: [],
        capabilities: [],
        processes: [],
      },
    },
    sharedCapabilities: {},
    sharedRules: [],
  };
  const bundleA = plain(fullBundle);
  const bundleB = plain(fullBundle);
  const [hashA, hashB] = await Promise.all([
    api.sha256(bundleA),
    api.sha256(bundleB),
  ]);
  return {
    schemaVersion: 'agent-control-ledger.v1',
    agents: {
      agent_a: { id: 'agent_a', name: 'Agent A' },
      agent_b: { id: 'agent_b', name: 'Agent B' },
    },
    versions: {
      version_a_v1: {
        id: 'version_a_v1',
        immutable: true,
        status: 'PUBLISHED',
        bundleSha256: hashA,
        bundle: bundleA,
      },
      version_b_v1: {
        id: 'version_b_v1',
        immutable: true,
        status: 'PUBLISHED',
        bundleSha256: hashB,
        bundle: bundleB,
      },
    },
    activeVersionByAgent: {
      agent_a: 'version_a_v1',
      agent_b: 'version_b_v1',
    },
  };
}

function classCandidate() {
  return {
    schemaVersion: 'agent-configuration-bundle.v1',
    agents: {
      agent_a: {
        agentId: 'agent_a',
        agent: { id: 'agent_a', name: 'Agent A' },
        inventoryHashes: {},
        inventoryCounts: {},
        knowledge: [],
        localRules: [],
        capabilities: [],
        processes: [],
      },
      agent_b: {
        agentId: 'agent_b',
        agent: { id: 'agent_b', name: 'Agent B' },
        inventoryHashes: {},
        inventoryCounts: {},
        knowledge: [],
        localRules: [],
        capabilities: [],
        processes: [],
      },
    },
    sharedCapabilities: {},
    sharedRules: [],
    evolutionChange: {
      schemaVersion: 'extella.evolution.shared_gene_change.v1',
      sharedGeneId: 'handler_profitability',
      desiredVersion: '2.0.0',
      affectedAgentIds: ['agent_a', 'agent_b'],
      beforeVersionByAgent: {
        agent_a: '1.0.0',
        agent_b: '1.0.0',
      },
      sharedGeneMapSha256: 'f'.repeat(64),
    },
  };
}

async function acceptedClass(api = loadCore()) {
  const base = await makeLedger(api);
  const candidate = classCandidate();
  const candidateHash = await api.sha256(candidate);
  const ledger = await api.acceptCabinetEscalation(base, {
    candidate_id: 'candidate_class_001',
    candidate_sha256: candidateHash,
    candidate_bundle: candidate,
    scope: { kind: 'class' },
    affected_agent_ids: ['agent_b', 'agent_a'],
    actor_id: ACTOR,
  }, { actorId: ACTOR, now: NOW });
  return { api, base, candidate, candidateHash, ledger };
}

function classTestEvidence(change, overrides = {}) {
  return {
    status: 'PASSED',
    candidate_id: change.candidateId,
    candidate_sha256: change.candidateBundleSha256,
    target_agent_ids: [...change.affectedAgentIds],
    target_list_sha256: change.targetListSha256,
    before_cases: [
      {
        case_id: 'same_case_1',
        input: { amount: 100, currency: 'KZT' },
        result: { decision: 'old' },
      },
      {
        case_id: 'same_case_2',
        input: { amount: 200, currency: 'KZT' },
        result: { decision: 'old' },
      },
    ],
    after_cases: [
      {
        case_id: 'same_case_1',
        input: { amount: 100, currency: 'KZT' },
        result: { decision: 'new' },
      },
      {
        case_id: 'same_case_2',
        input: { amount: 200, currency: 'KZT' },
        result: { decision: 'new' },
      },
    ],
    externalWrites: [],
    writeAttempts: 0,
    actor_id: ACTOR,
    ...overrides,
  };
}

async function testedClass(api = loadCore()) {
  const setup = await acceptedClass(api);
  const change = setup.ledger.evolution.escalations.candidate_class_001;
  const ledger = await api.recordClassTest(
    setup.ledger,
    'candidate_class_001',
    classTestEvidence(change),
    { actorId: ACTOR, now: '2026-07-26T08:05:00.000Z' },
  );
  return { ...setup, accepted: setup.ledger, ledger };
}

async function approvedClass(api = loadCore()) {
  const setup = await testedClass(api);
  const change = setup.ledger.evolution.escalations.candidate_class_001;
  const ledger = await api.approveClassChange(
    setup.ledger,
    change.candidateId,
    {
      target_agent_ids: change.affectedAgentIds,
      target_list_sha256: change.targetListSha256,
      candidate_sha256: change.candidateBundleSha256,
      test_receipt_sha256: change.test.receiptSha256,
      actor_id: ACTOR,
    },
    { actorId: ACTOR, now: '2026-07-26T08:06:00.000Z' },
  );
  return { ...setup, tested: setup.ledger, ledger };
}

async function plannedClass(api = loadCore()) {
  const setup = await approvedClass(api);
  const ledger = await api.planClassActivation(
    setup.ledger,
    'candidate_class_001',
    {
      stages: [
        { target_agent_ids: ['agent_a'] },
        { target_agent_ids: ['agent_b'] },
      ],
      actor_id: ACTOR,
    },
    { actorId: ACTOR, now: '2026-07-26T08:07:00.000Z' },
  );
  return { ...setup, approved: setup.ledger, ledger };
}

function classStageResult(agentId, candidateSha256) {
  return [{
    agent_id: agentId,
    status: 'SUCCESS',
    applied_candidate_id: 'candidate_class_001',
    applied_candidate_sha256: candidateSha256,
  }];
}

function classRollbackResults(ledger) {
  const change = ledger.evolution.escalations.candidate_class_001;
  return change.activation.activatedAgentIds.map((agentId) => ({
    agent_id: agentId,
    status: 'SUCCESS',
    restored_version_id: change.baselineVersionByAgent[agentId],
    restored_sha256: change.baselineVersionSha256ByAgent[agentId],
  }));
}

function classObservationEvidence(ledger, overrides = {}) {
  const change = ledger.evolution.escalations.candidate_class_001;
  const activeVersionByAgent = {};
  change.affectedAgentIds.forEach((agentId) => {
    activeVersionByAgent[agentId] = ledger.activeVersionByAgent[agentId];
  });
  return {
    candidate_id: change.candidateId,
    candidate_sha256: change.candidateBundleSha256,
    target_agent_ids: [...change.affectedAgentIds],
    target_list_sha256: change.targetListSha256,
    active_version_by_agent: activeVersionByAgent,
    healthyRuns: 20,
    regressionCount: 0,
    ...overrides,
  };
}

async function stagedClass(api = loadCore()) {
  const setup = await plannedClass(api);
  const stageOne = await api.activateClassStage(
    setup.ledger,
    'candidate_class_001',
    0,
    classStageResult('agent_a', setup.candidateHash),
    { actorId: ACTOR, now: '2026-07-26T08:08:00.000Z' },
  );
  const ledger = await api.activateClassStage(
    stageOne,
    'candidate_class_001',
    1,
    classStageResult('agent_b', setup.candidateHash),
    { actorId: ACTOR, now: '2026-07-26T08:09:00.000Z' },
  );
  return { ...setup, stageOne, ledger };
}

async function publishedClass(api = loadCore()) {
  const setup = await stagedClass(api);
  const ledger = await api.publishClassChange(
    setup.ledger,
    'candidate_class_001',
    { actorId: ACTOR, now: '2026-07-26T08:10:00.000Z' },
  );
  return { ...setup, staged: setup.ledger, ledger };
}

function bulkSpec(operationType, operationId = `bulk_${operationType}`) {
  return {
    operation_id: operationId,
    operation_type: operationType,
    target_agent_ids: ['agent_b', 'agent_a'],
    impact: {
      summary: `Impact for ${operationType}`,
      exactTargetCount: 2,
      consequences: ['schedule or configuration changes'],
    },
    payload: {
      action: operationType,
      sharedGeneId: operationType === 'shared_gene_change'
        ? 'shared_gene_profitability'
        : null,
    },
    before_state_by_target: {
      agent_a: { state: 'before_a', enabled: true },
      agent_b: { state: 'before_b', enabled: true },
    },
    desired_state_by_target: {
      agent_a: { state: 'after_a', enabled: false },
      agent_b: { state: 'after_b', enabled: false },
    },
    actor_id: ACTOR,
  };
}

async function previewedBulk(
  api = loadCore(),
  operationType = 'schedule_pause',
  operationId,
) {
  const base = await makeLedger(api);
  const spec = bulkSpec(operationType, operationId);
  const ledger = await api.createBulkOperation(
    base,
    spec,
    { actorId: ACTOR, now: NOW },
  );
  const id = spec.operation_id;
  return { api, base, spec, id, ledger };
}

async function confirmedBulk(
  api = loadCore(),
  operationType = 'schedule_pause',
  operationId,
) {
  const setup = await previewedBulk(api, operationType, operationId);
  const operation = setup.ledger.evolution.bulkOperations[setup.id];
  const ledger = await api.confirmBulkOperation(
    setup.ledger,
    setup.id,
    {
      target_agent_ids: operation.targetAgentIds,
      target_list_sha256: operation.targetListSha256,
      impact_sha256: operation.impactSha256,
      payload_sha256: operation.payloadSha256,
      actor_id: ACTOR,
    },
    { actorId: ACTOR, now: '2026-07-26T09:01:00.000Z' },
  );
  return { ...setup, previewed: setup.ledger, ledger };
}

async function plannedBulk(
  api = loadCore(),
  operationType = 'schedule_pause',
  operationId,
) {
  const setup = await confirmedBulk(api, operationType, operationId);
  const ledger = await api.planBulkActivation(
    setup.ledger,
    setup.id,
    {
      stages: [['agent_a'], ['agent_b']],
      actor_id: ACTOR,
    },
    { actorId: ACTOR, now: '2026-07-26T09:02:00.000Z' },
  );
  return { ...setup, confirmed: setup.ledger, ledger };
}

function bulkStageResult(operation, agentId, overrides = {}) {
  return [{
    agent_id: agentId,
    status: 'SUCCESS',
    before_state_sha256: operation.beforeStateSha256ByTarget[agentId],
    after_state_sha256: operation.desiredStateSha256ByTarget[agentId],
    ...overrides,
  }];
}

function bulkObservationEvidence(operation, overrides = {}) {
  return {
    operation_id: operation.operationId,
    operation_type: operation.operationType,
    target_agent_ids: [...operation.targetAgentIds],
    target_list_sha256: operation.targetListSha256,
    desired_state_sha256_by_target: {
      ...operation.desiredStateSha256ByTarget,
    },
    healthyTargets: operation.targetAgentIds.length,
    regressions: 0,
    ...overrides,
  };
}

test('core exposes only ES5 syntax and deterministic canonical SHA-256', async () => {
  assert.doesNotMatch(coreSource, /=>/);
  assert.doesNotMatch(coreSource, /\b(?:const|let)\b/);
  assert.doesNotMatch(coreSource, /\basync\s+function\b/);
  assert.doesNotMatch(coreSource, /`/);

  const api = loadCore();
  assert.equal(
    api.canonical({ z: 1, a: { d: 4, c: 3 } }),
    api.canonical({ a: { c: 3, d: 4 }, z: 1 }),
  );
  assert.equal(
    await api.sha256({ z: 1, a: { d: 4, c: 3 } }),
    await api.sha256({ a: { c: 3, d: 4 }, z: 1 }),
  );
  assert.throws(
    () => api.canonical({ unsafe: undefined }),
    (error) => error.code === 'CANONICAL_UNSUPPORTED_TYPE',
  );
  assert.throws(
    () => api.canonical({ unsafe: Infinity }),
    (error) => error.code === 'CANONICAL_NON_FINITE',
  );
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(
    () => api.canonical(cyclic),
    (error) => error.code === 'CANONICAL_CYCLE',
  );
  await rejectsCode(
    loadCore({ withCrypto: false }).sha256({ a: 1 }),
    'SHA256_UNAVAILABLE',
  );
});

test('fleet projection is an exact platformAgentId union with checker truth', () => {
  const api = loadCore();
  const exactError = 'agent.model_profile = «claude»: клиентские агенты работают только на Qwen';
  const exactWarning = 'agent.immutable_bundle_id пуст — без него не доказать сборку';
  const platform = [
    {
      platform_agent_id: 'platform_1',
      name: 'Одинаковое имя',
      provider: 'alibaba',
      model: 'qwen-3.7',
      last_activity_at: '2026-07-26T07:59:00.000Z',
    },
    {
      agent_id: 'platform_2',
      name: 'Другой агент',
      provider: 'anthropic',
      model: 'claude',
    },
    {
      platformAgentId: 'platform_3',
      name: 'Без паспорта',
      provider: 'alibaba',
      model: 'qwen-3.7',
    },
  ];
  const standards = [
    {
      platform_agent_id: 'platform_1',
      cabinet: cabinet({
        name: 'Паспортное имя',
        genome: [{
          capability: 'Общий расчёт',
          version: '1.0.0',
          provenance: 'global',
          expert: 'profitability_calculation',
          shared_handler: null,
          rules: [],
          concepts: [],
        }],
      }),
      checker_report: { errors: [], warnings: [exactWarning] },
    },
    {
      platformAgentId: 'platform_2',
      cabinet: cabinet({
        name: 'Другой агент',
        model: 'claude',
        genome: [],
      }),
      passportCheck: { errors: [exactError], warnings: [] },
    },
    {
      platformAgentId: 'dead_registry_ref',
      name: 'Одинаковое имя',
      cabinet: cabinet({
        name: 'Одинаковое имя',
        owner: 'Владелец dead ref',
        genome: [],
      }),
      validation: { errors: [], warnings: [] },
    },
  ];
  const beforePlatform = plain(platform);
  const beforeStandards = plain(standards);

  const fleet = api.buildFleetProjection(platform, standards);
  const rows = Object.fromEntries(
    plain(fleet.rows).map((row) => [row.platformAgentId, row]),
  );

  assert.deepEqual(
    plain(fleet.rows.map((row) => row.platformAgentId)),
    ['dead_registry_ref', 'platform_1', 'platform_2', 'platform_3'],
  );
  assert.equal(fleet.counts.total, 4);
  assert.equal(fleet.counts.passportMissing, 1);
  assert.equal(fleet.counts.deadReferences, 1);
  assert.equal(fleet.counts.standardFailed, 1);
  assert.equal(rows.platform_1.name, 'Одинаковое имя');
  assert.deepEqual(rows.platform_1.checker.errors, []);
  assert.deepEqual(rows.platform_1.checker.warnings, [exactWarning]);
  assert.deepEqual(rows.platform_2.checker.errors, [exactError]);
  assert.equal(rows.platform_2.standardStatus, 'FAIL');
  assert.equal(rows.platform_2.capabilityCount, 0);
  assert.equal(rows.platform_2.capabilityCountState, 'KNOWN');
  assert.equal(rows.platform_2.hasSharedGenes, false);
  assert.equal(rows.platform_2.hasSharedGenesState, 'KNOWN');
  assert.equal(rows.platform_3.standardStatus, 'PASSPORT_MISSING');
  assert.equal(rows.platform_3.owner, null);
  assert.equal(rows.platform_3.ownerState, 'UNKNOWN');
  assert.equal(rows.dead_registry_ref.standardStatus, 'DEAD_REFERENCE');
  assert.deepEqual(rows.dead_registry_ref.reconciliationRisks, [{
    code: 'DEAD_REFERENCE',
    platformAgentId: 'dead_registry_ref',
  }]);
  assert.deepEqual(platform, beforePlatform);
  assert.deepEqual(standards, beforeStandards);
  assert.equal(Object.isFrozen(fleet), true);
  assert.equal(Object.isFrozen(fleet.rows[0]), true);
  assert.throws(
    () => api.buildFleetProjection(
      [{ id: 'exact_id', name: 'Same' }],
      [{ name: 'Same', checker: { errors: [], warnings: [] } }],
    ),
    (error) => error.code === 'STANDARDS_PLATFORM_AGENT_ID_REQUIRED',
  );
});

test('Shared Genes map is exact, bidirectional, stable and Cabinet uses the same N', async () => {
  const api = loadCore();
  const sharedGenome = [{
    capability: 'Общая прибыльность',
    version: '1.0.0',
    provenance: 'global',
    expert: 'profitability_calculation',
    shared_handler: 'handler_profitability',
    rules: ['rule_margin'],
    concepts: ['knowledge_margin'],
  }];
  const fleet = {
    rows: [
      {
        platformAgentId: 'agent_a',
        activeVersion: '1.0.0',
        cabinet: cabinet({
          name: 'A',
          genome: sharedGenome.concat([{
            capability: 'Только A',
            version: '1.0.0',
            provenance: 'global',
            shared_handler: 'handler_only_a',
            expert: null,
            rules: [],
            concepts: [],
          }]),
        }),
      },
      {
        platformAgentId: 'agent_b',
        activeVersion: '1.1.0',
        cabinet: cabinet({ name: 'B', genome: sharedGenome }),
      },
    ],
  };
  const first = await api.buildSharedGenesMap(fleet, [{
    platformAgentId: 'agent_c',
    kind: 'handler',
    objectId: 'handler_profitability',
    activeVersion: '2.0.0',
    lastChangedAt: '2026-07-26T07:00:00.000Z',
  }]);
  const reordered = await api.buildSharedGenesMap({
    rows: fleet.rows.slice().reverse(),
  }, [{
    platformAgentId: 'agent_c',
    kind: 'handler',
    objectId: 'handler_profitability',
    activeVersion: '2.0.0',
    lastChangedAt: '2026-07-26T07:00:00.000Z',
  }]);
  const handler = first.genes.find(
    (gene) => gene.kind === 'handler'
      && gene.objectId === 'handler_profitability',
  );

  assert.ok(handler.geneId.startsWith('shared_gene_'));
  assert.equal(handler.consumerCount, 3);
  assert.deepEqual(
    plain(handler.consumerAgentIds),
    ['agent_a', 'agent_b', 'agent_c'],
  );
  assert.equal(
    first.byAgentId.agent_a.find((gene) => gene.geneId === handler.geneId)
      .otherConsumerCount,
    2,
  );
  assert.equal(api.cabinetSharedGeneCount(first, 'agent_a', handler.geneId), 2);
  assert.equal(api.cabinetSharedGeneCount(first, 'agent_b', handler.geneId), 2);
  assert.equal(first.byGeneId[handler.geneId].consumerCount, 3);
  assert.equal(first.mapSha256, reordered.mapSha256);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.byAgentId.agent_a), true);

  await rejectsCode(
    api.buildSharedGenesMap(fleet, [{
      platformAgentId: 'agent_c',
      kind: 'handler',
      objectId: 'different_handler',
      geneId: handler.geneId,
    }]),
    'SHARED_GENE_ID_COLLISION',
  );
  assert.throws(
    () => api.cabinetSharedGeneCount(first, 'agent_a', 'missing_gene'),
    (error) => error.code === 'SHARED_GENE_CONSUMER_NOT_FOUND',
  );

  const canonical = await api.buildSharedGenesMap({
    rows: [
      {
        platform_agent_id: 'canonical_a',
        shared_genes: [{
          gene_id: 'shared_gene_exact_from_adapter',
          gene_kind: 'handler',
          object_id: 'canonical_handler',
          name: 'Canonical handler',
          active_version: '3.0.0',
        }],
        cabinet: cabinet({ name: 'Canonical A', genome: [] }),
      },
      {
        platform_agent_id: 'canonical_b',
        shared_genes: [{
          gene_id: 'shared_gene_exact_from_adapter',
          gene_kind: 'handler',
          object_id: 'canonical_handler',
          name: 'Canonical handler',
          active_version: '3.0.0',
        }],
        cabinet: cabinet({ name: 'Canonical B', genome: [] }),
      },
    ],
  }, [{
    platform_agent_id: 'canonical_c',
    gene_id: 'shared_gene_exact_from_adapter',
    gene_kind: 'handler',
    object_id: 'canonical_handler',
    active_version: '3.0.1',
  }]);
  assert.equal(
    canonical.byGeneId.shared_gene_exact_from_adapter.consumerCount,
    3,
  );
  assert.equal(
    canonical.byGeneId.shared_gene_exact_from_adapter.displayName,
    'Canonical handler',
    'the canonical Agent Passport name must reach the Shared Gene UI projection',
  );
  assert.equal(
    api.cabinetSharedGeneCount(
      canonical,
      'canonical_a',
      'shared_gene_exact_from_adapter',
    ),
    2,
  );
});

test('Cabinet class escalation completes the gated Evolution Loop in the same ledger', async () => {
  const setup = await publishedClass();
  const { api } = setup;
  const published = setup.ledger;
  const change = published.evolution.escalations.candidate_class_001;

  assert.equal(setup.base.evolution, undefined);
  assert.equal(published.schemaVersion, setup.base.schemaVersion);
  assert.ok(published.versions.version_a_v1);
  assert.ok(published.versions.version_b_v1);
  assert.equal(change.status, 'PUBLISHED');
  assert.equal(
    published.activeVersionByAgent.agent_a,
    change.candidateVersionId,
  );
  assert.equal(
    published.activeVersionByAgent.agent_b,
    change.candidateVersionId,
  );
  assert.equal(
    published.versions[change.candidateVersionId].bundleSha256,
    setup.candidateHash,
  );
  assert.equal(
    await api.sha256(published.versions[change.candidateVersionId].bundle),
    setup.candidateHash,
  );
  const targetReceipts = Object.values(published.evolution.receipts)
    .filter((receipt) => receipt.type === 'CLASS_TARGET_ACTIVATED');
  assert.deepEqual(
    targetReceipts.map((receipt) => receipt.platformAgentId).sort(),
    ['agent_a', 'agent_b'],
  );

  const observed = await api.recordClassObservation(
    published,
    'candidate_class_001',
    classObservationEvidence(published),
    { actorId: ACTOR, now: '2026-07-26T08:11:00.000Z' },
  );
  const observationReceipt = Object.values(observed.evolution.receipts)
    .find((receipt) => receipt.type === 'CLASS_CHANGE_OBSERVED');
  assert.equal(
    observationReceipt.candidateBundleSha256,
    change.candidateBundleSha256,
  );
  assert.deepEqual(
    plain(observationReceipt.activeVersionByAgent),
    plain(classObservationEvidence(published).active_version_by_agent),
  );
  const rolledBack = await api.rollbackClassChange(
    observed,
    'candidate_class_001',
    classRollbackResults(observed),
    { actorId: ACTOR, now: '2026-07-26T08:12:00.000Z' },
  );
  assert.equal(
    rolledBack.evolution.escalations.candidate_class_001.status,
    'ROLLED_BACK',
  );
  assert.deepEqual(plain(rolledBack.activeVersionByAgent), {
    agent_a: 'version_a_v1',
    agent_b: 'version_b_v1',
  });
  assert.equal(
    rolledBack.evolution.escalations.candidate_class_001.rollback.oneAction,
    true,
  );
  assert.equal(
    rolledBack.evolution.escalations.candidate_class_001.rollback.verifiedExact,
    true,
  );
  assert.equal(Object.isFrozen(rolledBack), true);
  assert.equal(setup.base.evolution, undefined);
});

test('Cabinet escalation rejects wrong scope, targets, hash and unsafe Evolution Lab evidence', async () => {
  const api = loadCore();
  const base = await makeLedger(api);
  const candidate = classCandidate();
  const candidateHash = await api.sha256(candidate);
  const contract = {
    candidate_id: 'negative_candidate',
    candidate_sha256: candidateHash,
    candidate_bundle: candidate,
    scope: { kind: 'class' },
    affected_agent_ids: ['agent_a', 'agent_b'],
    actor_id: ACTOR,
  };

  await rejectsCode(
    api.acceptCabinetEscalation(base, {
      ...contract,
      candidate_sha256: HASH_ZERO,
    }, { actorId: ACTOR }),
    'CANDIDATE_SHA256_MISMATCH',
  );
  await rejectsCode(
    api.acceptCabinetEscalation(base, {
      ...contract,
      scope: { kind: 'agent' },
    }, { actorId: ACTOR }),
    'CLASS_SCOPE_REQUIRED',
  );
  await rejectsCode(
    api.acceptCabinetEscalation(base, {
      ...contract,
      affected_agent_ids: ['agent_a', 'unknown_agent'],
    }, { actorId: ACTOR }),
    'UNKNOWN_EVOLUTION_TARGET',
  );
  await rejectsCode(
    api.acceptCabinetEscalation(base, {
      ...contract,
      candidate_bundle: { agents: { agent_a: {} } },
      candidate_sha256: await api.sha256({ agents: { agent_a: {} } }),
    }, { actorId: ACTOR }),
    'CANDIDATE_BUNDLE_INCOMPLETE',
  );

  const accepted = await acceptedClass(api);
  const acceptedChange =
    accepted.ledger.evolution.escalations.candidate_class_001;
  await rejectsCode(
    api.recordClassTest(
      accepted.ledger,
      'candidate_class_001',
      classTestEvidence(acceptedChange, {
        externalWrites: [{ system: 'crm', action: 'write' }],
      }),
      { actorId: ACTOR },
    ),
    'CLASS_TEST_SIDE_EFFECTS',
  );
  const mismatched = classTestEvidence(acceptedChange);
  mismatched.after_cases[0].input.amount = 101;
  await rejectsCode(
    api.recordClassTest(
      accepted.ledger,
      'candidate_class_001',
      mismatched,
      { actorId: ACTOR },
    ),
    'CLASS_TEST_CASE_MISMATCH',
  );
  await rejectsCode(
    api.recordClassTest(
      accepted.ledger,
      'candidate_class_001',
      classTestEvidence(acceptedChange, {
        target_agent_ids: ['agent_a'],
      }),
      { actorId: ACTOR },
    ),
    'CLASS_TEST_TARGET_MISMATCH',
  );
  await rejectsCode(
    api.recordClassTest(
      accepted.ledger,
      'candidate_class_001',
      classTestEvidence(acceptedChange, {
        candidate_sha256: HASH_ZERO,
      }),
      { actorId: ACTOR },
    ),
    'CLASS_TEST_BINDING_MISMATCH',
  );
  await rejectsCode(
    api.recordClassTest(
      accepted.ledger,
      'candidate_class_001',
      classTestEvidence(acceptedChange, {
        target_list_sha256: HASH_ZERO,
      }),
      { actorId: ACTOR },
    ),
    'CLASS_TEST_BINDING_MISMATCH',
  );
});

test('class observation requires exact target, candidate and current-version read-back', async () => {
  const setup = await publishedClass();
  const valid = classObservationEvidence(setup.ledger);

  await rejectsCode(
    setup.api.recordClassObservation(
      setup.ledger,
      'candidate_class_001',
      { ...valid, candidate_sha256: HASH_ZERO },
      { actorId: ACTOR },
    ),
    'CLASS_OBSERVATION_BINDING_MISMATCH',
  );
  await rejectsCode(
    setup.api.recordClassObservation(
      setup.ledger,
      'candidate_class_001',
      { ...valid, target_agent_ids: ['agent_a'] },
      { actorId: ACTOR },
    ),
    'CLASS_OBSERVATION_BINDING_MISMATCH',
  );
  const staleVersion = {
    ...valid,
    active_version_by_agent: {
      ...valid.active_version_by_agent,
      agent_a: 'version_a_v1',
    },
  };
  await rejectsCode(
    setup.api.recordClassObservation(
      setup.ledger,
      'candidate_class_001',
      staleVersion,
      { actorId: ACTOR },
    ),
    'CLASS_OBSERVATION_CURRENT_VERSION_MISMATCH',
  );
});

test('candidate mutation after test invalidates test and target-bound approval', async () => {
  const setup = await testedClass();
  const { api } = setup;
  const tested = plain(setup.ledger);
  tested.evolution.escalations.candidate_class_001
    .candidateBundle.evolutionChange.desiredVersion =
      '2.0.1-mutated-after-test';
  const change = tested.evolution.escalations.candidate_class_001;

  await rejectsCode(
    api.approveClassChange(tested, change.candidateId, {
      target_agent_ids: change.affectedAgentIds,
      target_list_sha256: change.targetListSha256,
      candidate_sha256: change.candidateBundleSha256,
      test_receipt_sha256: change.test.receiptSha256,
      actor_id: ACTOR,
    }, { actorId: ACTOR }),
    'CABINET_ESCALATION_TAMPERED',
  );

  await rejectsCode(
    api.approveClassChange(setup.ledger, change.candidateId, {
      target_agent_ids: ['agent_a'],
      target_list_sha256: change.targetListSha256,
      candidate_sha256: change.candidateBundleSha256,
      test_receipt_sha256: change.test.receiptSha256,
      actor_id: ACTOR,
    }, { actorId: ACTOR }),
    'CLASS_APPROVAL_TARGET_MISMATCH',
  );
  await rejectsCode(
    api.approveClassChange(setup.ledger, change.candidateId, {
      target_agent_ids: change.affectedAgentIds,
      target_list_sha256: change.targetListSha256,
      candidate_sha256: HASH_ZERO,
      test_receipt_sha256: change.test.receiptSha256,
      actor_id: ACTOR,
    }, { actorId: ACTOR }),
    'CLASS_APPROVAL_EVIDENCE_MISMATCH',
  );
});

test('class activation cannot bypass approval, stage order, exact plan or full staging', async () => {
  const tested = await testedClass();
  await rejectsCode(
    tested.api.planClassActivation(
      tested.accepted,
      'candidate_class_001',
      { stages: [['agent_a'], ['agent_b']], actor_id: ACTOR },
      { actorId: ACTOR },
    ),
    'CLASS_ACTIVATION_REQUIRES_APPROVAL',
  );

  const approved = await approvedClass(tested.api);
  await rejectsCode(
    approved.api.planClassActivation(
      approved.ledger,
      'candidate_class_001',
      { stages: [['agent_a']], actor_id: ACTOR },
      { actorId: ACTOR },
    ),
    'INVALID_CLASS_ACTIVATION_PLAN',
  );

  const planned = await plannedClass(tested.api);
  await rejectsCode(
    planned.api.activateClassStage(
      planned.ledger,
      'candidate_class_001',
      0,
      classStageResult('agent_a', HASH_ZERO),
      { actorId: ACTOR },
    ),
    'CLASS_STAGE_CANDIDATE_MISMATCH',
  );
  await rejectsCode(
    planned.api.activateClassStage(
      planned.ledger,
      'candidate_class_001',
      1,
      classStageResult('agent_b', planned.candidateHash),
      { actorId: ACTOR },
    ),
    'CLASS_STAGE_ORDER_MISMATCH',
  );
  const tamperedPlan = plain(planned.ledger);
  const stages = tamperedPlan.evolution.escalations.candidate_class_001
    .activation.stages;
  stages[0].targetAgentIds = ['agent_b'];
  await rejectsCode(
    planned.api.activateClassStage(
      tamperedPlan,
      'candidate_class_001',
      0,
      classStageResult('agent_b', planned.candidateHash),
      { actorId: ACTOR },
    ),
    'CLASS_ACTIVATION_PLAN_TAMPERED',
  );

  const stageOne = await planned.api.activateClassStage(
    planned.ledger,
    'candidate_class_001',
    0,
    classStageResult('agent_a', planned.candidateHash),
    { actorId: ACTOR },
  );
  await rejectsCode(
    planned.api.publishClassChange(
      stageOne,
      'candidate_class_001',
      { actorId: ACTOR },
    ),
    'CLASS_PUBLISH_REQUIRES_STAGED_ACTIVATION',
  );
});

test('class rollback verifies exact immutable baseline hash', async () => {
  const setup = await publishedClass();
  const wrongReadBack = classRollbackResults(setup.ledger);
  wrongReadBack[0].restored_sha256 = HASH_ZERO;
  await rejectsCode(
    setup.api.rollbackClassChange(
      setup.ledger,
      'candidate_class_001',
      wrongReadBack,
      { actorId: ACTOR },
    ),
    'CLASS_ROLLBACK_RESULT_MISMATCH',
  );
  const tampered = plain(setup.ledger);
  tampered.versions.version_a_v1.bundle.agents.agent_a.agent.name =
    'tampered_baseline';
  await rejectsCode(
    setup.api.rollbackClassChange(
      tampered,
      'candidate_class_001',
      classRollbackResults(tampered),
      { actorId: ACTOR },
    ),
    'CABINET_ESCALATION_TAMPERED',
  );
});

test('all allowed bulk operation types require gates and emit per-target receipts with exact rollback', async () => {
  const operationTypes = [
    'shared_gene_change',
    'schedule_pause',
    'schedule_resume',
    'dead_reference_remove',
  ];

  for (const [index, operationType] of operationTypes.entries()) {
    const api = loadCore();
    const operationId = `bulk_full_${index}_${operationType}`;
    const setup = await plannedBulk(api, operationType, operationId);
    let operation = setup.ledger.evolution.bulkOperations[operationId];
    const stageOne = await api.activateBulkStage(
      setup.ledger,
      operationId,
      0,
      bulkStageResult(operation, 'agent_a'),
      { actorId: ACTOR, now: '2026-07-26T09:03:00.000Z' },
    );
    operation = stageOne.evolution.bulkOperations[operationId];
    const staged = await api.activateBulkStage(
      stageOne,
      operationId,
      1,
      bulkStageResult(operation, 'agent_b'),
      { actorId: ACTOR, now: '2026-07-26T09:04:00.000Z' },
    );
    const published = await api.publishBulkOperation(
      staged,
      operationId,
      { actorId: ACTOR, now: '2026-07-26T09:05:00.000Z' },
    );
    const observed = await api.recordBulkObservation(
      published,
      operationId,
      bulkObservationEvidence(
        published.evolution.bulkOperations[operationId],
      ),
      { actorId: ACTOR, now: '2026-07-26T09:06:00.000Z' },
    );
    operation = observed.evolution.bulkOperations[operationId];
    const observationReceipt = Object.values(observed.evolution.receipts)
      .find((receipt) => (
        receipt.type === 'BULK_OPERATION_OBSERVED'
          && receipt.operationId === operationId
      ));
    assert.deepEqual(
      plain(observationReceipt.desiredStateSha256ByTarget),
      plain(operation.desiredStateSha256ByTarget),
    );
    const rollbackResults = operation.targetAgentIds.map((agentId) => ({
      agent_id: agentId,
      status: 'SUCCESS',
      restored_state_sha256:
        operation.beforeStateSha256ByTarget[agentId],
    }));
    const rolledBack = await api.rollbackBulkOperation(
      observed,
      operationId,
      rollbackResults,
      { actorId: ACTOR, now: '2026-07-26T09:07:00.000Z' },
    );
    operation = rolledBack.evolution.bulkOperations[operationId];

    assert.equal(operation.operationType, operationType);
    assert.equal(operation.status, 'ROLLED_BACK');
    assert.equal(operation.rollback.oneAction, true);
    assert.equal(operation.rollback.verifiedExact, true);
    const receipts = Object.values(rolledBack.evolution.receipts);
    assert.deepEqual(
      receipts
        .filter((receipt) => receipt.type === 'BULK_TARGET_ACTIVATED')
        .map((receipt) => receipt.platformAgentId)
        .sort(),
      ['agent_a', 'agent_b'],
    );
    assert.deepEqual(
      receipts
        .filter((receipt) => receipt.type === 'BULK_TARGET_ROLLED_BACK')
        .map((receipt) => receipt.platformAgentId)
        .sort(),
      ['agent_a', 'agent_b'],
    );
    assert.equal(Object.isFrozen(rolledBack), true);
    assert.equal(setup.base.evolution, undefined);
  }
});

test('bulk observation requires exact targets and desired-state hash read-back', async () => {
  const api = loadCore();
  const setup = await plannedBulk(
    api,
    'schedule_pause',
    'bulk_observation_bindings',
  );
  let operation =
    setup.ledger.evolution.bulkOperations[setup.id];
  const stageOne = await api.activateBulkStage(
    setup.ledger,
    setup.id,
    0,
    bulkStageResult(operation, 'agent_a'),
    { actorId: ACTOR },
  );
  operation = stageOne.evolution.bulkOperations[setup.id];
  const staged = await api.activateBulkStage(
    stageOne,
    setup.id,
    1,
    bulkStageResult(operation, 'agent_b'),
    { actorId: ACTOR },
  );
  const published = await api.publishBulkOperation(
    staged,
    setup.id,
    { actorId: ACTOR },
  );
  operation = published.evolution.bulkOperations[setup.id];
  const valid = bulkObservationEvidence(operation);

  await rejectsCode(
    api.recordBulkObservation(
      published,
      setup.id,
      { ...valid, target_agent_ids: ['agent_a'] },
      { actorId: ACTOR },
    ),
    'BULK_OBSERVATION_BINDING_MISMATCH',
  );
  const staleDesiredState = {
    ...valid,
    desired_state_sha256_by_target: {
      ...valid.desired_state_sha256_by_target,
      agent_b: HASH_ZERO,
    },
  };
  await rejectsCode(
    api.recordBulkObservation(
      published,
      setup.id,
      staleDesiredState,
      { actorId: ACTOR },
    ),
    'BULK_OBSERVATION_DESIRED_STATE_MISMATCH',
  );
});

test('bulk operation preview rejects wildcard and unmanaged ledger targets', async () => {
  const api = loadCore();
  const base = await makeLedger(api);
  const invalidTargets = ['*', 'unknown_agent'];

  for (const [index, target] of invalidTargets.entries()) {
    const spec = bulkSpec('schedule_pause', `bulk_invalid_target_${index}`);
    spec.target_agent_ids = [target];
    spec.before_state_by_target = {
      [target]: { state: 'before', enabled: true },
    };
    spec.desired_state_by_target = {
      [target]: { state: 'after', enabled: false },
    };
    await rejectsCode(
      api.createBulkOperation(base, spec, { actorId: ACTOR }),
      'UNKNOWN_EVOLUTION_TARGET',
    );
  }

  assert.equal(base.evolution, undefined);
});

test('bulk operations reject every preview, confirmation and staged-activation bypass', async () => {
  const api = loadCore();
  const base = await makeLedger(api);
  const withoutImpact = bulkSpec('schedule_pause', 'bulk_no_impact');
  delete withoutImpact.impact;
  await rejectsCode(
    api.createBulkOperation(base, withoutImpact, { actorId: ACTOR }),
    'BULK_IMPACT_PREVIEW_REQUIRED',
  );
  await rejectsCode(
    api.createBulkOperation(base, {
      ...bulkSpec('schedule_pause', 'bulk_unsupported'),
      operation_type: 'apply_to_all_without_preview',
    }, { actorId: ACTOR }),
    'BULK_OPERATION_TYPE_UNSUPPORTED',
  );

  const previewed = await previewedBulk(
    api,
    'schedule_pause',
    'bulk_negative',
  );
  await rejectsCode(
    api.planBulkActivation(
      previewed.ledger,
      previewed.id,
      { stages: [['agent_a'], ['agent_b']], actor_id: ACTOR },
      { actorId: ACTOR },
    ),
    'BULK_ACTIVATION_REQUIRES_CONFIRMATION',
  );
  const operation = previewed.ledger.evolution.bulkOperations[previewed.id];
  await rejectsCode(
    api.confirmBulkOperation(previewed.ledger, previewed.id, {
      target_agent_ids: ['agent_a'],
      target_list_sha256: operation.targetListSha256,
      impact_sha256: operation.impactSha256,
      payload_sha256: operation.payloadSha256,
      actor_id: ACTOR,
    }, { actorId: ACTOR }),
    'BULK_CONFIRMATION_MISMATCH',
  );
  const changedPayload = plain(previewed.ledger);
  changedPayload.evolution.bulkOperations[previewed.id].payload.action =
    'mutated_after_preview';
  await rejectsCode(
    api.confirmBulkOperation(changedPayload, previewed.id, {
      target_agent_ids: operation.targetAgentIds,
      target_list_sha256: operation.targetListSha256,
      impact_sha256: operation.impactSha256,
      payload_sha256: operation.payloadSha256,
      actor_id: ACTOR,
    }, { actorId: ACTOR }),
    'BULK_OPERATION_TAMPERED',
  );

  const planned = await plannedBulk(
    api,
    'schedule_pause',
    'bulk_negative_planned',
  );
  let plannedOperation =
    planned.ledger.evolution.bulkOperations[planned.id];
  await rejectsCode(
    api.activateBulkStage(
      planned.ledger,
      planned.id,
      1,
      bulkStageResult(plannedOperation, 'agent_b'),
      { actorId: ACTOR },
    ),
    'BULK_STAGE_ORDER_MISMATCH',
  );
  await rejectsCode(
    api.activateBulkStage(
      planned.ledger,
      planned.id,
      0,
      bulkStageResult(plannedOperation, 'agent_a', {
        after_state_sha256: HASH_ZERO,
      }),
      { actorId: ACTOR },
    ),
    'BULK_STAGE_STATE_MISMATCH',
  );
  const tamperedPlan = plain(planned.ledger);
  tamperedPlan.evolution.bulkOperations[planned.id]
    .activation.stages[0].targetAgentIds = ['agent_b'];
  plannedOperation =
    tamperedPlan.evolution.bulkOperations[planned.id];
  await rejectsCode(
    api.activateBulkStage(
      tamperedPlan,
      planned.id,
      0,
      bulkStageResult(plannedOperation, 'agent_b'),
      { actorId: ACTOR },
    ),
    'BULK_ACTIVATION_PLAN_TAMPERED',
  );

  plannedOperation = planned.ledger.evolution.bulkOperations[planned.id];
  const stageOne = await api.activateBulkStage(
    planned.ledger,
    planned.id,
    0,
    bulkStageResult(plannedOperation, 'agent_a'),
    { actorId: ACTOR },
  );
  await rejectsCode(
    api.publishBulkOperation(
      stageOne,
      planned.id,
      { actorId: ACTOR },
    ),
    'BULK_PUBLISH_REQUIRES_STAGED_ACTIVATION',
  );
  const stageOneOperation =
    stageOne.evolution.bulkOperations[planned.id];
  await rejectsCode(
    api.rollbackBulkOperation(
      stageOne,
      planned.id,
      [{
        agent_id: 'agent_a',
        status: 'SUCCESS',
        restored_state_sha256: HASH_ZERO,
      }],
      { actorId: ACTOR },
    ),
    'BULK_ROLLBACK_STATE_MISMATCH',
  );
  assert.notEqual(
    stageOneOperation.beforeStateSha256ByTarget.agent_a,
    HASH_ZERO,
  );
});
