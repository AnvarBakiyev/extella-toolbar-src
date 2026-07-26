'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const toolbarRoot = path.resolve(__dirname, '..');
const providerSource = fs.readFileSync(
  path.join(toolbarRoot, 'src', 'core', 'evolution-automation-provider.js'),
  'utf8',
);
const inventorySource = fs.readFileSync(
  path.join(toolbarRoot, 'src', 'core', 'evolution-automation-inventory.js'),
  'utf8',
);

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function response(payload, ok = true) {
  return {
    ok,
    json() {
      return Promise.resolve(payload);
    },
  };
}

function applicationManifest(id = 'extella_1c_agent') {
  return {
    id,
    name: 'Application Agent',
    category: 'automations',
    type: 'process',
    version: '1.0.0',
  };
}

function makeRuntime(options = {}) {
  const calls = [];
  const state = {
    actorId: options.actorId || 'account-1',
    custom: options.custom || [],
  };
  const context = {
    ETB: {
      auth: {
        getUserId() {
          return state.actorId;
        },
      },
      api: {
        kvGet(key) {
          calls.push({ kind: 'kvGet', key });
          return Promise.resolve({ value: options.kvDeviceId || '' });
        },
      },
      registry: {
        syncFromDevice(deviceId) {
          calls.push({ kind: 'syncFromDevice', deviceId });
          if (options.registryError) {
            return Promise.reject(new Error('registry unavailable'));
          }
          return Promise.resolve(options.synced || []);
        },
        getCustom() {
          calls.push({ kind: 'getCustom' });
          return state.custom;
        },
      },
    },
    window: {
      extellaDesktop: {
        getDeviceID() {
          calls.push({ kind: 'getDeviceID' });
          return Promise.resolve(options.deviceId || '');
        },
      },
    },
    fetch(url, init) {
      calls.push({ kind: 'fetch', url, init });
      if (options.fetchImpl) return options.fetchImpl(url, init);
      if (url.endsWith('/api/services')) {
        return Promise.resolve(response(options.services || {
          services: [],
          controlToken: 'must-not-leak',
        }));
      }
      return Promise.resolve(response(options.activity || {
        health: 'ok',
        controlToken: 'must-not-leak',
      }));
    },
    Promise,
    Date,
  };
  vm.runInNewContext(inventorySource, context, {
    filename: 'evolution-automation-inventory.js',
  });
  vm.runInNewContext(providerSource, context, {
    filename: 'evolution-automation-provider.js',
  });
  return {
    provider: context.ETB.evolutionAutomationProvider,
    calls,
    state,
  };
}

test('loads only manifests confirmed by current-device sync and Activity Center services', async () => {
  const synced = [
    { id: 'agent-1c', name: 'stale cache copy' },
    { id: 'kazakh-lawyer', name: 'Kazakh Lawyer' },
  ];
  const runtime = makeRuntime({
    deviceId: 'device-current',
    synced,
    custom: [
      { id: 'agent-1c', name: 'Agent 1C', apiKey: 'hidden' },
      { id: 'kazakh-lawyer', name: 'Kazakh Lawyer' },
      { id: 'other-device', name: 'Must not leak' },
    ],
    services: {
      services: [{
        id: 'agent-1c',
        status: 'running',
        url: 'http://127.0.0.1:8100/',
        password: 'hidden',
      }],
      controlToken: 'hidden',
    },
  });

  const loaded = plain(await runtime.provider.loadCurrentDevice({
    actorId: 'account-1',
    epoch: 3,
  }));

  assert.equal(loaded.scope, 'CURRENT_DEVICE');
  assert.deepEqual(loaded.manifests, [
    { id: 'agent-1c', name: 'Agent 1C' },
    { id: 'kazakh-lawyer', name: 'Kazakh Lawyer' },
  ]);
  assert.deepEqual(loaded.services, [{
    id: 'agent-1c',
    status: 'running',
    url: 'http://127.0.0.1:8100/',
  }]);
  assert.deepEqual(loaded.evidence.map((row) => ({
    source: row.source,
    scope: row.scope,
    status: row.status,
  })), [
    {
      source: 'DEVICE_REGISTRY',
      scope: 'CURRENT_DEVICE',
      status: 'READ',
    },
    {
      source: 'ACTIVITY_CENTER',
      scope: 'CURRENT_DEVICE',
      status: 'READ',
    },
  ]);
  assert.equal(Object.hasOwn(loaded.evidence[1], 'data'), false);
  assert.equal(loaded.complete, true);
  assert.deepEqual(loaded.sourceErrors, []);
  assert.match(loaded.checkedAt, /^\d{4}-\d\d-\d\dT/);
  assert.equal(
    runtime.calls.find((call) => call.kind === 'syncFromDevice').deviceId,
    'device-current',
  );
  const fetches = runtime.calls.filter((call) => call.kind === 'fetch');
  assert.deepEqual(fetches.map((call) => call.url), [
    'http://127.0.0.1:8799/api/services',
  ]);
  assert.ok(fetches.every((call) =>
    plain(call.init).cache === 'no-store' &&
    Object.keys(call.init).length === 1
  ));
  assert.doesNotMatch(JSON.stringify(loaded), /must-not-leak|hidden/);
});

test('successful empty device registry is complete and does not import stale custom cache', async () => {
  const runtime = makeRuntime({
    deviceId: 'device-current',
    synced: [],
    custom: [{ id: 'stale-other-device' }],
  });
  const loaded = plain(await runtime.provider.loadCurrentDevice({
    actorId: 'account-1',
    epoch: 0,
  }));
  assert.deepEqual(loaded.manifests, []);
  assert.equal(loaded.complete, true);
  assert.equal(loaded.evidence[0].status, 'READ');
});

test('Activity Center unavailability is explicit and never becomes an empty success', async () => {
  const runtime = makeRuntime({
    deviceId: 'device-current',
    synced: [{ id: 'agent-1c' }],
    custom: [{ id: 'agent-1c' }],
    fetchImpl() {
      return Promise.reject(new Error('offline'));
    },
  });
  const loaded = plain(await runtime.provider.loadCurrentDevice({
    actorId: 'account-1',
    epoch: 1,
  }));

  assert.deepEqual(loaded.manifests, [{ id: 'agent-1c' }]);
  assert.equal(loaded.services, null);
  assert.equal(loaded.evidence[1].status, 'UNAVAILABLE');
  assert.equal(Object.hasOwn(loaded.evidence[1], 'data'), false);
  assert.equal(loaded.complete, false);
  assert.deepEqual(loaded.sourceErrors, [
    {
      source: 'ACTIVITY_CENTER',
      endpoint: '/api/services',
      code: 'ACTIVITY_CENTER_SERVICES_UNAVAILABLE',
    },
  ]);
});

test('unresolved current device does not fall back to an unscoped registry read', async () => {
  const runtime = makeRuntime({
    deviceId: '',
    kvDeviceId: '',
    custom: [{ id: 'account-owner-device' }],
  });
  const loaded = plain(await runtime.provider.loadCurrentDevice({
    actorId: 'account-1',
    epoch: 2,
  }));

  assert.equal(loaded.manifests, null);
  assert.equal(loaded.evidence[0].status, 'UNAVAILABLE');
  assert.equal(loaded.complete, false);
  assert.equal(
    runtime.calls.some((call) => call.kind === 'syncFromDevice'),
    false,
  );
  assert.deepEqual(loaded.sourceErrors[0], {
    source: 'DEVICE_REGISTRY',
    code: 'DEVICE_REGISTRY_UNAVAILABLE',
  });
});

test('account and epoch fences reject stale or switched sessions', async () => {
  const runtime = makeRuntime({ deviceId: 'device-current' });
  await runtime.provider.loadCurrentDevice({
    actorId: 'account-1',
    epoch: 5,
  });
  await assert.rejects(
    runtime.provider.loadCurrentDevice({
      actorId: 'account-1',
      epoch: 4,
    }),
    (error) => error.code === 'ACCOUNT_SESSION_CHANGED',
  );

  const deferred = [];
  const switched = makeRuntime({
    deviceId: 'device-current',
    fetchImpl() {
      return new Promise((resolve) => deferred.push(resolve));
    },
  });
  const loading = switched.provider.loadCurrentDevice({
    actorId: 'account-1',
    epoch: 1,
  });
  switched.state.actorId = 'account-2';
  deferred.forEach((resolve) => resolve(response({ services: [] })));
  await assert.rejects(
    loading,
    (error) => error.code === 'ACCOUNT_SESSION_CHANGED',
  );
});

test('controls one exact service and confirms the requested state by fresh read-back', async () => {
  let reads = 0;
  const runtime = makeRuntime({
    deviceId: 'device-current',
    synced: [applicationManifest()],
    fetchImpl(url, init) {
      if (url.endsWith('/api/services') && (!init || !init.method)) {
        reads += 1;
        return Promise.resolve(response({
          services: [{
            id: 'extella_1c_agent',
            status: reads < 3 ? 'running' : 'stopped',
            desired: reads < 3 ? 'on' : 'off',
            canStart: reads >= 3,
            canStop: reads < 3,
          }],
          controlToken: 'local-control-secret',
        }));
      }
      assert.equal(
        url,
        'http://127.0.0.1:8799/api/services/extella_1c_agent/stop',
      );
      assert.equal(init.method, 'POST');
      assert.equal(
        init.headers['X-Extella-Control'],
        'local-control-secret',
      );
      return Promise.resolve(response({ status: 'success' }));
    },
  });

  const result = plain(await runtime.provider.controlCurrentDevice({
    actorId: 'account-1',
    epoch: 1,
    automationId: 'extella_1c_agent',
    action: 'stop',
  }));

  assert.deepEqual({
    automationId: result.automationId,
    action: result.action,
    outcome: result.outcome,
    status: result.status,
    desired: result.desired,
    scope: result.scope,
    source: result.source,
  }, {
    automationId: 'extella_1c_agent',
    action: 'stop',
    outcome: 'CONFIRMED',
    status: 'STOPPED',
    desired: 'OFF',
    scope: 'CURRENT_DEVICE',
    source: 'ACTIVITY_CENTER',
  });
  assert.equal(reads, 3);
  assert.doesNotMatch(JSON.stringify(result), /local-control-secret/);
});

test('service control rejects unsupported, unavailable and unconfirmed actions', async () => {
  const unsupported = makeRuntime({ deviceId: 'device-current' });
  await assert.rejects(
    unsupported.provider.controlCurrentDevice({
      actorId: 'account-1',
      epoch: 1,
      automationId: 'extella_1c_agent',
      action: 'restart',
    }),
    (error) => error.code === 'SERVICE_CONTROL_ACTION_UNSUPPORTED',
  );

  const unavailable = makeRuntime({
    deviceId: 'device-current',
    synced: [applicationManifest()],
    services: {
      services: [{
        id: 'extella_1c_agent',
        status: 'running',
        canStart: false,
        canStop: false,
      }],
      controlToken: 'local-control-secret',
    },
  });
  await assert.rejects(
    unavailable.provider.controlCurrentDevice({
      actorId: 'account-1',
      epoch: 1,
      automationId: 'extella_1c_agent',
      action: 'stop',
    }),
    (error) => error.code === 'SERVICE_CONTROL_NOT_ALLOWED',
  );

  let reads = 0;
  const mismatch = makeRuntime({
    deviceId: 'device-current',
    synced: [applicationManifest()],
    fetchImpl(url, init) {
      if (url.endsWith('/api/services') && (!init || !init.method)) {
        reads += 1;
        return Promise.resolve(response({
          services: [{
            id: 'extella_1c_agent',
            status: 'running',
            canStop: true,
          }],
          controlToken: 'local-control-secret',
        }));
      }
      return Promise.resolve(response({ status: 'success' }));
    },
  });
  await assert.rejects(
    mismatch.provider.controlCurrentDevice({
      actorId: 'account-1',
      epoch: 1,
      automationId: 'extella_1c_agent',
      action: 'stop',
    }),
    (error) => (
      error.code === 'OPERATION_OUTCOME_UNKNOWN' &&
      error.causeCode === 'SERVICE_CONTROL_READBACK_MISMATCH'
    ),
  );
  assert.equal(reads, 3);
});

test('service control authorizes only one eligible current-device manifest', async () => {
  const foreign = makeRuntime({
    deviceId: 'device-current',
    synced: [applicationManifest('installed_application')],
    services: {
      services: [{
        id: 'foreign_background_service',
        status: 'running',
        canStop: true,
      }],
      controlToken: 'local-control-secret',
    },
  });
  await assert.rejects(
    foreign.provider.controlCurrentDevice({
      actorId: 'account-1',
      epoch: 1,
      automationId: 'foreign_background_service',
      action: 'stop',
    }),
    (error) => error.code === 'AUTOMATION_CONTROL_TARGET_UNAUTHORIZED',
  );
  assert.equal(
    foreign.calls.some(
      (call) => call.kind === 'fetch' && call.init?.method === 'POST',
    ),
    false,
  );

  const duplicate = makeRuntime({
    deviceId: 'device-current',
    synced: [applicationManifest(), applicationManifest()],
    services: {
      services: [{
        id: 'extella_1c_agent',
        status: 'running',
        canStop: true,
      }],
      controlToken: 'local-control-secret',
    },
  });
  await assert.rejects(
    duplicate.provider.controlCurrentDevice({
      actorId: 'account-1',
      epoch: 1,
      automationId: 'extella_1c_agent',
      action: 'stop',
    }),
    (error) => error.code === 'AUTOMATION_CONTROL_INVENTORY_INCOMPLETE',
  );
});

test('service control confirms start and never leaks the local token', async () => {
  let reads = 0;
  const runtime = makeRuntime({
    deviceId: 'device-current',
    synced: [applicationManifest()],
    fetchImpl(url, init) {
      if (url.endsWith('/api/services') && (!init || !init.method)) {
        reads += 1;
        return Promise.resolve(response({
          services: [{
            id: 'extella_1c_agent',
            status: reads < 3 ? 'stopped' : 'running',
            desired: reads < 3 ? 'off' : 'on',
            canStart: reads < 3,
            canStop: reads >= 3,
          }],
          controlToken: 'local-control-secret',
        }));
      }
      assert.equal(
        url,
        'http://127.0.0.1:8799/api/services/extella_1c_agent/start',
      );
      assert.equal(init.method, 'POST');
      return Promise.resolve(response({ status: 'success' }));
    },
  });

  const result = plain(await runtime.provider.controlCurrentDevice({
    actorId: 'account-1',
    epoch: 1,
    automationId: 'extella_1c_agent',
    action: 'start',
  }));
  assert.equal(result.outcome, 'CONFIRMED');
  assert.equal(result.status, 'RUNNING');
  assert.equal(result.desired, 'ON');
  assert.equal(reads, 3);
  assert.doesNotMatch(JSON.stringify(result), /local-control-secret/);
});

test('every failure after POST is outcome-unknown and is not retried', async () => {
  for (const mode of ['non-ok', 'readback-offline']) {
    let reads = 0;
    let posts = 0;
    const runtime = makeRuntime({
      deviceId: 'device-current',
      synced: [applicationManifest()],
      fetchImpl(url, init) {
        if (url.endsWith('/api/services') && (!init || !init.method)) {
          reads += 1;
          if (mode === 'readback-offline' && reads === 3) {
            return Promise.reject(new Error('offline after POST'));
          }
          return Promise.resolve(response({
            services: [{
              id: 'extella_1c_agent',
              status: 'running',
              canStop: true,
            }],
            controlToken: 'local-control-secret',
          }));
        }
        posts += 1;
        return Promise.resolve(response(
          { status: mode === 'non-ok' ? 'error' : 'success' },
          mode !== 'non-ok',
        ));
      },
    });
    await assert.rejects(
      runtime.provider.controlCurrentDevice({
        actorId: 'account-1',
        epoch: 1,
        automationId: 'extella_1c_agent',
        action: 'stop',
      }),
      (error) => error.code === 'OPERATION_OUTCOME_UNKNOWN',
    );
    assert.equal(posts, 1, `${mode} must perform one POST only`);
  }
});

test('parallel service-control calls for one automation perform one POST', async () => {
  const lockStart = providerSource.indexOf(
    '  function _controlLockKey(automationId)',
  );
  const lockEnd = providerSource.indexOf('\n  }\n', lockStart);
  assert.ok(lockStart >= 0 && lockEnd > lockStart);
  assert.doesNotMatch(
    providerSource.slice(lockStart, lockEnd),
    /actorId|epoch/,
    'the local service lock must survive account and session switches',
  );
  let reads = 0;
  let posts = 0;
  let releasePost;
  let signalPost;
  const postStarted = new Promise((resolve) => {
    signalPost = resolve;
  });
  const runtime = makeRuntime({
    deviceId: 'device-current',
    synced: [applicationManifest()],
    fetchImpl(url, init) {
      if (url.endsWith('/api/services') && (!init || !init.method)) {
        reads += 1;
        return Promise.resolve(response({
          services: [{
            id: 'extella_1c_agent',
            status: reads < 3 ? 'running' : 'stopped',
            desired: reads < 3 ? 'on' : 'off',
            canStop: reads < 3,
          }],
          controlToken: 'local-control-secret',
        }));
      }
      posts += 1;
      signalPost();
      return new Promise((resolve) => {
        releasePost = resolve;
      });
    },
  });
  const input = {
    actorId: 'account-1',
    epoch: 1,
    automationId: 'extella_1c_agent',
    action: 'stop',
  };
  const first = runtime.provider.controlCurrentDevice(input);
  await assert.rejects(
    runtime.provider.controlCurrentDevice(input),
    (error) => error.code === 'SERVICE_CONTROL_IN_PROGRESS',
  );
  await postStarted;
  releasePost(response({ status: 'success' }));
  assert.equal((await first).outcome, 'CONFIRMED');
  assert.equal(posts, 1);
});
