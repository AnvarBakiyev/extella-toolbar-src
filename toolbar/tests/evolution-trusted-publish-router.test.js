'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const toolbarRoot = path.resolve(__dirname, '..');
const router = fs.readFileSync(path.join(
  toolbarRoot,
  'src',
  'core',
  'router.js',
), 'utf8');
const contractSource = fs.readFileSync(path.join(
  toolbarRoot,
  'src',
  'core',
  'evolution-trusted-publish-contract.js',
), 'utf8');

const SNAPSHOT = 'fleet_snapshot_current';

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function request(overrides = {}) {
  return {
    type: 'etb_evolution_console',
    reqId: 'request_1',
    action: 'etb_evolution_publish',
    snapshotId: SNAPSHOT,
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
      at: '2026-07-30T12:00:00Z',
    },
    receipt_id: 'receipt_20260730_a',
    rollback: rollback(),
  };
}

function publicError(code, overrides = {}) {
  const result = {
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
  if (code === 'GATE_MISSING') result.gate = 'PLAYGROUND_GREEN';
  if (code === 'PUBLISH_REJECTED') {
    result.platform_reason = 'platform rejected exact draft';
  }
  if (code === 'READ_BACK_FAILED') {
    result.receipt_id = 'receipt_20260730_a';
    result.rollback = rollback();
  }
  return { ...result, ...overrides };
}

function session(snapshotId = SNAPSHOT, complete = true) {
  return { snapshotId, complete };
}

function routeSlice() {
  const start = router.indexOf('  function _evolutionTrustedPublishRequest(');
  const end = router.indexOf('  function _evolutionLastReceipt(', start);
  assert.ok(start >= 0 && end > start, 'trusted publish route must be extractable');
  return router.slice(start, end);
}

function harness(options = {}) {
  const calls = [];
  const captures = { fleetLoads: 0, contextChecks: 0 };
  const context = {
    ETB: {
      evolutionAdapter: options.adapter || {},
    },
    Promise,
    JSON,
    Date,
    __initialSession: options.initialSession || session(),
    __freshSession: options.freshSession || session(),
    calls,
    captures,
  };
  vm.runInNewContext(contractSource, context, {
    filename: 'evolution-trusted-publish-contract.js',
  });
  if (typeof context.ETB.evolutionAdapter.publishTrustedDraft === 'function') {
    const original = context.ETB.evolutionAdapter.publishTrustedDraft;
    context.ETB.evolutionAdapter.publishTrustedDraft = function (payload) {
      calls.push(plain(payload));
      return original(payload);
    };
  }
  vm.runInNewContext(`
    var _evolutionFleetSession = __initialSession;
    function _evolutionError(code, message) {
      var error = new Error(message || code);
      error.code = code;
      return error;
    }
    function _evolutionClone(value) {
      return value == null ? value : JSON.parse(JSON.stringify(value));
    }
    function _evolutionRequireClosedKeys(value, expected, code, label) {
      var actual;
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw _evolutionError(code, label + ' must be an object');
      }
      actual = Object.keys(value).sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected.slice().sort())) {
        throw _evolutionError(code, label + ' contains unsupported or missing fields');
      }
    }
    function _evolutionRequireSession(data, context, requireComplete) {
      var current = _evolutionFleetSession;
      if (!current || String(data && data.snapshotId || '') !== current.snapshotId) {
        throw _evolutionError('FLEET_SNAPSHOT_MISMATCH');
      }
      if (requireComplete && current.complete !== true) {
        throw _evolutionError('FLEET_SNAPSHOT_INCOMPLETE');
      }
      return current;
    }
    function _agentControlSerialize(ownerAgentId, context, task) {
      return Promise.resolve().then(task);
    }
    function _agentControlAssertContext() {
      captures.contextChecks += 1;
    }
    function _evolutionFleetLoad() {
      captures.fleetLoads += 1;
      _evolutionFleetSession = __freshSession;
      return Promise.resolve({
        projection: {
          snapshotId: __freshSession.snapshotId,
          complete: __freshSession.complete
        }
      });
    }
    ${routeSlice()}
    this.publish = _evolutionTrustedPublish;
  `, context, { filename: 'evolution-trusted-publish-router-slice.js' });
  return { publish: context.publish, calls, captures };
}

function rejectsCode(work, code) {
  return assert.rejects(work, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

test('trusted publish is one complete-snapshot-fenced host action', async () => {
  const runtime = harness({
    adapter: { publishTrustedDraft: () => Promise.resolve(success()) },
  });
  const result = plain(await runtime.publish(request(), {
    actorId: 'account_1',
    operationId: 'request_1',
  }));

  assert.deepEqual(result, success());
  assert.equal(runtime.captures.fleetLoads, 1);
  assert.equal(runtime.calls.length, 1);
  assert.deepEqual(runtime.calls[0], {
    request: {
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
    },
    host_context: {
      fleet_snapshot_id: SNAPSHOT,
      request_id: 'request_1',
    },
  });
  assert.equal('owner_account_id' in runtime.calls[0].host_context, false);
});

test('malformed, stale and incomplete requests never invoke the host adapter', async () => {
  const adapter = { publishTrustedDraft: () => Promise.resolve(success()) };
  const fourthGate = harness({ adapter });
  await rejectsCode(fourthGate.publish(request({
    gates: { ...request().gates, READ_BACK_CONFIRMED: 'forged' },
  }), {}), 'TRUSTED_PUBLISH_REQUEST_INVALID');
  assert.equal(fourthGate.calls.length, 0);
  assert.equal(fourthGate.captures.fleetLoads, 0);

  const stale = harness({
    adapter,
    initialSession: session('fleet_snapshot_old'),
  });
  await rejectsCode(stale.publish(request(), {}), 'FLEET_SNAPSHOT_MISMATCH');
  assert.equal(stale.calls.length, 0);
  assert.equal(stale.captures.fleetLoads, 0);

  const incomplete = harness({
    adapter,
    initialSession: session(SNAPSHOT, false),
  });
  await rejectsCode(incomplete.publish(request(), {}), 'FLEET_SNAPSHOT_INCOMPLETE');
  assert.equal(incomplete.calls.length, 0);
  assert.equal(incomplete.captures.fleetLoads, 0);
});

test('a changed live fleet stops before host publication', async () => {
  const runtime = harness({
    adapter: { publishTrustedDraft: () => Promise.resolve(success()) },
    freshSession: session('fleet_snapshot_reloaded'),
  });

  await rejectsCode(runtime.publish(request(), {}), 'FLEET_SNAPSHOT_MISMATCH');
  assert.equal(runtime.captures.fleetLoads, 1);
  assert.equal(runtime.calls.length, 0);
});

test('missing adapter makes no fallback write', async () => {
  const runtime = harness();

  await rejectsCode(
    runtime.publish(request(), {}),
    'TRUSTED_PUBLISH_ADAPTER_UNAVAILABLE',
  );
  assert.equal(runtime.calls.length, 0);
});

test('known host outcome preserves its bounded receipt and rollback details', async () => {
  const failure = new Error('read-back mismatch');
  failure.code = 'READ_BACK_FAILED';
  failure.publicError = publicError('READ_BACK_FAILED');
  const runtime = harness({
    adapter: { publishTrustedDraft: () => Promise.reject(failure) },
  });

  await assert.rejects(runtime.publish(request(), {}), (error) => {
    assert.equal(error.code, 'READ_BACK_FAILED');
    assert.equal(error.publicError.receipt_id, 'receipt_20260730_a');
    assert.equal(error.publicError.rollback.to_version, '1.2.3');
    return true;
  });
  assert.equal(runtime.calls.length, 1);
});

test('unstructured post-call failure is honest unknown outcome, never success', async () => {
  const runtime = harness({
    adapter: { publishTrustedDraft: () => Promise.reject(new Error('socket reset')) },
  });

  await assert.rejects(runtime.publish(request(), {}), (error) => {
    assert.equal(error.code, 'PUBLISH_OUTCOME_UNKNOWN');
    assert.equal(error.publicError.code, 'PUBLISH_OUTCOME_UNKNOWN');
    assert.match(error.publicError.next_step_en, /same key/i);
    return true;
  });
  assert.equal(runtime.calls.length, 1);
});

test('trusted publish has no KV, virtual-ledger or generic write escape hatch', () => {
  const slice = routeSlice();
  assert.match(slice, /publishTrustedDraft/);
  assert.match(slice, /_evolutionRequireSession\(data, context, true\)/);
  assert.match(slice, /_evolutionFleetLoad\(context\)/);
  assert.doesNotMatch(
    slice,
    /_evolutionMutation|_evolutionPersist|_evolutionReadOrCreateLedger|_agentControlWrite|kvGet|kvSet|localStorage|ETB\.api|etb_agent_control/,
  );
});
