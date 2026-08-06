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
  'evolution-trusted-publish-contract.js',
), 'utf8');

function loadContract() {
  const context = { ETB: {} };
  vm.runInNewContext(source, context, {
    filename: 'evolution-trusted-publish-contract.js',
  });
  return context.ETB.evolutionTrustedPublishContract;
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

function success(overrides = {}) {
  return {
    status: 'published',
    agent_id: 'agent_publish_alpha',
    version_before: '1.2.3',
    version_after: '1.2.4',
    read_back: {
      id: 'readback_20260730_a',
      confirmed: true,
      source: 'agent/get',
      at: '2026-07-30T12:00:00Z',
    },
    receipt_id: 'receipt_20260730_a',
    rollback: rollback(),
    ...overrides,
  };
}

function publicError(code, overrides = {}) {
  const base = {
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
  if (code === 'GATE_MISSING') base.gate = 'PLAYGROUND_GREEN';
  if (code === 'PUBLISH_REJECTED') {
    base.platform_reason = 'platform rejected the exact draft';
  }
  if (code === 'READ_BACK_FAILED') {
    base.receipt_id = 'receipt_20260730_a';
    base.rollback = rollback();
  }
  return { ...base, ...overrides };
}

function rejectsCode(work, code) {
  return assert.throws(work, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

test('trusted publish request has exactly three pre-write evidence refs', () => {
  const contract = loadContract();
  const normalized = contract.normalizeRequest(request());

  assert.deepEqual(JSON.parse(JSON.stringify(normalized)), request());
  assert.deepEqual(
    Array.from(contract.PREWRITE_GATE_CODES),
    ['IMPACT_ANALYZED', 'PLAYGROUND_GREEN', 'ROLLBACK_AVAILABLE'],
  );
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.gates), true);
});

test('client cannot pass READ_BACK_CONFIRMED as a pre-write gate', () => {
  const contract = loadContract();
  const invalid = request({
    gates: {
      ...request().gates,
      READ_BACK_CONFIRMED: 'forged_readback',
    },
  });

  rejectsCode(
    () => contract.normalizeRequest(invalid),
    'TRUSTED_PUBLISH_REQUEST_INVALID',
  );
});

test('successful publish requires host-created read-back evidence and rollback', () => {
  const contract = loadContract();
  const normalizedRequest = contract.normalizeRequest(request());
  const normalized = contract.normalizeSuccess(success(), normalizedRequest);

  assert.equal(normalized.status, 'published');
  assert.equal(normalized.read_back.id, 'readback_20260730_a');
  assert.equal(normalized.read_back.confirmed, true);
  assert.equal(normalized.read_back.source, 'agent/get');
  assert.equal(normalized.receipt_id, 'receipt_20260730_a');
  assert.deepEqual(
    JSON.parse(JSON.stringify(normalized.rollback)),
    rollback(),
  );

  rejectsCode(
    () => contract.normalizeSuccess(success({
      read_back: {
        confirmed: true,
        source: 'agent/get',
        at: '2026-07-30T12:00:00Z',
      },
    }), normalizedRequest),
    'TRUSTED_PUBLISH_RESPONSE_INVALID',
  );
  rejectsCode(
    () => contract.normalizeSuccess(success({
      rollback: { ...rollback(), to_version: '0.9.0' },
    }), normalizedRequest),
    'TRUSTED_PUBLISH_RESPONSE_INVALID',
  );
});

test('public outcomes are localized, bounded and preserve required evidence', () => {
  const contract = loadContract();
  const readBackFailure = contract.normalizePublicError(
    publicError('READ_BACK_FAILED'),
    'READ_BACK_FAILED',
  );
  assert.equal(readBackFailure.receipt_id, 'receipt_20260730_a');
  assert.equal(readBackFailure.rollback.available, true);

  const unknown = contract.unknownOutcome();
  assert.equal(unknown.code, 'PUBLISH_OUTCOME_UNKNOWN');
  assert.match(unknown.next_step_en, /same key/i);

  rejectsCode(
    () => contract.normalizePublicError(
      publicError('PUBLISH_REJECTED', { platform_reason: null }),
      'PUBLISH_REJECTED',
    ),
    'TRUSTED_PUBLISH_ERROR_INVALID',
  );
  rejectsCode(
    () => contract.normalizePublicError(
      publicError('GATE_MISSING', { gate: 'READ_BACK_CONFIRMED' }),
      'GATE_MISSING',
    ),
    'TRUSTED_PUBLISH_ERROR_INVALID',
  );
});

test('response and public error projection reject secret-like fields and values', () => {
  const contract = loadContract();
  const normalizedRequest = contract.normalizeRequest(request());

  rejectsCode(
    () => contract.normalizeSuccess(success({
      rollback: {
        ...rollback(),
        how: 'Bearer abcdefghijklmnop',
      },
    }), normalizedRequest),
    'TRUSTED_PUBLISH_RESPONSE_INVALID',
  );
  rejectsCode(
    () => contract.normalizePublicError(
      publicError('PUBLISH_REJECTED', {
        platform_reason: 'Bearer abcdefghijklmnop',
      }),
      'PUBLISH_REJECTED',
    ),
    'TRUSTED_PUBLISH_ERROR_INVALID',
  );
});
