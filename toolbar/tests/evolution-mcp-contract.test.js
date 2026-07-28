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
    schema: 'extella.evolution.mcp_registry.v1.1',
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
      platform_managed: false,
      scope_boundary: 'AUTOMATION_SCOPED',
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
    availability: [{
      automation_id: 'automation.demo',
      connections: 'OBSERVED',
      tool_contracts: 'OBSERVED',
      extensions: 'OBSERVED',
      bindings: 'OBSERVED',
      run_evidence: 'OBSERVED',
    }],
    access_posture: [{
      platform_agent_id: 'agent_demo',
      scope: 'AUTOMATION_SCOPED',
      policy: 'SCOPED',
      risk: 'LEAST_PRIVILEGE',
      observed_tool_count: 1,
      business_tool_count: 1,
      risk_evidence_tool_ids: [],
    }],
    warnings: [],
  };
}

function validLegacyRegistry() {
  const registry = validRegistry();
  registry.schema = 'extella.evolution.mcp_registry.v1';
  delete registry.availability;
  delete registry.access_posture;
  delete registry.connections[0].platform_managed;
  delete registry.connections[0].scope_boundary;
  return registry;
}

function makeSharedPlatformConnection(
  registry,
  automationIds = ['automation.demo'],
) {
  const connection = registry.connections[0];
  delete connection.automation_id;
  connection.automation_ids = automationIds;
  connection.transport = null;
  connection.platform_managed = true;
  connection.scope_boundary = 'ACCOUNT_SHARED_PLATFORM';
  connection.endpoint = null;
  connection.credential_ref = null;
  connection.provenance = {
    kind: 'platform_observed',
    source_id: 'travel.mcp.live_facts',
    source_version: null,
    sha256: null,
  };
  return connection;
}

test('contract exposes only the exact read allowlist', () => {
  const contract = loadContract();
  assert.equal(
    contract.CONTRACT_SCHEMA,
    'extella.evolution.mcp_read_contract.v1.1',
  );
  assert.equal(
    contract.REGISTRY_SCHEMA,
    'extella.evolution.mcp_registry.v1.1',
  );
  assert.equal(
    contract.LEGACY_REGISTRY_SCHEMA,
    'extella.evolution.mcp_registry.v1',
  );
  assert.equal(
    contract.RESPONSE_SCHEMA,
    'extella.evolution.mcp_read_response.v1.1',
  );
  assert.equal(
    contract.SNAPSHOT_SCHEMA,
    'extella.evolution.mcp_read_snapshot.v1.1',
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

test('legacy v1 remains strictly supported without v1.1 fields', () => {
  const contract = loadContract();
  const registry = validLegacyRegistry();
  assert.deepEqual(plain(contract.validateRegistry(registry)), registry);

  const currentFieldInLegacy = validLegacyRegistry();
  currentFieldInLegacy.availability = [];
  assert.throws(
    () => contract.validateRegistry(currentFieldInLegacy),
    (error) => {
      assert.equal(error.code, 'MCP_REGISTRY_INVALID');
      return true;
    },
  );

  const legacyConnectionWithScope = validLegacyRegistry();
  legacyConnectionWithScope.connections[0].scope_boundary =
    'AUTOMATION_SCOPED';
  assert.throws(
    () => contract.validateRegistry(legacyConnectionWithScope),
    (error) => {
      assert.equal(error.code, 'MCP_CONNECTION_INVALID');
      return true;
    },
  );

  const incompleteLegacy = validLegacyRegistry();
  incompleteLegacy.complete = false;
  incompleteLegacy.warnings = [{
    code: 'LEGACY_SOURCE_PARTIAL',
    message_ru: 'Источник неполный.',
    message_en: 'The source is partial.',
    source: 'evolution.mcp.registry',
  }];
  assert.doesNotThrow(() => contract.validateRegistry(incompleteLegacy));
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
    severity: 'warning',
    affects_completeness: false,
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

test('v1.1 shared platform connection records one observed account fact', () => {
  const contract = loadContract();
  const registry = validRegistry();
  makeSharedPlatformConnection(registry);
  assert.doesNotThrow(() => contract.validateRegistry(registry));

  for (const mutate of [
    (row) => { row.endpoint = 'https://mcp.example.test'; },
    (row) => { row.credential_ref = 'credential:platform/shared'; },
    (row) => { row.scope_boundary = 'AUTOMATION_SCOPED'; },
    (row) => { row.platform_managed = false; },
    (row) => { row.transport = 'sse'; },
    (row) => { row.provenance.source_version = '1.0.0'; },
    (row) => { row.provenance.sha256 = 'f'.repeat(64); },
  ]) {
    const invalid = validRegistry();
    const row = makeSharedPlatformConnection(invalid);
    mutate(row);
    assert.throws(
      () => contract.validateRegistry(invalid),
      (error) => {
        assert.equal(error.code, 'MCP_CONNECTION_INVALID');
        return true;
      },
    );
  }
});

test('v1.1 Connection consumer forms are a closed exclusive one-of', () => {
  const contract = loadContract();

  const mixed = validRegistry();
  makeSharedPlatformConnection(mixed);
  mixed.connections[0].automation_id = 'automation.demo';
  assert.throws(
    () => contract.validateRegistry(mixed),
    (error) => {
      assert.equal(error.code, 'MCP_CONNECTION_INVALID');
      return true;
    },
  );

  const missing = validRegistry();
  delete missing.connections[0].automation_id;
  assert.throws(
    () => contract.validateRegistry(missing),
    (error) => {
      assert.equal(error.code, 'MCP_CONNECTION_INVALID');
      return true;
    },
  );

  for (const consumers of [
    [],
    ['automation.demo', 'automation.demo'],
    ['Automation.INVALID'],
  ]) {
    const invalid = validRegistry();
    makeSharedPlatformConnection(invalid, consumers);
    assert.throws(
      () => contract.validateRegistry(invalid),
      (error) => {
        assert.equal(error.code, 'MCP_CONNECTION_INVALID');
        return true;
      },
    );
  }

  const falselyManagedDirect = validRegistry();
  falselyManagedDirect.connections[0].platform_managed = true;
  assert.throws(
    () => contract.validateRegistry(falselyManagedDirect),
    (error) => {
      assert.equal(error.code, 'MCP_CONNECTION_INVALID');
      return true;
    },
  );
});

test('one shared Connection can serve multiple declared automations', () => {
  const contract = loadContract();
  const registry = validRegistry();
  makeSharedPlatformConnection(
    registry,
    ['automation.demo', 'automation.second'],
  );
  registry.availability.push({
    automation_id: 'automation.second',
    connections: 'OBSERVED',
    tool_contracts: 'OBSERVED_EMPTY',
    extensions: 'OBSERVED_EMPTY',
    bindings: 'OBSERVED_EMPTY',
    run_evidence: 'OBSERVED_EMPTY',
  });

  const validated = plain(contract.validateRegistry(registry));
  assert.equal(validated.connections.length, 1);
  assert.deepEqual(
    validated.connections[0].automation_ids,
    ['automation.demo', 'automation.second'],
  );
});

test('shared Connection consumers participate in referential integrity', () => {
  const contract = loadContract();

  const foreignTool = validRegistry();
  makeSharedPlatformConnection(foreignTool, ['automation.other']);
  assert.throws(
    () => contract.validateRegistry(foreignTool),
    (error) => {
      assert.equal(error.code, 'MCP_TOOL_CONNECTION_DANGLING');
      return true;
    },
  );

  const missingAvailability = validRegistry();
  makeSharedPlatformConnection(
    missingAvailability,
    ['automation.demo', 'automation.other'],
  );
  assert.throws(
    () => contract.validateRegistry(missingAvailability),
    (error) => {
      assert.equal(error.code, 'MCP_REGISTRY_AVAILABILITY_MISSING');
      return true;
    },
  );
});

test('availability is unique, per automation and consistent with row presence', () => {
  const contract = loadContract();

  const duplicate = validRegistry();
  duplicate.availability.push({ ...duplicate.availability[0] });
  assert.throws(
    () => contract.validateRegistry(duplicate),
    (error) => {
      assert.equal(error.code, 'MCP_AVAILABILITY_INVALID');
      return true;
    },
  );

  const missing = validRegistry();
  missing.availability[0].automation_id = 'automation.other';
  assert.throws(
    () => contract.validateRegistry(missing),
    (error) => {
      assert.equal(error.code, 'MCP_REGISTRY_AVAILABILITY_MISSING');
      return true;
    },
  );

  const observedWithoutRows = validRegistry();
  observedWithoutRows.run_evidence = [];
  assert.throws(
    () => contract.validateRegistry(observedWithoutRows),
    (error) => {
      assert.equal(error.code, 'MCP_AVAILABILITY_INVALID');
      return true;
    },
  );

  for (const state of [
    'OBSERVED_EMPTY',
    'NOT_EXPOSED',
    'NOT_APPLICABLE',
    'UNAVAILABLE',
    'UNKNOWN',
  ]) {
    const rowsForbidden = validRegistry();
    rowsForbidden.availability[0].run_evidence = state;
    assert.throws(
      () => contract.validateRegistry(rowsForbidden),
      (error) => {
        assert.equal(error.code, 'MCP_AVAILABILITY_INVALID');
        return true;
      },
    );
  }
});

test('availability controls completeness without turning honest emptiness into failure', () => {
  const contract = loadContract();
  const honestlyEmpty = validRegistry();
  honestlyEmpty.run_evidence = [];
  honestlyEmpty.availability[0].run_evidence = 'OBSERVED_EMPTY';
  assert.doesNotThrow(() => contract.validateRegistry(honestlyEmpty));

  for (const state of [
    'PARTIAL',
    'NOT_EXPOSED',
    'UNAVAILABLE',
    'UNKNOWN',
  ]) {
    const falselyComplete = validRegistry();
    if (state !== 'PARTIAL') falselyComplete.run_evidence = [];
    falselyComplete.availability[0].run_evidence = state;
    assert.throws(
      () => contract.validateRegistry(falselyComplete),
      (error) => {
        assert.equal(
          error.code,
          'MCP_REGISTRY_AVAILABILITY_COMPLETENESS_INVALID',
        );
        return true;
      },
    );
  }

  const incomplete = validRegistry();
  incomplete.complete = false;
  incomplete.run_evidence = [];
  incomplete.availability[0].run_evidence = 'NOT_EXPOSED';
  incomplete.warnings = [{
    code: 'RUNS_NOT_EXPOSED',
    message_ru: 'Прогоны не раскрыты.',
    message_en: 'Runs are not exposed.',
    source: 'evolution.mcp.registry',
    severity: 'warning',
    affects_completeness: true,
  }];
  assert.doesNotThrow(() => contract.validateRegistry(incomplete));
});

test('UNKNOWN binding state requires explicit partial coverage', () => {
  const contract = loadContract();
  const contradictory = validRegistry();
  contradictory.bindings[0].enabled = 'UNKNOWN';

  assert.throws(
    () => contract.validateRegistry(contradictory),
    (error) => {
      assert.equal(error.code, 'MCP_AVAILABILITY_INVALID');
      return true;
    },
  );

  const partial = validRegistry();
  partial.complete = false;
  partial.bindings[0].enabled = 'UNKNOWN';
  partial.availability[0].bindings = 'PARTIAL';
  partial.warnings = [{
    code: 'BINDING_STATE_UNKNOWN',
    message_ru: 'Состояние привязки не подтверждено.',
    message_en: 'The binding state is not proven.',
    source: 'evolution.mcp.registry',
    severity: 'warning',
    affects_completeness: true,
  }];
  assert.doesNotThrow(() => contract.validateRegistry(partial));
});

test('access posture is closed, bounded and evidence-backed', () => {
  const contract = loadContract();
  const duplicate = validRegistry();
  duplicate.access_posture.push({ ...duplicate.access_posture[0] });
  assert.throws(
    () => contract.validateRegistry(duplicate),
    (error) => {
      assert.equal(error.code, 'MCP_ACCESS_POSTURE_INVALID');
      return true;
    },
  );

  for (const mutate of [
    (row) => { row.observed_tool_count = -1; },
    (row) => { row.observed_tool_count = 100001; },
    (row) => { row.business_tool_count = 2; },
    (row) => {
      row.risk = 'EXCESSIVE';
      row.risk_evidence_tool_ids = [];
    },
  ]) {
    const invalid = validRegistry();
    mutate(invalid.access_posture[0]);
    assert.throws(
      () => contract.validateRegistry(invalid),
      (error) => {
        assert.equal(error.code, 'MCP_ACCESS_POSTURE_INVALID');
        return true;
      },
    );
  }

  const noBindings = validRegistry();
  noBindings.bindings = [];
  noBindings.run_evidence = [];
  noBindings.availability[0].bindings = 'NOT_APPLICABLE';
  noBindings.availability[0].run_evidence = 'OBSERVED_EMPTY';
  noBindings.access_posture = [];
  assert.throws(
    () => contract.validateRegistry(noBindings),
    (error) => {
      assert.equal(error.code, 'MCP_AVAILABILITY_INVALID');
      return true;
    },
  );
});

test('v1.1 warning fields are closed and affecting warnings explain incompleteness', () => {
  const contract = loadContract();
  const missingFields = validRegistry();
  missingFields.complete = false;
  missingFields.warnings = [{
    code: 'PARTIAL_SOURCE',
    message_ru: 'Источник неполный.',
    message_en: 'The source is partial.',
    source: 'evolution.mcp.registry',
  }];
  assert.throws(
    () => contract.validateRegistry(missingFields),
    (error) => {
      assert.equal(error.code, 'MCP_REGISTRY_WARNING_INVALID');
      return true;
    },
  );

  const nonAffecting = validRegistry();
  nonAffecting.complete = false;
  nonAffecting.warnings = [{
    code: 'INFORMATION_ONLY',
    message_ru: 'Информация.',
    message_en: 'Information.',
    source: 'evolution.mcp.registry',
    severity: 'info',
    affects_completeness: false,
  }];
  assert.throws(
    () => contract.validateRegistry(nonAffecting),
    (error) => {
      assert.equal(error.code, 'MCP_REGISTRY_INCOMPLETE_WITHOUT_WARNING');
      return true;
    },
  );

  const contradictoryComplete = validRegistry();
  contradictoryComplete.warnings = [{
    code: 'SOURCE_PARTIAL',
    message_ru: 'Источник неполный.',
    message_en: 'The source is partial.',
    source: 'evolution.mcp.registry',
    severity: 'warning',
    affects_completeness: true,
  }];
  assert.throws(
    () => contract.validateRegistry(contradictoryComplete),
    (error) => {
      assert.equal(
        error.code,
        'MCP_REGISTRY_WARNING_COMPLETENESS_INVALID',
      );
      return true;
    },
  );
});

test('reviewed Travel Registry example validates without invented MCP facts', () => {
  const contract = loadContract();
  const examplePath = path.resolve(
    toolbarRoot,
    '..',
    'docs',
    'EVOLUTION_MCP_TRAVEL_REGISTRY_V1_1.example.json',
  );
  const example = JSON.parse(fs.readFileSync(examplePath, 'utf8'));
  const validated = plain(contract.validateRegistry(
    example,
    { accountId: 'account_demo' },
  ));

  assert.equal(validated.complete, false);
  assert.equal(validated.source.kind, 'REVIEWED_LIVE_FACTS');
  assert.equal(validated.source.version, null);
  assert.equal(
    validated.availability[0].automation_id,
    'extella_travel_agency',
  );
  assert.equal(validated.availability[0].tool_contracts, 'NOT_EXPOSED');
  assert.deepEqual(validated.tools, []);
  assert.deepEqual(validated.extensions, []);
  assert.deepEqual(validated.bindings, []);
  assert.deepEqual(validated.run_evidence, []);
  assert.equal(validated.connections[0].endpoint, null);
  assert.equal(validated.connections[0].provenance.source_version, null);
  assert.equal(validated.connections[0].provenance.sha256, null);
  assert.equal(validated.access_posture[0].observed_tool_count, 48);
  assert.equal(validated.access_posture[0].business_tool_count, 0);
  assert.deepEqual(
    validated.access_posture[0].risk_evidence_tool_ids,
    [
      'agent_delete_mcp_extella',
      'profile_delete_mcp_extella',
      'token_generate_mcp_extella',
    ],
  );

  const inventedSourceVersion = JSON.parse(JSON.stringify(example));
  inventedSourceVersion.source.version = '1.0.0';
  assert.throws(
    () => contract.validateRegistry(inventedSourceVersion),
    (error) => {
      assert.equal(error.code, 'MCP_REGISTRY_SOURCE_INVALID');
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
  assert.equal(unavailable.schema, 'extella.evolution.mcp_registry.v1.1');
  assert.equal(unavailable.complete, false);
  assert.equal(unavailable.source.kind, 'UNAVAILABLE');
  assert.equal(unavailable.source.sha256, null);
  assert.equal(unavailable.connections.length, 0);
  assert.deepEqual(unavailable.availability, []);
  assert.deepEqual(unavailable.access_posture, []);
  assert.equal(unavailable.warnings.length, 1);
  assert.equal(unavailable.warnings[0].severity, 'warning');
  assert.equal(unavailable.warnings[0].affects_completeness, true);
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
    severity: 'warning',
    affects_completeness: true,
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
