'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const toolbarRoot = path.resolve(__dirname, '..');
const publishSource = fs.readFileSync(path.join(
  toolbarRoot,
  'src',
  'core',
  'evolution-trusted-publish-contract.js',
), 'utf8');
const contextSource = fs.readFileSync(path.join(
  toolbarRoot,
  'src',
  'core',
  'evolution-trusted-publish-context-contract.js',
), 'utf8');

const OWNER = 'account_owner';
const SNAPSHOT = 'fleet_snapshot_current';
const NOW = '2026-07-30T12:02:00Z';
const CAPTURED = '2026-07-30T12:00:00Z';

function loadContract() {
  const context = { ETB: {} };
  vm.runInNewContext(publishSource, context, {
    filename: 'evolution-trusted-publish-contract.js',
  });
  vm.runInNewContext(contextSource, context, {
    filename: 'evolution-trusted-publish-context-contract.js',
  });
  return context.ETB.evolutionTrustedPublishContextContract;
}

function request(overrides = {}) {
  return {
    draft_id: 'draft_20260730_a',
    agent_id: 'agent_publish_alpha',
    expected_version: '1.2.3',
    ledger_sha256: 'a'.repeat(64),
    gates: {
      IMPACT_ANALYZED: 'impact_20260730_a',
      PLAYGROUND_GREEN: 'run_20260730_a',
      ROLLBACK_AVAILABLE: 'rollback_1.2.3',
    },
    idempotency_key: 'publish_20260730_a',
    ...overrides,
  };
}

function rollback() {
  return {
    available: true,
    to_version: '1.2.3',
    how: 'Open the durable receipt and restore version 1.2.3.',
  };
}

function success() {
  return {
    status: 'published',
    agent_id: 'agent_publish_alpha',
    version_before: '1.2.3',
    version_after: '1.2.4',
    read_back: {
      id: 'readback_20260730_a',
      confirmed: true,
      source: 'agent/get',
      at: CAPTURED,
    },
    receipt_id: 'receipt_20260730_a',
    rollback: rollback(),
  };
}

function publicError(code, overrides = {}) {
  const output = {
    code,
    message_ru: 'Публикация не подтверждена.',
    message_en: 'Publication was not confirmed.',
    next_step_ru: 'Перечитай подготовленный черновик.',
    next_step_en: 'Re-read the prepared draft.',
    platform_reason: null,
    gate: null,
    receipt_id: null,
    rollback: null,
  };
  if (code === 'GATE_MISSING') output.gate = 'PLAYGROUND_GREEN';
  if (code === 'PUBLISH_REJECTED') {
    output.platform_reason = 'platform rejected exact draft';
  }
  if (code === 'READ_BACK_FAILED') {
    output.receipt_id = 'receipt_20260730_a';
    output.rollback = rollback();
  }
  return { ...output, ...overrides };
}

function snapshot(overrides = {}) {
  return {
    schema: 'extella.evolution.trusted_publish_context.v1.1',
    owner_account_id: OWNER,
    fleet_snapshot_id: SNAPSHOT,
    captured_at: CAPTURED,
    status: 'READY',
    error_code: null,
    subject: {
      gene_id: 'rule.filesystem_self_protection',
      kind: 'rule',
      from_version: '1.0.0',
      version: '1.1.0',
      test_case_count: 3,
    },
    request: request(),
    result: null,
    public_error: null,
    ...overrides,
  };
}

function options(overrides = {}) {
  return {
    ownerAccountId: OWNER,
    fleetSnapshotId: SNAPSHOT,
    now: NOW,
    ...overrides,
  };
}

function rejectsCode(work, code) {
  return assert.throws(work, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

test('trusted publish context accepts one exact ready host-selected request', () => {
  const contract = loadContract();
  const normalized = contract.normalize(snapshot(), options());

  assert.equal(normalized.status, 'READY');
  assert.equal(normalized.request.agent_id, 'agent_publish_alpha');
  assert.equal(normalized.subject.gene_id, 'rule.filesystem_self_protection');
  assert.equal(normalized.subject.test_case_count, 3);
  assert.equal(normalized.result, null);
  assert.equal(normalized.public_error, null);
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.request.gates), true);
  assert.deepEqual(Array.from(contract.STATUS), [
    'FAILED',
    'NO_DRAFT',
    'OUTCOME_UNKNOWN',
    'PUBLISHED',
    'READY',
    'UNAVAILABLE',
  ]);
});

test('context stays bound to exact account, fleet, freshness and closed request shape', () => {
  const contract = loadContract();

  rejectsCode(
    () => contract.normalize(snapshot({ owner_account_id: 'account_other' }), options()),
    'TRUSTED_PUBLISH_CONTEXT_ACCOUNT_MISMATCH',
  );
  rejectsCode(
    () => contract.normalize(snapshot({ fleet_snapshot_id: 'fleet_other' }), options()),
    'TRUSTED_PUBLISH_CONTEXT_SNAPSHOT_MISMATCH',
  );
  rejectsCode(
    () => contract.normalize(snapshot({ captured_at: '2026-07-30T11:00:00Z' }), options()),
    'TRUSTED_PUBLISH_CONTEXT_STALE',
  );
  rejectsCode(
    () => contract.normalize(snapshot({
      request: request({
        gates: { ...request().gates, READ_BACK_CONFIRMED: 'forged' },
      }),
    }), options()),
    'TRUSTED_PUBLISH_REQUEST_INVALID',
  );
});

test('published, failed and unknown outcomes preserve only their durable forms', () => {
  const contract = loadContract();
  const published = contract.normalize(snapshot({
    status: 'PUBLISHED',
    result: success(),
  }), options());
  const readBackFailure = contract.normalize(snapshot({
    status: 'FAILED',
    error_code: 'READ_BACK_FAILED',
    result: null,
    public_error: publicError('READ_BACK_FAILED'),
  }), options());
  const unknown = contract.normalize(snapshot({
    status: 'OUTCOME_UNKNOWN',
    error_code: 'PUBLISH_OUTCOME_UNKNOWN',
    result: null,
    public_error: publicError('PUBLISH_OUTCOME_UNKNOWN'),
  }), options());

  assert.equal(published.result.read_back.id, 'readback_20260730_a');
  assert.equal(readBackFailure.public_error.receipt_id, 'receipt_20260730_a');
  assert.equal(unknown.request.idempotency_key, 'publish_20260730_a');
  assert.equal(unknown.public_error.code, 'PUBLISH_OUTCOME_UNKNOWN');

  rejectsCode(
    () => contract.normalize(snapshot({
      status: 'OUTCOME_UNKNOWN',
      error_code: 'READ_BACK_FAILED',
      result: null,
      public_error: publicError('READ_BACK_FAILED'),
    }), options()),
    'TRUSTED_PUBLISH_CONTEXT_INVALID',
  );
  rejectsCode(
    () => contract.normalize(snapshot({
      status: 'FAILED',
      error_code: 'PUBLISH_OUTCOME_UNKNOWN',
      result: null,
      public_error: publicError('PUBLISH_OUTCOME_UNKNOWN'),
    }), options()),
    'TRUSTED_PUBLISH_CONTEXT_INVALID',
  );
});

test('no draft and unavailable context never carry a stale request or outcome', () => {
  const contract = loadContract();
  const noDraft = contract.normalize(snapshot({
    status: 'NO_DRAFT',
    subject: null,
    request: null,
  }), options());
  const unavailable = contract.unavailable({
    ownerAccountId: OWNER,
    fleetSnapshotId: SNAPSHOT,
    now: NOW,
    errorCode: 'TRUSTED_PUBLISH_CONTEXT_ADAPTER_UNAVAILABLE',
  });

  assert.equal(noDraft.request, null);
  assert.equal(noDraft.subject, null);
  assert.equal(unavailable.status, 'UNAVAILABLE');
  assert.equal(unavailable.error_code, 'TRUSTED_PUBLISH_CONTEXT_ADAPTER_UNAVAILABLE');
  assert.equal(unavailable.request, null);

  rejectsCode(
    () => contract.normalize(snapshot({
      status: 'NO_DRAFT',
      request: request(),
    }), options()),
    'TRUSTED_PUBLISH_CONTEXT_INVALID',
  );
  rejectsCode(
    () => contract.unavailable({
      ownerAccountId: OWNER,
      fleetSnapshotId: SNAPSHOT,
      now: NOW,
      errorCode: 'PUBLISH_OUTCOME_UNKNOWN',
    }),
    'TRUSTED_PUBLISH_CONTEXT_INVALID',
  );
  rejectsCode(
    () => contract.normalize(snapshot({
      subject: { ...snapshot().subject, extra: true },
    }), options()),
    'TRUSTED_PUBLISH_CONTEXT_INVALID',
  );
  rejectsCode(
    () => contract.normalize(snapshot({
      subject: { ...snapshot().subject, test_case_count: 0 },
    }), options()),
    'TRUSTED_PUBLISH_CONTEXT_INVALID',
  );
});
