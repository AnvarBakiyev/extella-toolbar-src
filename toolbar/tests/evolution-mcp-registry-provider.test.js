'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const toolbarRoot = path.resolve(__dirname, '..');
const contractSource = fs.readFileSync(path.join(
  toolbarRoot,
  'src',
  'core',
  'evolution-mcp-contract.js',
), 'utf8');
const providerSource = fs.readFileSync(path.join(
  toolbarRoot,
  'src',
  'core',
  'evolution-mcp-registry-provider.js',
), 'utf8');
const registryKey = '_mkt_xtl_evolution_mcp_registry_v1';

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function emptyRegistry(contract, accountId = 'account_demo') {
  const registry = contract.unavailableRegistry(
    accountId,
    '2026-07-27T12:00:00Z',
    'TEST_FIXTURE',
  );
  return {
    ...registry,
    complete: true,
    source: {
      kind: 'ACCOUNT_SCOPED_HOST_PROVIDER',
      id: 'evolution.mcp.registry',
      version: '1.0.0',
      sha256: 'a'.repeat(64),
    },
    warnings: [],
  };
}

function validLocator(overrides = {}) {
  return {
    account_id: 'account_demo',
    profile_id: 'default',
    scope_agent_id: 'agent_registry_owner',
    key: registryKey,
    global: true,
    ...overrides,
  };
}

function loadRuntime(api) {
  const context = {
    ETB: { api },
    Promise,
    Date,
  };
  vm.runInNewContext(contractSource, context, {
    filename: 'evolution-mcp-contract.js',
  });
  vm.runInNewContext(providerSource, context, {
    filename: 'evolution-mcp-registry-provider.js',
  });
  return {
    contract: context.ETB.evolutionMcpContract,
    provider: context.ETB.evolutionMcpRegistryProvider,
  };
}

function warningCode(result) {
  return result.warnings && result.warnings[0] &&
    result.warnings[0].code;
}

test('provider reads the sole market key in the exact trusted agent scope', async () => {
  const reads = [];
  let contextChecks = 0;
  let document;
  const runtime = loadRuntime({
    kvGet(key, scope) {
      reads.push({ key, scope: plain(scope) });
      return Promise.resolve({ value: JSON.stringify(document) });
    },
  });
  document = emptyRegistry(runtime.contract);

  const result = plain(await runtime.provider.load({
    actorId: 'account_demo',
    accountId: 'account_demo',
    locator: validLocator(),
    now: '2026-07-27T12:01:00Z',
    assertContext() {
      contextChecks += 1;
    },
  }));

  assert.equal(runtime.provider.REGISTRY_KEY, registryKey);
  assert.deepEqual(reads, [{
    key: registryKey,
    scope: {
      global: true,
      agentId: 'agent_registry_owner',
    },
  }]);
  assert.ok(contextChecks >= 3);
  assert.equal(result.complete, true);
  assert.equal(result.owner_account_id, 'account_demo');
});

test('missing locator performs zero KV reads and reports scope unavailable', async () => {
  let reads = 0;
  const runtime = loadRuntime({
    kvGet() {
      reads += 1;
      return Promise.resolve({ value: null });
    },
  });

  const result = plain(await runtime.provider.load({
    actorId: 'account_demo',
    now: '2026-07-27T12:01:00Z',
  }));

  assert.equal(reads, 0);
  assert.equal(result.complete, false);
  assert.equal(result.source.kind, 'UNAVAILABLE');
  assert.equal(warningCode(result), 'MCP_REGISTRY_SCOPE_UNAVAILABLE');
});

test('invalid or open locator performs zero KV reads', async () => {
  let reads = 0;
  const runtime = loadRuntime({
    kvGet() {
      reads += 1;
      return Promise.resolve({ value: null });
    },
  });
  const invalidLocators = [
    null,
    {},
    { ...validLocator(), unexpected: true },
    validLocator({ account_id: 'account_other' }),
    validLocator({ profile_id: 'operator' }),
    validLocator({ scope_agent_id: 'chat_agent' }),
    validLocator({ scope_agent_id: 'agent_' }),
    validLocator({ key: 'another_registry' }),
    validLocator({ global: false }),
  ];

  for (const locator of invalidLocators) {
    const result = plain(await runtime.provider.load({
      actorId: 'account_demo',
      locator,
      now: '2026-07-27T12:01:00Z',
    }));
    assert.equal(result.complete, false);
    assert.equal(warningCode(result), 'MCP_REGISTRY_SCOPE_UNAVAILABLE');
  }
  assert.equal(reads, 0);
});

test('legacy-key stub is never read and missing sole source has no fallback', async () => {
  const legacyKey = ['xtl_evolution', 'mcp_registry', 'v1'].join(':');
  const reads = [];
  let document;
  const runtime = loadRuntime({
    kvGet(key) {
      reads.push(key);
      if (key === legacyKey) {
        return Promise.resolve({ value: document });
      }
      return Promise.resolve({
        status: 'not_found',
        message: 'key not found',
      });
    },
  });
  document = emptyRegistry(runtime.contract);

  const result = plain(await runtime.provider.load({
    actorId: 'account_demo',
    locator: validLocator(),
    now: '2026-07-27T12:01:00Z',
  }));

  assert.deepEqual(reads, [registryKey]);
  assert.equal(result.complete, false);
  assert.equal(warningCode(result), 'MCP_REGISTRY_UNAVAILABLE');
});

test('HTTP 500 is one failed read with no fallback', async () => {
  const reads = [];
  const runtime = loadRuntime({
    kvGet(key, scope) {
      reads.push({ key, scope: plain(scope) });
      return Promise.resolve({
        status: 500,
        message: 'internal error',
      });
    },
  });

  const result = plain(await runtime.provider.load({
    actorId: 'account_demo',
    locator: validLocator(),
    now: '2026-07-27T12:01:00Z',
  }));

  assert.equal(reads.length, 1);
  assert.deepEqual(reads[0], {
    key: registryKey,
    scope: {
      global: true,
      agentId: 'agent_registry_owner',
    },
  });
  assert.equal(result.complete, false);
  assert.equal(warningCode(result), 'MCP_REGISTRY_UNAVAILABLE');
});

test('current chat-agent hints cannot change the trusted locator scope', async () => {
  const scopes = [];
  let document;
  const runtime = loadRuntime({
    kvGet(_key, scope) {
      scopes.push(plain(scope));
      return Promise.resolve({ value: document });
    },
  });
  document = emptyRegistry(runtime.contract);

  await runtime.provider.load({
    actorId: 'account_demo',
    agentId: 'agent_current_chat_a',
    currentAgentId: 'agent_current_chat_a',
    locator: validLocator(),
  });
  await runtime.provider.load({
    actorId: 'account_demo',
    agentId: 'agent_current_chat_b',
    currentAgentId: 'agent_current_chat_b',
    locator: validLocator(),
  });

  assert.deepEqual(scopes, [
    { global: true, agentId: 'agent_registry_owner' },
    { global: true, agentId: 'agent_registry_owner' },
  ]);
});

test('malformed and secret-bearing documents stay invalid and incomplete', async () => {
  const responses = [];
  const runtime = loadRuntime({
    kvGet() {
      return Promise.resolve(responses.shift());
    },
  });
  const secretRegistry = emptyRegistry(runtime.contract);
  secretRegistry.token = 'plain-text-token';
  responses.push(
    { value: '{"not valid JSON"' },
    { value: secretRegistry },
  );

  const malformed = plain(await runtime.provider.load({
    actorId: 'account_demo',
    locator: validLocator(),
    now: '2026-07-27T12:01:00Z',
  }));
  const secret = plain(await runtime.provider.load({
    actorId: 'account_demo',
    locator: validLocator(),
    now: '2026-07-27T12:01:00Z',
  }));

  assert.equal(malformed.complete, false);
  assert.equal(warningCode(malformed), 'MCP_REGISTRY_INVALID');
  assert.equal(secret.complete, false);
  assert.equal(warningCode(secret), 'MCP_REGISTRY_INVALID');
  assert.doesNotMatch(JSON.stringify(secret), /plain-text-token/);
});

test('registry owned by another account is rejected, never downgraded', async () => {
  let document;
  const runtime = loadRuntime({
    kvGet() {
      return Promise.resolve({ value: document });
    },
  });
  document = emptyRegistry(runtime.contract, 'account_other');

  await assert.rejects(
    runtime.provider.load({
      actorId: 'account_demo',
      locator: validLocator(),
      now: '2026-07-27T12:01:00Z',
    }),
    (error) => {
      assert.equal(error.code, 'MCP_REGISTRY_ACCOUNT_MISMATCH');
      return true;
    },
  );
});

test('context drift after the scoped read is propagated fail-closed', async () => {
  let checks = 0;
  let document;
  const runtime = loadRuntime({
    kvGet() {
      return Promise.resolve({ value: document });
    },
  });
  document = emptyRegistry(runtime.contract);

  await assert.rejects(
    runtime.provider.load({
      actorId: 'account_demo',
      locator: validLocator(),
      assertContext() {
        checks += 1;
        if (checks > 1) {
          const contextError = new Error('account changed');
          contextError.code = 'ACCOUNT_CONTEXT_CHANGED';
          throw contextError;
        }
      },
    }),
    (error) => {
      assert.equal(error.code, 'ACCOUNT_CONTEXT_CHANGED');
      return true;
    },
  );
});

test('provider has one read/key and no persistence, fallback or execution', () => {
  const legacyKey = ['xtl_evolution', 'mcp_registry', 'v1'].join(':');

  assert.doesNotMatch(providerSource, new RegExp(legacyKey));
  assert.doesNotMatch(
    providerSource,
    /\bkvSet\b|\blocalStorage\b|\brunExpert\b|\bsaveExpert\b|\bfetch\s*\(|\bXMLHttpRequest\b/,
  );
  assert.equal(
    [...providerSource.matchAll(/api\.kvGet\(/g)].length,
    1,
  );
  assert.equal(
    [...providerSource.matchAll(/_mkt_xtl_evolution_mcp_registry_v1/g)]
      .length,
    1,
  );
});
