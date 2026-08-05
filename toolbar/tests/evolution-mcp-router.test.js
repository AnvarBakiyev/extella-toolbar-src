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
const marketplace = fs.readFileSync(path.join(
  toolbarRoot,
  'src',
  'panels',
  'marketplace.js',
), 'utf8');

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function actionHarness() {
  const start = router.indexOf('  function _evolutionConsoleAction(data)');
  const end = router.indexOf('  function _studioReadObjects(', start);
  assert.ok(start >= 0 && end > start);
  const captured = {
    create: null,
    invoke: null,
    automationLoads: 0,
    mcpLoads: 0,
    contextChecks: 0,
    locatorRequests: [],
    providerLocator: null,
  };
  const context = {
    ETB: {
      evolutionConsole: {
        sha256() {
          return Promise.resolve('a'.repeat(64));
        },
      },
      evolutionMcpReadGateway: {
        create(options) {
          captured.create = options;
          return {
            invoke(tool, args, requestContext) {
              captured.invoke = { tool, args, requestContext };
              return Promise.resolve({ ok: true });
            },
          };
        },
      },
      evolutionMcpRegistryProvider: {
        REGISTRY_KEY: '_mkt_xtl_evolution_mcp_registry_v1',
        load(options) {
          captured.mcpLoads += 1;
          captured.providerLocator = plain(options.locator);
          options.assertContext();
          return Promise.resolve({ schema: 'mcp' });
        },
      },
      evolutionAdapter: {
        getMcpRegistryLocator(request) {
          captured.locatorRequests.push(plain(request));
          return {
            account_id: 'account_demo',
            profile_id: 'default',
            scope_agent_id: 'agent_scope_demo',
            key: '_mkt_xtl_evolution_mcp_registry_v1',
            global: true,
          };
        },
      },
    },
    Promise,
    Date,
    captured,
  };
  vm.runInNewContext(`
    function _studioCurrentUserId() { return 'account_demo'; }
    function _agentControlContext(actorId, operationId) {
      return {
        actorId: actorId,
        operationId: operationId,
        epoch: 1
      };
    }
    function _agentControlAssertContext(context) {
      if (!context || context.actorId !== 'account_demo') {
        throw new Error('context mismatch');
      }
      captured.contextChecks += 1;
    }
    function _evolutionAutomationRegistryLoad() {
      captured.automationLoads += 1;
      return Promise.resolve({ registry: { schema: 'automation' } });
    }
    function _evolutionFleetLoad() {
      throw new Error('fleet loader must not be used by MCP read');
    }
    function _evolutionPassportDraft() {}
    function _evolutionCabinetGet() {}
    function _evolutionEscalationAction() {}
    function _evolutionBulkAction() {}
    function _evolutionError(code, message) {
      var result = new Error(message || code);
      result.code = code;
      return result;
    }
    ${router.slice(start, end)}
    this.action = _evolutionConsoleAction;
  `, context, { filename: 'evolution-mcp-router-slice.js' });
  return {
    action: context.action,
    captured,
  };
}

test('router injects the canonical readers into one thin MCP read adapter', async () => {
  const { action, captured } = actionHarness();
  const result = await action({
    action: 'mcp_read',
    reqId: 'request_demo',
    tool: 'automations.get_composition',
    arguments: { automation_id: 'automation.demo' },
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(captured.create.actorId, 'account_demo');
  assert.equal(captured.create.accountId, 'account_demo');
  assert.equal(captured.create.tenantId, 'account_demo');
  assert.equal(typeof captured.create.hash, 'function');
  assert.deepEqual(plain(captured.invoke), {
    tool: 'automations.get_composition',
    args: { automation_id: 'automation.demo' },
    requestContext: {
      actorId: 'account_demo',
      accountId: 'account_demo',
      tenantId: 'account_demo',
      requestId: 'request_demo',
    },
  });

  await captured.create.loadAutomationRegistry();
  await captured.create.loadMcpRegistry();
  assert.equal(captured.automationLoads, 1);
  assert.equal(captured.mcpLoads, 1);
  assert.deepEqual(captured.locatorRequests, [{
    account_id: 'account_demo',
    profile_id: 'default',
    key: '_mkt_xtl_evolution_mcp_registry_v1',
    global: true,
  }]);
  assert.deepEqual(captured.providerLocator, {
    account_id: 'account_demo',
    profile_id: 'default',
    scope_agent_id: 'agent_scope_demo',
    key: '_mkt_xtl_evolution_mcp_registry_v1',
    global: true,
  });
  assert.ok(captured.contextChecks >= 1);
});

test('router MCP read branch has no alternate fleet, ledger or mutation path', () => {
  const start = router.indexOf('    if (action === \'mcp_read\') {');
  const end = router.indexOf(
    '    if (action === \'fleet_load\')',
    start,
  );
  assert.ok(start >= 0 && end > start);
  const source = router.slice(start, end);

  assert.match(
    source,
    /loadAutomationRegistry:\s*function \(\) \{\s*return _evolutionAutomationRegistryLoad\(context\);/,
  );
  assert.match(
    source,
    /getMcpRegistryLocator\(\{[\s\S]*?ETB\.evolutionMcpRegistryProvider\.load\(\{/,
  );
  assert.doesNotMatch(
    source,
    /_evolutionFleetLoad|_evolutionPersist|_agentControlWrite|kvSet|bulk_|escalation_/,
  );
});

test('generic iframe KV and KV-expert bridges reserve the MCP registry key', () => {
  const key = '_mkt_xtl_evolution_mcp_registry_v1';
  const routerStart = router.indexOf(
    'var reservedMcpRegistry=',
  ) >= 0 ? router.indexOf('var reservedMcpRegistry=') :
    router.indexOf('var reservedMcpRegistry =');
  const routerEnd = router.indexOf(
    "if (!okMkt && !okRuns && !okCapM)",
    routerStart,
  );
  assert.ok(routerStart >= 0 && routerEnd > routerStart);
  const routerGuard = router.slice(routerStart, routerEnd);
  assert.match(routerGuard, new RegExp(key));
  assert.match(routerGuard, /key reserved for the trusted Evolution MCP provider/);
  assert.match(routerGuard, /return;/);

  const marketStart = marketplace.indexOf('var _isReservedMcpRegistry');
  // Якорь по НАЧАЛУ строки-белого списка, а не по её полному тексту: список
  // допустимых ключей пополняется (30.07 добавлен github_token на запись), и
  // буквальный ассерт краснел бы на каждом таком пополнении, ничего не проверяя
  // по существу. Свойство, которое здесь важно, — зарезервированный ключ MCP
  // отбивается ДО белого списка — проверяется ниже и не ослаблено.
  const marketEnd = marketplace.indexOf('if (!_isMkt', marketStart);
  assert.ok(marketStart >= 0 && marketEnd > marketStart);
  const marketGuard = marketplace.slice(marketStart, marketEnd);
  assert.match(marketGuard, new RegExp(key));
  assert.match(marketGuard, /key reserved for the trusted Evolution MCP provider/);
  assert.match(marketGuard, /return;/);

  const routerExpertStart = router.indexOf(
    'var expertTargetsReservedMcpRegistry',
  );
  const routerExpertEnd = router.indexOf(
    'ETB.api.runExpertAsync(expertName, expertParams',
    routerExpertStart,
  );
  assert.ok(routerExpertStart >= 0 && routerExpertEnd > routerExpertStart);
  const routerExpertGuard = router.slice(
    routerExpertStart,
    routerExpertEnd,
  );
  assert.match(routerExpertGuard, /_etb_kv_get/);
  assert.match(routerExpertGuard, /_etb_kv_set/);
  assert.match(routerExpertGuard, new RegExp(key));
  assert.match(
    routerExpertGuard,
    /key reserved for the trusted Evolution MCP provider/,
  );
  assert.match(routerExpertGuard, /return;/);

  const marketExpertStart = marketplace.indexOf(
    'var _expertTargetsReservedMcpRegistry',
  );
  const marketExpertEnd = marketplace.indexOf(
    'ETB.api.runExpertAsync(_expertName, _expertParams',
    marketExpertStart,
  );
  assert.ok(marketExpertStart >= 0 && marketExpertEnd > marketExpertStart);
  const marketExpertGuard = marketplace.slice(
    marketExpertStart,
    marketExpertEnd,
  );
  assert.match(marketExpertGuard, /_etb_kv_get/);
  assert.match(marketExpertGuard, /_etb_kv_set/);
  assert.match(marketExpertGuard, new RegExp(key));
  assert.match(
    marketExpertGuard,
    /key reserved for the trusted Evolution MCP provider/,
  );
  assert.match(marketExpertGuard, /return;/);
});

test('the tokenless built-in bridge has one exact mcp_read route', () => {
  assert.equal(
    [...router.matchAll(/action === 'mcp_read'/g)].length,
    1,
  );
  assert.match(
    router,
    /if \(!_isBuiltinEvolutionConsole\(\)\)[\s\S]*?_evolutionConsoleAction\(e\.data\)/,
  );
  assert.match(
    router,
    /type:\s*'etb_evolution_console_result'/,
  );
});
