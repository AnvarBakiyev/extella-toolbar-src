'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const toolbarRoot = path.resolve(__dirname, '..');
const routerSource = fs.readFileSync(
  path.join(toolbarRoot, 'src', 'core', 'router.js'),
  'utf8',
);
const buildSource = fs.readFileSync(
  path.join(toolbarRoot, 'build.js'),
  'utf8',
);

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function harness(options = {}) {
  const start = routerSource.indexOf(
    '  function _evolutionAutomationFleetLoad',
  );
  const end = routerSource.indexOf(
    '  function _evolutionRequireSession',
    start,
  );
  assert.ok(start >= 0 && end > start);
  const calls = [];
  let assertCount = 0;
  const context = {
    ETB: {
      evolutionAutomationProvider: options.provider === false ? null : {
        loadCurrentDevice(input) {
          calls.push({ kind: 'provider', input: plain(input) });
          if (options.providerError) {
            return Promise.reject(options.providerError);
          }
          return Promise.resolve({
            manifests: [{ id: 'extella_1c_agent' }],
            services: [{ id: 'extella_1c_agent', status: 'running' }],
            checkedAt: '2026-07-26T21:30:00.000Z',
            complete: true,
            sourceErrors: [],
            evidence: [{ source: 'DEVICE_REGISTRY' }],
          });
        },
        controlCurrentDevice(input) {
          calls.push({ kind: 'control', input: plain(input) });
          if (options.controlError) {
            return Promise.reject(options.controlError);
          }
          return Promise.resolve(options.controlResult || {
            automationId: input.automationId,
            action: input.action,
            outcome: 'CONFIRMED',
          });
        },
      },
      evolutionAutomationInventory: options.inventory === false ? null : {
        normalize(manifests, services, normalizeOptions) {
          calls.push({
            kind: 'normalize',
            manifests: plain(manifests),
            services: plain(services),
            options: plain(normalizeOptions),
          });
          return options.inventoryProjection || {
            schema: 'extella.evolution.automation_inventory.v1',
            scope: 'CURRENT_DEVICE',
            complete: true,
            rows: [{
              id: 'extella_1c_agent',
              actions: {
                start: 'UNAVAILABLE',
                stop: 'AVAILABLE',
              },
            }],
          };
        },
      },
    },
    Promise,
    calls,
    legacyLoad() {
      calls.push({ kind: 'legacy' });
      if (options.legacyError) {
        return Promise.reject(options.legacyError);
      }
      return Promise.resolve({ projection: { snapshotId: 'fleet_exact' } });
    },
    assertContext() {
      assertCount += 1;
      calls.push({ kind: 'assertContext' });
      if (
        options.sessionError &&
        (!options.sessionErrorAt || options.sessionErrorAt === assertCount)
      ) {
        throw options.sessionError;
      }
    },
  };
  vm.runInNewContext(`
    function _evolutionError(code, message) {
      var error = new Error(message || code);
      error.code = code;
      return error;
    }
    function _agentControlAssertContext() {
      return assertContext();
    }
    function _evolutionFleetLoad() {
      return legacyLoad();
    }
    ${routerSource.slice(start, end)}
    this.loadAutomationFleet = _evolutionAutomationFleetLoad;
    this.controlAutomationService = _evolutionAutomationServiceControl;
  `, context, { filename: 'evolution-automation-router-slice.js' });
  return {
    load: context.loadAutomationFleet,
    control: context.controlAutomationService,
    calls,
  };
}

test('joins current-device inventory with the exact legacy Evolution projection', async () => {
  const runtime = harness();
  const result = plain(await runtime.load({
    actorId: 'account-1',
    epoch: 7,
  }));

  assert.equal(
    result.inventory.schema,
    'extella.evolution.automation_inventory.v1',
  );
  assert.equal(result.legacy.projection.snapshotId, 'fleet_exact');
  assert.equal(result.legacyError, null);
  assert.deepEqual(runtime.calls[0], {
    kind: 'provider',
    input: { actorId: 'account-1', epoch: 7 },
  });
  assert.deepEqual(
    runtime.calls.find((call) => call.kind === 'normalize').options,
    {
      checkedAt: '2026-07-26T21:30:00.000Z',
      complete: true,
      sourceErrors: [],
      evidence: [{ source: 'DEVICE_REGISTRY' }],
    },
  );
});

test('keeps real device inventory when advanced platform projection is unavailable', async () => {
  const error = new Error('platform unavailable');
  error.code = 'PLATFORM_UNAVAILABLE';
  const result = plain(await harness({ legacyError: error }).load({
    actorId: 'account-1',
    epoch: 2,
  }));
  assert.deepEqual(
    result.inventory.rows.map((row) => row.id),
    ['extella_1c_agent'],
  );
  assert.equal(result.legacy, null);
  assert.deepEqual(result.legacyError, {
    code: 'PLATFORM_UNAVAILABLE',
    message: 'platform unavailable',
  });
});

test('account-session failures never degrade into a stale device projection', async () => {
  const error = new Error('session changed');
  error.code = 'ACCOUNT_SESSION_CHANGED';
  await assert.rejects(
    harness({ legacyError: error }).load({
      actorId: 'account-1',
      epoch: 3,
    }),
    (caught) => caught.code === 'ACCOUNT_SESSION_CHANGED',
  );
});

test('missing provider or normalizer fails closed', async () => {
  for (const options of [{ provider: false }, { inventory: false }]) {
    await assert.rejects(
      harness(options).load({ actorId: 'account-1', epoch: 1 }),
      (error) => error.code === 'AUTOMATION_INVENTORY_UNAVAILABLE',
    );
  }
});

test('service control requires exact confirmation and reloads confirmed inventory', async () => {
  const runtime = harness();
  await assert.rejects(
    runtime.control({
      automationId: 'extella_1c_agent',
      serviceAction: 'stop',
      confirmation: 'CONFIRM_STOP:other_agent',
    }, {
      actorId: 'account-1',
      epoch: 4,
    }),
    (error) => error.code === 'SERVICE_CONTROL_CONFIRMATION_REQUIRED',
  );
  assert.equal(
    runtime.calls.some((call) => call.kind === 'control'),
    false,
  );

  const result = plain(await runtime.control({
    automationId: 'extella_1c_agent',
    serviceAction: 'stop',
    confirmation: 'CONFIRM_STOP:extella_1c_agent',
  }, {
    actorId: 'account-1',
    epoch: 4,
  }));
  assert.deepEqual(
    runtime.calls.find((call) => call.kind === 'control').input,
    {
      actorId: 'account-1',
      epoch: 4,
      automationId: 'extella_1c_agent',
      action: 'stop',
    },
  );
  assert.deepEqual(result.control, {
    automationId: 'extella_1c_agent',
    action: 'stop',
    outcome: 'CONFIRMED',
  });
  assert.deepEqual(
    result.inventory.rows.map((row) => row.id),
    ['extella_1c_agent'],
  );
});

test('service control rejects targets outside one complete eligible inventory row', async () => {
  for (const inventoryProjection of [
    {
      schema: 'extella.evolution.automation_inventory.v1',
      scope: 'CURRENT_DEVICE',
      complete: true,
      rows: [{
        id: 'other_application',
        actions: { stop: 'AVAILABLE' },
      }],
    },
    {
      schema: 'extella.evolution.automation_inventory.v1',
      scope: 'CURRENT_DEVICE',
      complete: false,
      rows: [{
        id: 'extella_1c_agent',
        actions: { stop: 'AVAILABLE' },
      }],
    },
  ]) {
    const runtime = harness({ inventoryProjection });
    await assert.rejects(
      runtime.control({
        automationId: 'extella_1c_agent',
        serviceAction: 'stop',
        confirmation: 'CONFIRM_STOP:extella_1c_agent',
      }, {
        actorId: 'account-1',
        epoch: 4,
      }),
      (error) => error.code === 'AUTOMATION_CONTROL_TARGET_UNAUTHORIZED',
    );
    assert.equal(
      runtime.calls.some((call) => call.kind === 'control'),
      false,
    );
  }
});

test('service control rejects unavailable action and mismatched provider evidence', async () => {
  const unavailable = harness({
    inventoryProjection: {
      schema: 'extella.evolution.automation_inventory.v1',
      scope: 'CURRENT_DEVICE',
      complete: true,
      rows: [{
        id: 'extella_1c_agent',
        actions: { stop: 'UNAVAILABLE' },
      }],
    },
  });
  await assert.rejects(
    unavailable.control({
      automationId: 'extella_1c_agent',
      serviceAction: 'stop',
      confirmation: 'CONFIRM_STOP:extella_1c_agent',
    }, {
      actorId: 'account-1',
      epoch: 4,
    }),
    (error) => error.code === 'SERVICE_CONTROL_NOT_ALLOWED',
  );

  const mismatched = harness({
    controlResult: {
      automationId: 'other_application',
      action: 'stop',
      outcome: 'CONFIRMED',
    },
  });
  await assert.rejects(
    mismatched.control({
      automationId: 'extella_1c_agent',
      serviceAction: 'stop',
      confirmation: 'CONFIRM_STOP:extella_1c_agent',
    }, {
      actorId: 'account-1',
      epoch: 4,
    }),
    (error) => error.code === 'OPERATION_OUTCOME_UNKNOWN',
  );

  const sessionChanged = new Error('session changed after control');
  sessionChanged.code = 'ACCOUNT_SESSION_CHANGED';
  const switched = harness({
    sessionError: sessionChanged,
    sessionErrorAt: 3,
  });
  await assert.rejects(
    switched.control({
      automationId: 'extella_1c_agent',
      serviceAction: 'stop',
      confirmation: 'CONFIRM_STOP:extella_1c_agent',
    }, {
      actorId: 'account-1',
      epoch: 4,
    }),
    (error) => error.code === 'OPERATION_OUTCOME_UNKNOWN',
  );
});

test('build order loads inventory before provider and provider after registry', () => {
  const inventoryIndex = buildSource.indexOf(
    "'evolution-automation-inventory.js'",
  );
  const standardsIndex = buildSource.indexOf(
    "'evolution-standards-provider.js'",
  );
  const registryIndex = buildSource.indexOf("'registry.js'");
  const providerIndex = buildSource.indexOf(
    "'evolution-automation-provider.js'",
  );
  const routerIndex = buildSource.indexOf("'router.js'");
  assert.ok(inventoryIndex > 0 && inventoryIndex < standardsIndex);
  assert.ok(
    registryIndex > standardsIndex &&
    providerIndex > registryIndex &&
    providerIndex < routerIndex,
  );
  assert.match(
    routerSource,
    /if \(action === 'automation_fleet_load'\)[\s\S]*?_evolutionAutomationFleetLoad\(context\)/,
  );
  assert.match(
    routerSource,
    /if \(action === 'automation_service_control'\)[\s\S]*?_evolutionAutomationServiceControl\(data, context\)/,
  );
});
