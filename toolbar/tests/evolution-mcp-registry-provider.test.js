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

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function emptyRegistry(accountId = 'account_demo') {
  return {
    schema: 'extella.evolution.mcp_registry.v1',
    owner_account_id: accountId,
    checked_at: '2026-07-27T12:00:00Z',
    complete: true,
    source: {
      kind: 'ACCOUNT_SCOPED_HOST_PROVIDER',
      id: 'evolution.mcp.registry',
      version: '1.0.0',
      sha256: 'a'.repeat(64),
    },
    connections: [],
    tools: [],
    extensions: [],
    bindings: [],
    run_evidence: [],
    warnings: [],
  };
}

function loadProvider(api) {
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
  return context.ETB.evolutionMcpRegistryProvider;
}

test('provider reads one exact account-global key and fences context', async () => {
  const reads = [];
  let contextChecks = 0;
  const provider = loadProvider({
    kvGet(key, scope) {
      reads.push({ key, scope: plain(scope) });
      return Promise.resolve({ value: JSON.stringify(emptyRegistry()) });
    },
  });
  const result = plain(await provider.load({
    actorId: 'account_demo',
    accountId: 'account_demo',
    now: '2026-07-27T12:01:00Z',
    assertContext() {
      contextChecks += 1;
    },
  }));

  assert.deepEqual(reads, [{
    key: 'xtl_evolution:mcp_registry:v1',
    scope: { global: true },
  }]);
  assert.ok(contextChecks >= 3);
  assert.equal(result.complete, true);
  assert.equal(result.owner_account_id, 'account_demo');
});

test('missing source stays explicit incomplete instead of empty success', async () => {
  const provider = loadProvider({
    kvGet() {
      return Promise.resolve({
        status: 'not_found',
        message: 'key not found',
      });
    },
  });
  const result = plain(await provider.load({
    actorId: 'account_demo',
    now: '2026-07-27T12:01:00Z',
  }));

  assert.equal(result.complete, false);
  assert.equal(result.source.kind, 'UNAVAILABLE');
  assert.equal(result.source.sha256, null);
  assert.equal(result.warnings[0].code, 'MCP_REGISTRY_UNAVAILABLE');
});

test('malformed or secret-bearing source is downgraded to invalid incomplete', async () => {
  const registry = emptyRegistry();
  registry.token = 'plain-text-token';
  const provider = loadProvider({
    kvGet() {
      return Promise.resolve({ value: registry });
    },
  });
  const result = plain(await provider.load({
    actorId: 'account_demo',
    now: '2026-07-27T12:01:00Z',
  }));

  assert.equal(result.complete, false);
  assert.equal(result.warnings[0].code, 'MCP_REGISTRY_INVALID');
  assert.doesNotMatch(JSON.stringify(result), /plain-text-token/);
});

test('registry owned by another account is rejected, never downgraded', async () => {
  const provider = loadProvider({
    kvGet() {
      return Promise.resolve({ value: emptyRegistry('account_other') });
    },
  });
  await assert.rejects(
    provider.load({
      actorId: 'account_demo',
      now: '2026-07-27T12:01:00Z',
    }),
    (error) => {
      assert.equal(error.code, 'MCP_REGISTRY_ACCOUNT_MISMATCH');
      return true;
    },
  );
});

test('context drift after the read is propagated fail-closed', async () => {
  let checks = 0;
  const provider = loadProvider({
    kvGet() {
      return Promise.resolve({ value: emptyRegistry() });
    },
  });
  await assert.rejects(
    provider.load({
      actorId: 'account_demo',
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

test('provider has no persistence, fallback source or execution primitive', () => {
  assert.doesNotMatch(
    providerSource,
    /\bkvSet\b|\blocalStorage\b|\brunExpert\b|\bsaveExpert\b|\bfetch\s*\(|\bXMLHttpRequest\b/,
  );
  assert.equal(
    [...providerSource.matchAll(/api\.kvGet\(/g)].length,
    1,
  );
  assert.equal(
    [...providerSource.matchAll(/xtl_evolution:mcp_registry:v1/g)].length,
    1,
  );
});
