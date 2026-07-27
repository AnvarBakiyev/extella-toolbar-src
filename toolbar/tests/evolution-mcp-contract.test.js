'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const toolbarRoot = path.resolve(__dirname, '..');
const contractPath = path.join(
  toolbarRoot,
  'src',
  'core',
  'evolution-mcp-contract.js',
);
const contractSource = fs.readFileSync(contractPath, 'utf8');

function loadContract() {
  const context = { ETB: {} };
  vm.runInNewContext(contractSource, context, {
    filename: 'evolution-mcp-contract.js',
  });
  return context.ETB.evolutionMcpContract;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function provenance(kind = 'local', sha = 'a'.repeat(64)) {
  return {
    kind,
    source_id: kind === 'shared'
      ? 'shared.extension.audit'
      : 'automation.demo.passport',
    source_version: '1.2.3',
    sha256: sha,
  };
}

function closedSchema(properties = {}) {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
  };
}

function validRegistry() {
  return {
    schema: 'extella.evolution.mcp_registry.v1',
    owner_account_id: 'account_demo',
    checked_at: '2026-07-27T12:00:00Z',
    complete: true,
    source: {
      kind: 'ACCOUNT_SCOPED_HOST_PROVIDER',
      id: 'evolution.mcp.registry',
      version: '1.0.0',
      sha256: '1'.repeat(64),
    },
    connections: [{
      connection_id: 'connection.crm',
      automation_id: 'automation.demo',
      name: { ru: 'CRM', en: 'CRM' },
      transport: 'streamable_http',
      endpoint: 'https://mcp.example.test/v1',
      credential_ref: 'credential:extella/crm',
      health: {
        status: 'UP',
        checked_at: '2026-07-27T11:59:00Z',
      },
      provenance: provenance(),
    }],
    tools: [{
      tool_id: 'tool.crm.read',
      automation_id: 'automation.demo',
      connection_id: 'connection.crm',
      name: { ru: 'Читать клиента', en: 'Read customer' },
      version: '2.1.0',
      input_schema: closedSchema({
        customer_id: { type: 'string' },
      }),
      output_schema: closedSchema({
        customer: { type: 'object' },
      }),
      risk_class: 'read',
      side_effects: 'none',
      timeout_ms: 5000,
      permissions: ['crm:read'],
      provenance: provenance(),
    }],
    extensions: [{
      extension_id: 'extension.audit',
      automation_ids: ['automation.demo'],
      name: { ru: 'Аудит вызова', en: 'Call audit' },
      version: '1.0.0',
      hooks: ['authorize', 'after_call'],
      package_sha256: 'b'.repeat(64),
      provenance: provenance('shared', 'c'.repeat(64)),
    }],
    bindings: [{
      binding_id: 'binding.agent.crm',
      automation_id: 'automation.demo',
      platform_agent_id: 'agent_demo',
      tool_id: 'tool.crm.read',
      extension_ids: ['extension.audit'],
      enabled: true,
      permission_policy: {
        allow: ['crm:read'],
        deny: [],
      },
      provenance: provenance(),
    }],
    run_evidence: [{
      evidence_id: 'evidence.crm.001',
      automation_id: 'automation.demo',
      platform_agent_id: 'agent_demo',
      tool_id: 'tool.crm.read',
      binding_id: 'binding.agent.crm',
      occurred_at: '2026-07-27T11:58:00Z',
      status: 'SUCCEEDED',
      latency_ms: 120,
      cost: {
        amount: 0.001,
        currency: 'USD',
        estimated: true,
      },
      input_sha256: 'd'.repeat(64),
      output_sha256: 'e'.repeat(64),
      provenance: provenance(),
    }],
    warnings: [],
  };
}

test('contract exposes only the exact read allowlist', () => {
  const contract = loadContract();
  assert.equal(
    contract.CONTRACT_SCHEMA,
    'extella.evolution.mcp_read_contract.v1',
  );
  assert.deepEqual(plain(contract.toolNames()), [
    'automations.list',
    'automations.get',
    'automations.get_state',
    'automations.get_composition',
    'mcp.connections.list',
    'mcp.tools.list',
    'mcp.extensions.list',
    'mcp.bindings.list',
    'runs.get_evidence',
  ]);
  assert.doesNotMatch(
    contract.toolNames().join(' '),
    /\b(?:run|save|publish|activate|rollback|request)\b/,
  );
});

test('all five MCP objects validate with exact references and clone-only output', () => {
  const contract = loadContract();
  const registry = validRegistry();
  const validated = plain(contract.validateRegistry(
    registry,
    { accountId: 'account_demo' },
  ));

  assert.deepEqual(validated, registry);
  assert.notEqual(validated, registry);
  assert.notEqual(validated.connections[0], registry.connections[0]);
});

test('account ownership fails closed', () => {
  const contract = loadContract();
  assert.throws(
    () => contract.validateRegistry(
      validRegistry(),
      { accountId: 'account_other' },
    ),
    (error) => {
      assert.equal(error.code, 'MCP_REGISTRY_ACCOUNT_MISMATCH');
      return true;
    },
  );
});

test('duplicate and dangling references are rejected', () => {
  const contract = loadContract();
  const duplicate = validRegistry();
  duplicate.connections.push({ ...duplicate.connections[0] });
  assert.throws(
    () => contract.validateRegistry(duplicate),
    (error) => {
      assert.equal(error.code, 'MCP_CONNECTION_INVALID');
      return true;
    },
  );

  const dangling = validRegistry();
  dangling.tools[0].connection_id = 'connection.missing';
  assert.throws(
    () => contract.validateRegistry(dangling),
    (error) => {
      assert.equal(error.code, 'MCP_TOOL_CONNECTION_DANGLING');
      return true;
    },
  );

  const evidenceMismatch = validRegistry();
  evidenceMismatch.run_evidence[0].platform_agent_id = 'agent_other';
  assert.throws(
    () => contract.validateRegistry(evidenceMismatch),
    (error) => {
      assert.equal(error.code, 'MCP_RUN_EVIDENCE_REFERENCE_DANGLING');
      return true;
    },
  );
});

test('secret-like values and secret-bearing schemas are rejected', () => {
  const contract = loadContract();
  const schemaLeak = validRegistry();
  schemaLeak.tools[0].input_schema.properties.apiKey = { type: 'string' };
  assert.throws(
    () => contract.validateRegistry(schemaLeak),
    (error) => {
      assert.equal(error.code, 'MCP_SECRET_FIELD_FORBIDDEN');
      return true;
    },
  );

  const endpointLeak = validRegistry();
  endpointLeak.connections[0].endpoint =
    'https://mcp.example.test/v1?token=plain-text-value';
  assert.throws(
    () => contract.validateRegistry(endpointLeak),
    (error) => {
      assert.equal(error.code, 'MCP_SECRET_VALUE_FORBIDDEN');
      return true;
    },
  );

  for (const endpoint of [
    'https://mcp.example.test/v1?client_secret=plain-text-value',
    'https://mcp.example.test/v1?accessToken=plain-text-value',
    'https://mcp.example.test/v1?client%5Fsecret=plain-text-value',
    'https://mcp.example.test/v1?auth[token]=plain-text-value',
    'https://mcp.example.test/v1?client_secret[]=plain-text-value',
  ]) {
    const queryLeak = validRegistry();
    queryLeak.connections[0].endpoint = endpoint;
    assert.throws(
      () => contract.validateRegistry(queryLeak),
      (error) => {
        assert.equal(error.code, 'MCP_SECRET_VALUE_FORBIDDEN');
        return true;
      },
    );
  }

  const benignKeys = validRegistry();
  benignKeys.tools[0].input_schema.properties = {
    token_count: { type: 'integer' },
    cookie_policy: { type: 'string' },
    authorization_mode: { type: 'string' },
  };
  benignKeys.connections[0].endpoint =
    'https://mcp.example.test/v1?token_count=10' +
    '&cookie_policy=strict&authorization_mode=delegated';
  assert.doesNotThrow(() => contract.validateRegistry(benignKeys));

  const userinfoLeak = validRegistry();
  userinfoLeak.connections[0].endpoint =
    'https://reader@mcp.example.test/v1';
  assert.throws(
    () => contract.validateRegistry(userinfoLeak),
    (error) => {
      assert.equal(error.code, 'MCP_CONNECTION_INVALID');
      return true;
    },
  );

  const bearerLeak = validRegistry();
  bearerLeak.warnings.push({
    code: 'SOURCE_WARNING',
    message_ru: 'Bearer abcdefghijklmnop',
    message_en: 'Source warning',
    source: 'evolution.mcp.registry',
  });
  assert.throws(
    () => contract.validateRegistry(bearerLeak),
    (error) => {
      assert.equal(error.code, 'MCP_SECRET_VALUE_FORBIDDEN');
      return true;
    },
  );
});

test('unknown fields and contradictory risk facts are rejected', () => {
  const contract = loadContract();
  const unknown = validRegistry();
  unknown.connections[0].credential_value = 'forbidden';
  assert.throws(
    () => contract.validateRegistry(unknown),
    (error) => {
      assert.equal(error.code, 'MCP_CONNECTION_INVALID');
      return true;
    },
  );

  const risk = validRegistry();
  risk.tools[0].risk_class = 'reversible_write';
  assert.throws(
    () => contract.validateRegistry(risk),
    (error) => {
      assert.equal(error.code, 'MCP_TOOL_CONTRACT_INVALID');
      return true;
    },
  );
});

test('unavailable registry is explicitly incomplete and claims no source hash', () => {
  const contract = loadContract();
  const unavailable = plain(contract.unavailableRegistry(
    'account_demo',
    '2026-07-27T12:00:00Z',
    'MCP_REGISTRY_UNAVAILABLE',
  ));
  assert.equal(unavailable.complete, false);
  assert.equal(unavailable.source.kind, 'UNAVAILABLE');
  assert.equal(unavailable.source.sha256, null);
  assert.equal(unavailable.connections.length, 0);
  assert.equal(unavailable.warnings.length, 1);
  assert.deepEqual(
    plain(contract.validateRegistry(
      unavailable,
      { accountId: 'account_demo' },
    )),
    unavailable,
  );
});

test('incomplete registry cannot silently look like a successful empty source', () => {
  const contract = loadContract();
  const registry = validRegistry();
  registry.complete = false;
  registry.warnings = [];
  assert.throws(
    () => contract.validateRegistry(registry),
    (error) => {
      assert.equal(error.code, 'MCP_REGISTRY_INCOMPLETE_WITHOUT_WARNING');
      return true;
    },
  );
});

test('an unavailable source cannot claim completeness or stale topology facts', () => {
  const contract = loadContract();
  const complete = validRegistry();
  complete.source = {
    kind: 'UNAVAILABLE',
    id: 'evolution.mcp.registry',
    version: '1.0.0',
    sha256: null,
  };
  assert.throws(
    () => contract.validateRegistry(complete),
    (error) => {
      assert.equal(
        error.code,
        'MCP_REGISTRY_SOURCE_COMPLETENESS_INVALID',
      );
      return true;
    },
  );

  const stale = validRegistry();
  stale.complete = false;
  stale.source = {
    kind: 'UNAVAILABLE',
    id: 'evolution.mcp.registry',
    version: '1.0.0',
    sha256: null,
  };
  stale.warnings = [{
    code: 'MCP_REGISTRY_UNAVAILABLE',
    message_ru: 'Источник недоступен.',
    message_en: 'The source is unavailable.',
    source: 'evolution.mcp.registry',
  }];
  assert.throws(
    () => contract.validateRegistry(stale),
    (error) => {
      assert.equal(
        error.code,
        'MCP_REGISTRY_SOURCE_COMPLETENESS_INVALID',
      );
      return true;
    },
  );
});
