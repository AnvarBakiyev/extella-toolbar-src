'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { TextEncoder } = require('node:util');

const toolbarRoot = path.resolve(__dirname, '..');
const corePath = path.join(toolbarRoot, 'src', 'core', 'agent-control.js');
const buildPath = path.join(toolbarRoot, 'build.js');
const coreSource = fs.readFileSync(corePath, 'utf8');

const IDS = {
  oneC: 'agent_real_one_c',
  target: 'agent_real_targetologist',
  auditor: 'agent_real_auditor',
};

const AGENTS = [
  {
    id: IDS.oneC,
    name: 'Агент 1С',
    role: 'one_c_controller',
    provider: 'alibaba',
    model: 'qwen-3.7',
  },
  {
    id: IDS.target,
    name: 'Агент-таргетолог',
    role: 'targetologist',
    provider: 'alibaba',
    model: 'qwen-3.7',
  },
  {
    id: IDS.auditor,
    name: 'Агент-аудитор',
    role: 'auditor',
    provider: 'alibaba',
    model: 'qwen-3.7',
  },
];

const INVENTORIES = {
  [IDS.oneC]: {
    agent: {
      id: IDS.oneC,
      name: 'Агент 1С',
      tools: ['read_1c_stock', 'read_1c_sales'],
      instructionsSha256: '1'.repeat(64),
      instructionsPreview: 'Read-only financial controller',
    },
    hashes: {
      agent: 'a'.repeat(64),
      concepts: 'b'.repeat(64),
      rules: 'c'.repeat(64),
      experts: 'd'.repeat(64),
      full: 'e'.repeat(64),
    },
    counts: { concepts: 2, rules: 1, experts: 2, tools: 2 },
    concepts: [
      {
        id: 'knowledge_margin_formula',
        text: 'Маржа учитывает себестоимость, возвраты, комиссию, логистику и рекламу.',
        scope: 'agent',
      },
      {
        id: 'knowledge_one_c_stock',
        text: 'Остатки доступны только агенту 1С.',
        scope: 'agent',
      },
    ],
    rules: [
      {
        id: 'rule_one_c_local_reconciliation',
        text: 'Сверять регистры перед финансовым выводом.',
        scope: 'agent',
      },
    ],
    experts: [
      {
        name: 'profitability_calculation',
        description: 'Deterministic contribution margin calculation',
        version: 'CALC_V1',
        scope: 'global',
      },
      {
        name: 'one_c_read_only',
        description: 'Read 1C without writes',
        version: '1.0.0',
        scope: 'agent',
      },
    ],
    processes: [
      { id: 'process_stock_replenishment', name: 'Пополнение запасов' },
    ],
  },
  [IDS.target]: {
    agent: {
      id: IDS.target,
      name: 'Агент-таргетолог',
      tools: ['read_ad_metrics'],
      instructionsSha256: '2'.repeat(64),
      instructionsPreview: 'Read-only campaign planner',
    },
    hashes: {
      agent: 'f'.repeat(64),
      concepts: '1'.repeat(64),
      rules: '2'.repeat(64),
      experts: '3'.repeat(64),
      full: '4'.repeat(64),
    },
    counts: { concepts: 2, rules: 1, experts: 2, tools: 1 },
    concepts: [
      {
        id: 'knowledge_margin_formula',
        text: 'Маржа учитывает себестоимость, возвраты, комиссию, логистику и рекламу.',
        scope: 'agent',
      },
      {
        id: 'knowledge_campaign_limits',
        text: 'Локальные ограничения рекламной кампании.',
        scope: 'agent',
      },
    ],
    rules: [
      {
        id: 'rule_target_local_brand_safety',
        text: 'Не использовать запрещённые формулировки.',
        scope: 'agent',
      },
    ],
    experts: [
      {
        name: 'profitability_calculation',
        description: 'Deterministic contribution margin calculation',
        version: 'CALC_V1',
        scope: 'global',
      },
      {
        name: 'campaign_read_only',
        description: 'Read campaign metrics without writes',
        version: '1.0.0',
        scope: 'agent',
      },
    ],
    processes: [
      { id: 'process_campaign_budget', name: 'Управление рекламным бюджетом' },
    ],
  },
  [IDS.auditor]: {
    agent: {
      id: IDS.auditor,
      name: 'Агент-аудитор',
      tools: ['read_evidence'],
      instructionsSha256: '3'.repeat(64),
      instructionsPreview: 'Read-only evidence auditor',
    },
    hashes: {
      agent: '5'.repeat(64),
      concepts: '6'.repeat(64),
      rules: '7'.repeat(64),
      experts: '8'.repeat(64),
      full: '9'.repeat(64),
    },
    counts: { concepts: 1, rules: 1, experts: 1, tools: 1 },
    concepts: [
      {
        id: 'knowledge_audit_retention',
        text: 'Локальная политика хранения evidence.',
        scope: 'agent',
      },
    ],
    rules: [
      {
        id: 'rule_auditor_local_retention',
        text: 'Проверять срок хранения evidence.',
        scope: 'agent',
      },
    ],
    experts: [
      {
        name: 'evidence_reader',
        description: 'Read evidence receipts',
        version: '1.0.0',
        scope: 'agent',
      },
    ],
    processes: [
      { id: 'process_evidence_audit', name: 'Аудит evidence' },
    ],
  },
};

const TIMES = {
  baseline: '2026-07-25T08:00:00.000Z',
  draft: '2026-07-25T08:05:00.000Z',
  test: '2026-07-25T08:10:00.000Z',
  testSecond: '2026-07-25T08:11:00.000Z',
  publish: '2026-07-25T08:15:00.000Z',
  rollback: '2026-07-25T08:20:00.000Z',
  republish: '2026-07-25T08:25:00.000Z',
  activeRun: '2026-07-25T08:30:00.000Z',
};

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
  return context.ETB.agentControl;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

async function baseline(control = loadCore()) {
  const ledger = await control.newLedger(AGENTS, INVENTORIES, {
    ownerAgentId: IDS.oneC,
    actorId: 'actor_owner',
    now: TIMES.baseline,
  });
  return { control, ledger };
}

async function drafted(control = loadCore()) {
  const setup = await baseline(control);
  const ledger = await control.createDraft(setup.ledger, {
    scope: { kind: 'selected', agentIds: [IDS.oneC, IDS.target] },
    capabilityId: 'profitability_calculation',
    actorId: 'actor_owner',
    now: TIMES.draft,
  });
  return { control, baseline: setup.ledger, ledger };
}

async function tested(control = loadCore()) {
  const setup = await drafted(control);
  const ledger = await control.runPlayground(
    setup.ledger,
    setup.ledger.currentDraftId,
    null,
    { actorId: 'actor_owner', now: TIMES.test },
  );
  return {
    control,
    baseline: setup.baseline,
    draft: setup.ledger,
    ledger,
  };
}

async function published(control = loadCore()) {
  const setup = await tested(control);
  const ledger = await control.publishDraft(
    setup.ledger,
    setup.ledger.currentDraftId,
    setup.ledger.currentTestRunId,
    { actorId: 'actor_owner', now: TIMES.publish },
  );
  return { ...setup, tested: setup.ledger, ledger };
}

test('ACC-01: canonical SHA-256 baseline captures two+ real agents and immutable V1 pointers', async () => {
  const { control, ledger } = await baseline();
  const baselineVersion = ledger.versions[ledger.baselineVersionId];

  assert.equal(control.canonical({ z: 1, a: { y: 2, x: 3 } }), '{"a":{"x":3,"y":2},"z":1}');
  assert.equal(ledger.ownerAgentId, IDS.oneC);
  assert.equal(ledger.ownerAccountId, 'actor_owner');
  assert.deepEqual(Object.keys(ledger.agents).sort(), Object.values(IDS).sort());
  assert.ok(Object.values(ledger.activeVersionByAgent).every(
    (versionId) => versionId === ledger.baselineVersionId,
  ));
  assert.equal(baselineVersion.status, 'PUBLISHED');
  assert.equal(baselineVersion.immutable, true);
  assert.match(baselineVersion.bundleSha256, /^[a-f0-9]{64}$/);
  assert.equal(
    await control.sha256(baselineVersion.bundle),
    baselineVersion.bundleSha256,
  );
  assert.deepEqual(
    plain(baselineVersion.bundle.agents[IDS.oneC].agent.tools),
    ['read_1c_stock', 'read_1c_sales'],
  );
  assert.deepEqual(
    plain(baselineVersion.bundle.agents[IDS.oneC].inventoryHashes),
    INVENTORIES[IDS.oneC].hashes,
  );
  assert.deepEqual(
    plain(baselineVersion.bundle.agents[IDS.oneC].inventoryCounts),
    INVENTORIES[IDS.oneC].counts,
  );
  assert.equal(control.validateLedger(ledger), true);
  assert.equal(Object.isFrozen(ledger), true);
  assert.equal(Object.isFrozen(baselineVersion.bundle), true);
  assert.throws(() => {
    ledger.activeVersionByAgent[IDS.oneC] = 'mutated';
  }, TypeError);
});

test('ACC-01: SHA-256 fails closed when WebCrypto is unavailable', async () => {
  const control = loadCore({ withCrypto: false });
  await assert.rejects(
    control.sha256({ safe: true }),
    (error) => error && error.code === 'SHA256_UNAVAILABLE',
  );
});

test('ACC-01: ledger rejects missing inventories, duplicate agents, and foreign owner scope', async () => {
  const control = loadCore();
  await assert.rejects(
    control.newLedger(AGENTS.slice(0, 2), {}, {
      ownerAgentId: IDS.oneC,
      now: TIMES.baseline,
    }),
    (error) => error && error.code === 'INVENTORY_REQUIRED',
  );
  await assert.rejects(
    control.newLedger([AGENTS[0], AGENTS[0]], INVENTORIES, {
      ownerAgentId: IDS.oneC,
      now: TIMES.baseline,
    }),
    (error) => error && error.code === 'DUPLICATE_AGENT',
  );
  await assert.rejects(
    control.newLedger(AGENTS, INVENTORIES, {
      ownerAgentId: 'agent_from_another_namespace',
      now: TIMES.baseline,
    }),
    (error) => error && error.code === 'INVALID_LEDGER_OWNER',
  );
});

test('ACC-02: draft has strict 20% business rule and is inert before publication', async () => {
  const { control, baseline: original, ledger } = await drafted();
  const draft = ledger.drafts[ledger.currentDraftId];

  assert.equal(draft.status, 'DRAFT');
  assert.equal(draft.rule.text, control.BUSINESS_RULE_TEXT);
  assert.equal(draft.rule.condition.field, 'actual_margin_bps');
  assert.equal(draft.rule.condition.operator, '<');
  assert.equal(draft.rule.condition.value, 2000);
  assert.deepEqual(
    plain(ledger.activeVersionByAgent),
    plain(original.activeVersionByAgent),
  );
  assert.equal(Object.keys(ledger.versions).length, 1);
  assert.equal(original.currentDraftId, null);
  assert.equal(Object.keys(original.drafts).length, 0);
  assert.equal(
    control.canonical(original.versions[original.baselineVersionId].bundle),
    control.canonical(ledger.versions[ledger.baselineVersionId].bundle),
  );
  assert.equal(Object.isFrozen(draft), true);

  await assert.rejects(
    control.createDraft(original, {
      scope: { kind: 'selected', agentIds: [IDS.oneC, IDS.target] },
      capabilityId: 'profitability_calculation',
      thresholdBps: 2500,
      now: TIMES.draft,
    }),
    (error) => error && error.code === 'INVALID_BUSINESS_RULE',
  );
});

test('ACC-02: one, selected, and organization scopes resolve only real agent ids', async () => {
  const { control, ledger } = await baseline();
  const one = await control.createDraft(ledger, {
    scope: { kind: 'one', agentId: IDS.oneC },
    capabilityId: 'profitability_calculation',
    now: TIMES.draft,
  });
  const organization = await control.createDraft(ledger, {
    scope: { kind: 'organization' },
    capabilityId: 'profitability_calculation',
    now: TIMES.draft,
  });

  assert.deepEqual(
    plain(control.analyzeImpact(one, one.currentDraftId).agentIds),
    [IDS.oneC],
  );
  assert.deepEqual(
    plain(control.analyzeImpact(organization, organization.currentDraftId).agentIds),
    Object.values(IDS).sort(),
  );
  await assert.rejects(
    control.createDraft(ledger, {
      scope: { kind: 'selected', agentIds: [IDS.oneC, 'agent_unknown'] },
      capabilityId: 'profitability_calculation',
      now: TIMES.draft,
    }),
    (error) => error && error.code === 'UNKNOWN_AGENT',
  );
});

test('ACC-03/11: impact is derived from selected ids and actual shared-capability consumers', async () => {
  const { control, ledger } = await drafted();
  const impact = control.analyzeImpact(ledger, ledger.currentDraftId);

  assert.deepEqual(plain(impact.agentIds), [IDS.oneC, IDS.target].sort());
  assert.equal(impact.agentCount, impact.agentIds.length);
  assert.ok(!impact.agentIds.includes(IDS.auditor));
  assert.deepEqual(
    plain(impact.processIds),
    ['process_campaign_budget', 'process_stock_replenishment'],
  );
  assert.deepEqual(plain(impact.capabilityIds), ['profitability_calculation']);
  assert.deepEqual(plain(impact.knowledgeIds), []);
  assert.ok(impact.availableKnowledgeIds.includes('knowledge_margin_formula'));
  assert.ok(impact.availableKnowledgeIds.includes('knowledge_one_c_stock'));
  assert.ok(impact.availableKnowledgeIds.includes('knowledge_campaign_limits'));
  assert.deepEqual(
    plain(impact.sharedCapabilityConsumers),
    [{
      capabilityId: 'profitability_calculation',
      consumerAgentIds: [IDS.oneC, IDS.target].sort(),
      consumerCount: 2,
    }],
  );
  assert.equal(
    ledger.versions[ledger.baselineVersionId]
      .bundle.sharedCapabilities.profitability_calculation.consumerAgentIds.length,
    2,
  );
});

test('ACC-03 adversarial: tampered draft impact or draft hash is rejected before testing', async () => {
  const { control, ledger } = await drafted();
  const draftId = ledger.currentDraftId;
  const impactTampered = plain(ledger);
  const hashTampered = plain(ledger);

  impactTampered.drafts[draftId].impact.agentIds.push(IDS.auditor);
  impactTampered.drafts[draftId].impact.agentCount += 1;
  await assert.rejects(
    control.runPlayground(
      impactTampered,
      draftId,
      null,
      { actorId: 'actor_owner', now: TIMES.test },
    ),
    (error) => error && error.code === 'DRAFT_IMPACT_MISMATCH',
  );

  hashTampered.drafts[draftId].draftSha256 = '0'.repeat(64);
  await assert.rejects(
    control.runPlayground(
      hashTampered,
      draftId,
      null,
      { actorId: 'actor_owner', now: TIMES.test },
    ),
    (error) => error && error.code === 'DRAFT_HASH_MISMATCH',
  );
});

test('ACC-04/05: playground proves 18/20/30 behavior, strict boundary, diff, evidence, and zero writes', async () => {
  const { control, draft, ledger } = await tested();
  const testRun = ledger.testRuns[ledger.currentTestRunId];
  const draftValue = ledger.drafts[ledger.currentDraftId];

  assert.equal(testRun.status, 'PASSED');
  assert.equal(testRun.mode, 'DRY_RUN');
  assert.deepEqual(plain(testRun.coverage), {
    below: true,
    boundary: true,
    above: true,
  });
  assert.deepEqual(plain(testRun.externalWrites), []);
  assert.equal(testRun.writeAttempts, 0);
  assert.equal(testRun.draftSha256, draftValue.draftSha256);
  assert.equal(testRun.candidateVersionId, draftValue.candidateVersionId);
  assert.equal(testRun.candidateBundleSha256, draftValue.candidateBundleSha256);
  assert.deepEqual(
    plain(testRun.changedAgentIds),
    [IDS.oneC, IDS.target].sort(),
  );

  const below = testRun.cases.find((row) => row.marginBps === 1800);
  const boundary = testRun.cases.find((row) => row.marginBps === 2000);
  const above = testRun.cases.find((row) => row.marginBps === 3000);
  assert.ok(below && boundary && above);
  assert.ok(below.agentResults.every((row) => row.changed));
  assert.ok(below.agentResults.every(
    (row) => row.after.firedRuleIds.includes(control.BUSINESS_RULE_ID),
  ));
  assert.ok(below.agentResults.every(
    (row) => row.before.configurationVersionId === ledger.baselineVersionId,
  ));
  assert.ok(below.agentResults.every(
    (row) => row.after.configurationVersionId === draftValue.candidateVersionId,
  ));
  assert.ok(boundary.agentResults.every((row) => !row.changed));
  assert.ok(boundary.agentResults.every((row) => row.after.firedRuleIds.length === 0));
  assert.ok(above.agentResults.every((row) => !row.changed));
  assert.deepEqual(plain(testRun.knowledgeIds), []);
  assert.deepEqual(plain(testRun.usedKnowledgeIds), []);
  assert.deepEqual(plain(testRun.capabilityIds), ['profitability_calculation']);
  assert.deepEqual(plain(testRun.usedCapabilityIds), ['profitability_calculation']);
  assert.deepEqual(plain(testRun.firedRuleIds), [control.BUSINESS_RULE_ID]);
  assert.equal(testRun.assertions.allPassed, true);
  assert.ok(testRun.assertions.cases.every((row) => row.passed === true));
  assert.ok(below.agentResults.every(
    (row) => row.after.availableKnowledgeIds.includes('knowledge_margin_formula'),
  ));
  assert.ok(below.agentResults.every(
    (row) => row.after.availableCapabilityIds.includes('profitability_calculation'),
  ));
  assert.ok(below.agentResults.every(
    (row) => row.after.usedKnowledgeIds.length === 0,
  ));
  assert.ok(below.agentResults.every(
    (row) => plain(row.after.usedCapabilityIds).join(',') === 'profitability_calculation',
  ));
  assert.ok(testRun.plannedActions.includes('STOP_OR_REVIEW_CAMPAIGN'));
  assert.ok(testRun.plannedActions.includes('FLAG_LOW_MARGIN_FOR_REVIEW'));
  assert.ok(testRun.cases.every(
    (row) => row.writeAttempts === 0 && row.externalWrites.length === 0,
  ));
  assert.equal(draft.currentTestRunId, null);
  assert.equal(Object.keys(draft.testRuns).length, 0);
  assert.deepEqual(
    plain(draft.activeVersionByAgent),
    plain(ledger.activeVersionByAgent),
  );
});

test('ACC-05: identical evidence executed at different times receives distinct TestRun ids', async () => {
  const { control, ledger: draftLedger } = await drafted();
  const first = await control.runPlayground(
    draftLedger,
    draftLedger.currentDraftId,
    null,
    { actorId: 'actor_owner', now: TIMES.test },
  );
  const firstId = first.currentTestRunId;
  const second = await control.runPlayground(
    first,
    first.currentDraftId,
    null,
    { actorId: 'actor_owner', now: TIMES.testSecond },
  );
  const secondId = second.currentTestRunId;

  assert.notEqual(firstId, secondId);
  assert.equal(first.testRuns[firstId].completedAt, TIMES.test);
  assert.equal(second.testRuns[secondId].completedAt, TIMES.testSecond);
  assert.equal(Object.keys(second.testRuns).length, 2);
  assert.notEqual(
    second.testRuns[firstId].receiptSha256,
    second.testRuns[secondId].receiptSha256,
  );
});

test('ACC-06: publication rejects missing, failed, mismatched, and stale TestRun evidence', async () => {
  const { control, ledger: draftLedger } = await drafted();
  await assert.rejects(
    control.publishDraft(draftLedger, draftLedger.currentDraftId, 'missing'),
    (error) => error && error.code === 'TEST_RUN_NOT_FOUND',
  );

  const failedLedger = await control.runPlayground(
    draftLedger,
    draftLedger.currentDraftId,
    [{ id: 'only-below', marginBps: 1800 }],
    { now: TIMES.test },
  );
  assert.equal(failedLedger.testRuns[failedLedger.currentTestRunId].status, 'FAILED');
  await assert.rejects(
    control.publishDraft(
      failedLedger,
      failedLedger.currentDraftId,
      failedLedger.currentTestRunId,
    ),
    (error) => error && error.code === 'TEST_RUN_NOT_GREEN',
  );

  const greenLedger = await control.runPlayground(
    draftLedger,
    draftLedger.currentDraftId,
    null,
    { now: TIMES.test },
  );
  const newerDraftLedger = await control.createDraft(greenLedger, {
    scope: { kind: 'one', agentId: IDS.oneC },
    capabilityId: 'profitability_calculation',
    now: '2026-07-25T08:11:00.000Z',
  });
  await assert.rejects(
    control.publishDraft(
      newerDraftLedger,
      newerDraftLedger.currentDraftId,
      greenLedger.currentTestRunId,
    ),
    (error) => error && error.code === 'STALE_TEST_RUN',
  );
});

test('ACC-06 adversarial: tampered TestRun assertions and receipt evidence block publish', async () => {
  const { control, ledger } = await tested();
  const draftId = ledger.currentDraftId;
  const testRunId = ledger.currentTestRunId;
  const assertionTampered = plain(ledger);
  const receiptTampered = plain(ledger);

  assertionTampered.testRuns[testRunId].assertions.allPassed = false;
  await assert.rejects(
    control.publishDraft(
      assertionTampered,
      draftId,
      testRunId,
      { actorId: 'actor_owner', now: TIMES.publish },
    ),
    (error) => error && error.code === 'TEST_RUN_ASSERTIONS_FAILED',
  );

  receiptTampered.testRuns[testRunId].cases[0]
    .agentResults[0].after.plannedActions.push('UNVERIFIED_ACTION');
  await assert.rejects(
    control.publishDraft(
      receiptTampered,
      draftId,
      testRunId,
      { actorId: 'actor_owner', now: TIMES.publish },
    ),
    (error) => error && error.code === 'TEST_RUN_RECEIPT_MISMATCH',
  );
});

test('ACC-07: publish atomically switches exactly two pointers and records immutable V2 audit', async () => {
  const { ledger, tested: before } = await published();
  const draft = ledger.drafts[ledger.currentDraftId];
  const publication = ledger.audit[ledger.audit.length - 1];

  assert.equal(ledger.activeVersionByAgent[IDS.oneC], draft.candidateVersionId);
  assert.equal(ledger.activeVersionByAgent[IDS.target], draft.candidateVersionId);
  assert.equal(ledger.activeVersionByAgent[IDS.auditor], ledger.baselineVersionId);
  assert.equal(before.activeVersionByAgent[IDS.oneC], before.baselineVersionId);
  assert.equal(before.activeVersionByAgent[IDS.target], before.baselineVersionId);
  assert.equal(Object.keys(before.versions).length, 1);
  assert.equal(Object.keys(ledger.versions).length, 2);
  assert.equal(ledger.versions[draft.candidateVersionId].immutable, true);
  assert.equal(Object.prototype.hasOwnProperty.call(draft, 'candidateBundle'), false);
  assert.equal(
    ledger.versions[draft.candidateVersionId].bundleSha256,
    draft.candidateBundleSha256,
  );
  assert.equal(publication.type, 'PUBLISHED');
  assert.equal(publication.status, 'SUCCESS');
  assert.equal(publication.actorId, 'actor_owner');
  assert.equal(publication.at, TIMES.publish);
  assert.equal(publication.testRunId, ledger.currentTestRunId);
  assert.deepEqual(
    plain(publication.impactedAgentIds),
    [IDS.oneC, IDS.target].sort(),
  );
  assert.equal(publication.changeSetSha256, draft.draftSha256);
});

test('ACC-07: injected publication failure leaves the original ledger byte-for-byte untouched', async () => {
  const { control, ledger } = await tested();
  const before = control.canonical(ledger);

  await assert.rejects(
    control.publishDraft(
      ledger,
      ledger.currentDraftId,
      ledger.currentTestRunId,
      {
        actorId: 'actor_owner',
        now: TIMES.publish,
        failBeforeCommit: true,
      },
    ),
    (error) => error && error.code === 'PUBLISH_INJECTED_FAILURE',
  );

  assert.equal(control.canonical(ledger), before);
  assert.ok(Object.values(ledger.activeVersionByAgent).every(
    (versionId) => versionId === ledger.baselineVersionId,
  ));
  assert.equal(Object.keys(ledger.versions).length, 1);
});

test('ACC-08: every active run is bound to exact config id/hash and can be immutably recorded', async () => {
  const { control, ledger } = await published();
  const oneCRun = control.runActive(ledger, IDS.oneC, {
    runId: 'run_one_c_v2',
    marginBps: 1800,
  });
  const targetRun = control.runActive(ledger, IDS.target, {
    runId: 'run_target_v2',
    marginBps: 1800,
  });
  assert.throws(
    () => control.recordRun(ledger, targetRun),
    (error) => error && error.code === 'RUN_ACTOR_REQUIRED',
  );
  const recorded = control.recordRun(ledger, targetRun, {
    actorId: 'actor_owner',
    now: TIMES.activeRun,
  });

  assert.equal(oneCRun.configurationVersionId, ledger.activeVersionByAgent[IDS.oneC]);
  assert.equal(targetRun.configurationVersionId, ledger.activeVersionByAgent[IDS.target]);
  assert.equal(
    targetRun.configurationSha256,
    ledger.versions[targetRun.configurationVersionId].bundleSha256,
  );
  assert.deepEqual(plain(targetRun.firedRuleIds), [control.BUSINESS_RULE_ID]);
  assert.deepEqual(plain(targetRun.plannedActions), ['STOP_OR_REVIEW_CAMPAIGN']);
  assert.deepEqual(plain(targetRun.externalWrites), []);
  assert.equal(targetRun.writeAttempts, 0);
  assert.equal(recorded.currentRunId, targetRun.id);
  assert.equal(recorded.runs[targetRun.id].configurationVersionId, targetRun.configurationVersionId);
  assert.equal(recorded.runs[targetRun.id].executedBy, 'actor_owner');
  assert.equal(recorded.runs[targetRun.id].executedAt, TIMES.activeRun);
  assert.equal(ledger.currentRunId, null);
  assert.equal(Object.keys(ledger.runs).length, 0);
  assert.equal(Object.isFrozen(recorded.runs[targetRun.id]), true);
  assert.throws(
    () => control.recordRun(recorded, targetRun, {
      actorId: 'actor_owner',
      now: '2026-07-25T08:31:00.000Z',
    }),
    (error) => error && error.code === 'RUN_ID_COLLISION',
  );
});

test('ACC-09: rollback restores exact immutable V1 hash/pointers without creating a copy', async () => {
  const { control, ledger } = await published();
  const versionCount = Object.keys(ledger.versions).length;
  const baselineCanonical = control.canonical(
    ledger.versions[ledger.baselineVersionId].bundle,
  );
  const rolledBack = await control.rollback(
    ledger,
    ledger.baselineVersionId,
    { actorId: 'actor_owner', now: TIMES.rollback },
  );
  const receipt = rolledBack.audit[rolledBack.audit.length - 1];

  assert.ok(Object.values(rolledBack.activeVersionByAgent).every(
    (versionId) => versionId === ledger.baselineVersionId,
  ));
  assert.equal(Object.keys(rolledBack.versions).length, versionCount);
  assert.equal(
    control.canonical(rolledBack.versions[rolledBack.baselineVersionId].bundle),
    baselineCanonical,
  );
  assert.equal(
    receipt.restoredSha256,
    rolledBack.versions[rolledBack.baselineVersionId].bundleSha256,
  );
  assert.equal(receipt.targetVersionId, rolledBack.baselineVersionId);
  assert.equal(receipt.restoredVersionId, rolledBack.baselineVersionId);
  assert.equal(receipt.verifiedExact, true);
  assert.equal(receipt.copyCreated, false);
  assert.equal(Object.keys(rolledBack.versions).some((id) => /copy/i.test(id)), false);

  const activeRun = control.runActive(rolledBack, IDS.target, {
    runId: 'run_target_after_rollback',
    marginBps: 1800,
  });
  assert.equal(activeRun.configurationVersionId, rolledBack.baselineVersionId);
  assert.deepEqual(plain(activeRun.firedRuleIds), []);
  assert.deepEqual(plain(activeRun.plannedActions), ['INCREASE_AD_BUDGET']);
});

test('ACC-10: local rules and knowledge remain isolated in baseline, V2, and active receipts', async () => {
  const { control, ledger } = await published();
  const v2 = ledger.versions[ledger.activeVersionByAgent[IDS.target]];
  const oneCInventory = v2.bundle.agents[IDS.oneC];
  const targetInventory = v2.bundle.agents[IDS.target];
  const oneCRun = control.runActive(ledger, IDS.oneC, {
    runId: 'run_one_c_isolation',
    marginBps: 3000,
  });
  const targetRun = control.runActive(ledger, IDS.target, {
    runId: 'run_target_isolation',
    marginBps: 3000,
  });

  assert.deepEqual(
    plain(oneCInventory.localRules.map((row) => row.id)),
    ['rule_one_c_local_reconciliation'],
  );
  assert.deepEqual(
    plain(targetInventory.localRules.map((row) => row.id)),
    ['rule_target_local_brand_safety'],
  );
  assert.ok(!targetRun.availableLocalRuleIds.includes('rule_one_c_local_reconciliation'));
  assert.ok(!targetRun.availableKnowledgeIds.includes('knowledge_one_c_stock'));
  assert.deepEqual(plain(targetRun.usedKnowledgeIds), []);
  assert.ok(!oneCRun.availableLocalRuleIds.includes('rule_target_local_brand_safety'));
  assert.ok(!oneCRun.availableKnowledgeIds.includes('knowledge_campaign_limits'));
  assert.deepEqual(plain(oneCRun.usedKnowledgeIds), []);
});

test('ACC-09 replay: rollback then identical candidate reuses immutable V2 byte-for-byte', async () => {
  const first = await published();
  const { control } = first;
  const firstPublished = first.ledger;
  const v2Id = firstPublished.activeVersionByAgent[IDS.oneC];
  const firstV2 = control.canonical(firstPublished.versions[v2Id]);
  const originalDraftId = firstPublished.currentDraftId;
  const originalTestRunId = firstPublished.currentTestRunId;
  const rolledBack = await control.rollback(
    firstPublished,
    firstPublished.baselineVersionId,
    { actorId: 'actor_owner', now: TIMES.rollback },
  );
  const replayDraft = await control.createDraft(rolledBack, {
    scope: { kind: 'selected', agentIds: [IDS.oneC, IDS.target] },
    capabilityId: 'profitability_calculation',
    actorId: 'actor_owner',
    now: TIMES.draft,
  });
  const replayTest = await control.runPlayground(
    replayDraft,
    replayDraft.currentDraftId,
    null,
    { actorId: 'actor_owner', now: TIMES.test },
  );
  const replayPublished = await control.publishDraft(
    replayTest,
    replayTest.currentDraftId,
    replayTest.currentTestRunId,
    { actorId: 'actor_owner', now: TIMES.republish },
  );
  const publication = replayPublished.audit[replayPublished.audit.length - 1];

  assert.equal(replayDraft.currentDraftId, originalDraftId);
  assert.equal(replayTest.currentTestRunId, originalTestRunId);
  assert.equal(replayPublished.activeVersionByAgent[IDS.oneC], v2Id);
  assert.equal(replayPublished.activeVersionByAgent[IDS.target], v2Id);
  assert.equal(replayPublished.activeVersionByAgent[IDS.auditor], replayPublished.baselineVersionId);
  assert.equal(Object.keys(replayPublished.versions).length, 2);
  assert.equal(control.canonical(replayPublished.versions[v2Id]), firstV2);
  assert.equal(publication.type, 'PUBLISHED');
  assert.equal(publication.versionReused, true);
  assert.equal(publication.toVersionId, v2Id);
});

test('ACC-11: unknown shared dependency fails closed instead of reporting zero impact', async () => {
  const { control, ledger } = await baseline();
  await assert.rejects(
    control.createDraft(ledger, {
      scope: { kind: 'selected', agentIds: [IDS.oneC, IDS.target] },
      capabilityId: 'invented_shared_capability',
      now: TIMES.draft,
    }),
    (error) => error && error.code === 'SHARED_CAPABILITY_NOT_FOUND',
  );
});

test('build loads the ES5 Evolution cores and standards provider after api.js', () => {
  const build = fs.readFileSync(buildPath, 'utf8');
  assert.match(
    build,
    /'api\.js',\s*\n\s*'agent-control\.js',\s*\n\s*'evolution-console\.js',\s*\n\s*'evolution-automation-registry\.js',\s*\n\s*'evolution-standards-provider\.js',\s*\n\s*'install-prompt\.js'/,
  );
  assert.match(
    build,
    /throw new Error\(`Missing required core module: \$\{name\}`\)/,
  );
  assert.match(
    build,
    /providerCount !== 1[\s\S]*providerUseMarker[\s\S]*providerMarker/,
  );
  assert.doesNotMatch(coreSource, /\brequire\s*\(/);
  assert.doesNotMatch(coreSource, /=>/);
  assert.doesNotMatch(coreSource, /\b(?:const|let)\s+[A-Za-z_$]/);
});
