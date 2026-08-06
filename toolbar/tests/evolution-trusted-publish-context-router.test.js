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

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function request() {
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
  };
}

function readyContext(overrides = {}) {
  return {
    schema: 'extella.evolution.trusted_publish_context.v1',
    owner_account_id: OWNER,
    fleet_snapshot_id: SNAPSHOT,
    captured_at: CAPTURED,
    status: 'READY',
    error_code: null,
    request: request(),
    result: null,
    public_error: null,
    ...overrides,
  };
}

function data(overrides = {}) {
  return {
    type: 'etb_evolution_console',
    reqId: 'request_1',
    action: 'trusted_publish_context_load',
    snapshotId: SNAPSHOT,
    ...overrides,
  };
}

function session(snapshotId = SNAPSHOT, complete = true) {
  return { snapshotId, complete };
}

function contextRouteSlice() {
  const start = router.indexOf('  function _evolutionTrustedPublishContextRequest(');
  const end = router.indexOf('  function _evolutionLastReceipt(', start);
  assert.ok(start >= 0 && end > start, 'trusted publish context route must be extractable');
  return router.slice(start, end);
}

function fixedDate() {
  const RealDate = Date;
  function FixedDate(value) {
    if (arguments.length) return new RealDate(value);
    return new RealDate(NOW);
  }
  FixedDate.parse = RealDate.parse;
  FixedDate.UTC = RealDate.UTC;
  FixedDate.prototype = RealDate.prototype;
  return FixedDate;
}

function harness(options = {}) {
  const calls = [];
  const captures = { fleetLoads: 0, contextChecks: 0 };
  const adapter = options.adapter || {};
  const context = {
    ETB: { evolutionAdapter: adapter },
    Promise,
    JSON,
    Date: fixedDate(),
    __initialSession: options.initialSession || session(),
    __freshSession: options.freshSession || session(),
    calls,
    captures,
  };
  vm.runInNewContext(publishSource, context, {
    filename: 'evolution-trusted-publish-contract.js',
  });
  vm.runInNewContext(contextSource, context, {
    filename: 'evolution-trusted-publish-context-contract.js',
  });
  if (typeof adapter.loadTrustedPublishContext === 'function') {
    const original = adapter.loadTrustedPublishContext;
    adapter.loadTrustedPublishContext = function (payload) {
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
    function _evolutionRequireSession(value, context, requireComplete) {
      var current = _evolutionFleetSession;
      if (!current || String(value && value.snapshotId || '') !== current.snapshotId) {
        throw _evolutionError('FLEET_SNAPSHOT_MISMATCH');
      }
      if (requireComplete && current.complete !== true) {
        throw _evolutionError('FLEET_SNAPSHOT_INCOMPLETE');
      }
      return current;
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
    ${contextRouteSlice()}
    this.loadContext = _evolutionTrustedPublishContext;
  `, context, { filename: 'evolution-trusted-publish-context-router-slice.js' });
  return { loadContext: context.loadContext, calls, captures };
}

function rejectsCode(work, code) {
  return assert.rejects(work, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

test('trusted publish context is one fresh-snapshot-fenced host read', async () => {
  const runtime = harness({
    adapter: { loadTrustedPublishContext: () => Promise.resolve(readyContext()) },
  });
  const result = plain(await runtime.loadContext(data(), {
    actorId: OWNER,
    operationId: 'request_1',
  }));

  assert.equal(result.status, 'READY');
  assert.equal(runtime.captures.fleetLoads, 1);
  assert.deepEqual(runtime.calls, [{
    host_context: {
      fleet_snapshot_id: SNAPSHOT,
      request_id: 'request_1',
    },
  }]);
  assert.equal('owner_account_id' in runtime.calls[0].host_context, false);
});

test('context input, snapshot and host data failures all fail closed', async () => {
  const adapter = { loadTrustedPublishContext: () => Promise.resolve(readyContext()) };
  const extra = harness({ adapter });
  await rejectsCode(extra.loadContext(data({ draft_id: 'forged' }), {}),
    'TRUSTED_PUBLISH_CONTEXT_REQUEST_INVALID');
  assert.equal(extra.calls.length, 0);
  assert.equal(extra.captures.fleetLoads, 0);

  const changedFleet = harness({
    adapter,
    freshSession: session('fleet_snapshot_reloaded'),
  });
  await rejectsCode(changedFleet.loadContext(data(), {}), 'FLEET_SNAPSHOT_MISMATCH');
  assert.equal(changedFleet.calls.length, 0);

  const malformed = harness({
    adapter: { loadTrustedPublishContext: () => Promise.resolve(readyContext({
      owner_account_id: 'account_other',
    })) },
  });
  const unavailable = plain(await malformed.loadContext(data(), { actorId: OWNER }));
  assert.equal(unavailable.status, 'UNAVAILABLE');
  assert.equal(unavailable.error_code, 'TRUSTED_PUBLISH_CONTEXT_ACCOUNT_MISMATCH');
});

test('missing or throwing host adapter never opens a browser-side fallback', async () => {
  const missing = harness();
  const noAdapter = plain(await missing.loadContext(data(), { actorId: OWNER }));
  assert.equal(noAdapter.status, 'UNAVAILABLE');
  assert.equal(noAdapter.error_code, 'TRUSTED_PUBLISH_CONTEXT_ADAPTER_UNAVAILABLE');
  assert.equal(missing.calls.length, 0);

  const thrown = harness({
    adapter: { loadTrustedPublishContext: () => Promise.reject(new Error('socket reset')) },
  });
  const unavailable = plain(await thrown.loadContext(data(), { actorId: OWNER }));
  assert.equal(unavailable.status, 'UNAVAILABLE');
  assert.equal(unavailable.error_code, 'TRUSTED_PUBLISH_CONTEXT_SOURCE_UNAVAILABLE');
  assert.equal(thrown.calls.length, 1);
});

test('trusted publish context route has no KV, writer or legacy bridge escape hatch', () => {
  const slice = contextRouteSlice();
  assert.match(slice, /loadTrustedPublishContext/);
  assert.match(slice, /_evolutionRequireSession\(data, context, true\)/);
  assert.match(slice, /_evolutionFleetLoad\(context\)/);
  assert.match(
    router,
    /if \(action === 'trusted_publish_context_load'\) \{\s*return _evolutionTrustedPublishContext\(data, context\);\s*\}/,
  );
  assert.doesNotMatch(router, /e\.data\.type === 'trusted_publish_context_load'/);
  assert.doesNotMatch(
    slice,
    /_evolutionMutation|_evolutionPersist|_evolutionReadOrCreateLedger|_agentControlWrite|kvGet|kvSet|localStorage|ETB\.api|etb_agent_control/,
  );
});
