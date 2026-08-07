'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const toolbarRoot = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(
  toolbarRoot,
  'src',
  'core',
  'evolution-host-adapter.js',
), 'utf8');

const SELECTION_KEY = 'xtl_evolution:trusted_publish_selection:v1';
const ACTOR = '69ba50068cd70fccde3be746';
const AGENT = 'agent_Lu25PvPrKqLn1rqINlbA_';

function canonical(value) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean' ||
      typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function sha256(value) {
  const text = typeof value === 'string' ? value : canonical(value);
  return crypto.createHash('sha256').update(text).digest('hex');
}

function fixtures() {
  const beforeBody = '# FILESYSTEM & SELF-PROTECTION\nProtect Extella files.';
  const candidateBody = `${beforeBody}\nProtect ~/.config/extella.`;
  const candidate = {
    schema: 'evolution-candidate-payload.v1',
    gene_id: 'rule.filesystem_self_protection',
    kind: 'rule',
    from_version: '1.0.0',
    version: '1.1.0',
    body: candidateBody,
    body_sha256: sha256(candidateBody),
    from_body_sha256: sha256(beforeBody),
  };
  const testPlan = {
    schema: 'evolution-test-plan.v1',
    same_inputs: true,
    cases: [
      { id: 'case_registry_card', expectation: 'flip' },
      { id: 'case_embedded_queue', expectation: 'flip' },
      { id: 'case_regression_app_support', expectation: 'unchanged' },
    ],
  };
  const before = {
    schema: 'evolution-before-snapshot.v1',
    agent_id: AGENT,
    kind: 'rule',
    native_id: null,
    native_id_source: '/api/rules/list:id',
    group_name: 'system',
    body: beforeBody,
    body_sha256: sha256(beforeBody),
    version_before: '1.0.0',
    captured_at: '2026-08-07T12:00:00Z',
    addressable: false,
  };
  const candidateRef = `xtl_evolution:candidate:${sha256(candidate).slice(0, 32)}`;
  const testPlanRef = `xtl_evolution:test_plan:${sha256(testPlan).slice(0, 32)}`;
  const beforeRef = `xtl_evolution:before:${AGENT}:${sha256(before).slice(0, 32)}`;
  const selection = {
    draft_id: 'draft_fsp_1_1_0_20260807',
    agent_id: AGENT,
    test_run_id: 'testrun_fsp_1_1_0_20260807',
    gene_id: 'rule.filesystem_self_protection',
    candidate_payload_ref: candidateRef,
    test_plan_ref: testPlanRef,
    before_ref: beforeRef,
    native_id: null,
    publish_state: 'BLOCKED_NATIVE_ID_UNAVAILABLE',
    selected_at: '2026-08-07T12:00:00Z',
    actor_id: ACTOR,
  };
  return {
    selection,
    values: {
      [SELECTION_KEY]: selection,
      [candidateRef]: candidate,
      [testPlanRef]: testPlan,
      [beforeRef]: before,
    },
  };
}

function harness(options = {}) {
  const prepared = fixtures();
  const values = options.values || prepared.values;
  const calls = [];
  const context = {
    ETB: {
      api: {
        kvGet(key, scope) {
          calls.push({ key, scope });
          if (!Object.prototype.hasOwnProperty.call(values, key)) {
            return Promise.resolve({ status: 'error', message: 'Key not found' });
          }
          return Promise.resolve({ status: 'success', value: JSON.stringify(values[key]) });
        },
      },
      auth: { getUserId: () => options.actorId || ACTOR },
      agentControl: {
        canonical,
        sha256: (value) => Promise.resolve(sha256(value)),
      },
    },
    Promise,
    JSON,
    Date,
  };
  vm.runInNewContext(source, context, { filename: 'evolution-host-adapter.js' });
  return { adapter: context.ETB.evolutionAdapter, calls, prepared };
}

function request() {
  return {
    host_context: {
      fleet_snapshot_id: 'fleet_snapshot_current',
      request_id: 'request_1',
    },
  };
}

test('host adapter verifies all three refs and exposes only a bounded blocked state', async () => {
  const runtime = harness();
  const result = JSON.parse(JSON.stringify(
    await runtime.adapter.loadTrustedPublishContext(request()),
  ));

  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.error_code, 'BLOCKED_NATIVE_ID_UNAVAILABLE');
  assert.equal(result.schema, 'extella.evolution.trusted_publish_context.v1.1');
  assert.deepEqual(result.subject, {
    gene_id: 'rule.filesystem_self_protection',
    kind: 'rule',
    from_version: '1.0.0',
    version: '1.1.0',
    test_case_count: 3,
  });
  assert.equal(result.owner_account_id, ACTOR);
  assert.equal(result.request, null);
  assert.equal(result.result, null);
  assert.equal(result.public_error, null);
  assert.deepEqual(JSON.parse(JSON.stringify(
    runtime.calls.map((call) => call.scope),
  )), [
    { global: true },
    { global: true },
    { global: true },
    { global: true },
  ]);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('xtl_evolution:'), false);
  assert.equal(serialized.includes('SELF-PROTECTION'), false);
  assert.equal(serialized.includes(AGENT), false);
  assert.equal(typeof runtime.adapter.runClassTest, 'undefined');
  assert.equal(typeof runtime.adapter.publishTrustedDraft, 'undefined');
});

test('host adapter fails closed when a content-addressed object is changed', async () => {
  const prepared = fixtures();
  const values = { ...prepared.values };
  values[prepared.selection.candidate_payload_ref] = {
    ...values[prepared.selection.candidate_payload_ref],
    body: 'tampered body',
  };
  const runtime = harness({ values });
  await assert.rejects(
    runtime.adapter.loadTrustedPublishContext(request()),
    (error) => error.code === 'TRUSTED_PUBLISH_SELECTION_CONTENT_MISMATCH',
  );
});

test('missing selection is NO_DRAFT and never guesses an agent', async () => {
  const runtime = harness({ values: {} });
  const result = JSON.parse(JSON.stringify(
    await runtime.adapter.loadTrustedPublishContext(request()),
  ));
  assert.equal(result.status, 'NO_DRAFT');
  assert.equal(result.error_code, null);
  assert.equal(result.subject, null);
  assert.equal(runtime.calls.length, 1);
});

test('selection from another account is rejected before referenced objects are read', async () => {
  const runtime = harness({ actorId: 'another_account' });
  await assert.rejects(
    runtime.adapter.loadTrustedPublishContext(request()),
    (error) => error.code === 'TRUSTED_PUBLISH_SELECTION_ACCOUNT_MISMATCH',
  );
  assert.equal(runtime.calls.length, 1);
});
