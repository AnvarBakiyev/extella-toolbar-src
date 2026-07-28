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
const gatewaySource = fs.readFileSync(path.join(
  toolbarRoot,
  'src',
  'core',
  'evolution-mcp-read-gateway.js',
), 'utf8');
const travelRegistry = JSON.parse(fs.readFileSync(path.join(
  toolbarRoot,
  '..',
  'docs',
  'EVOLUTION_MCP_TRAVEL_REGISTRY_V1_1.example.json',
), 'utf8'));

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function provenance(kind = 'local', hash = 'a'.repeat(64)) {
  return {
    kind,
    source_id: kind === 'shared'
      ? 'shared.extension.audit'
      : 'automation.demo.passport',
    source_version: '1.0.0',
    sha256: hash,
  };
}

function closedSchema(properties = {}) {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
  };
}

function automationRegistry(complete = true) {
  return {
    schema: 'extella.evolution.automation_registry.v1',
    scope: 'CURRENT_DEVICE',
    checked_at: '2026-07-27T12:00:00Z',
    complete,
    rows: [{
      automation_id: 'automation.demo',
      name: { ru: 'Демо-автоматизация', en: 'Demo automation' },
      flags: {
        installed: true,
        catalog: true,
        installed_stale: false,
        dead_reference: false,
      },
      state: {
        operational_status: 'WORKING',
        checked_at: '2026-07-27T11:59:00Z',
      },
      components: {
        platform_agents: [{
          id: 'agent_demo',
          state: 'PRESENT',
          source: 'AUTOMATION_PASSPORT',
        }],
        experts: [],
        schedules: [],
        integrations: [],
        knowledge: [],
        rules: [],
      },
      evidence: {
        manifest_sha256: '1'.repeat(64),
      },
    }, {
      automation_id: 'automation.second',
      name: { ru: 'Вторая', en: 'Second' },
      flags: {
        installed: false,
        catalog: true,
        installed_stale: false,
        dead_reference: false,
      },
      state: {
        operational_status: 'STATE_UNAVAILABLE',
        checked_at: null,
      },
      components: {
        platform_agents: [],
        experts: [],
        schedules: [],
        integrations: [],
        knowledge: [],
        rules: [],
      },
      evidence: {},
    }],
    counters: {
      total: 2,
      installed: 1,
      catalog: 2,
    },
    source_errors: complete ? [] : [{
      source: 'device',
      code: 'SOURCE_UNAVAILABLE',
    }],
  };
}

function travelAutomationRegistry(complete = true) {
  const registry = automationRegistry(complete);
  registry.rows = [{
    ...registry.rows[0],
    automation_id: 'extella_travel_agency',
    name: {
      ru: 'Агент турагентства',
      en: 'Travel Agency Agent',
    },
    components: {
      ...registry.rows[0].components,
      platform_agents: [{
        id: 'agent_eUSuv3enLqKkZd2lj0aeI',
        state: 'PRESENT',
        source: 'REVIEWED_LIVE_FACTS',
      }],
    },
  }];
  registry.counters = {
    total: 1,
    installed: 1,
    catalog: 1,
  };
  return registry;
}

function mcpRegistry(complete = true) {
  return {
    schema: 'extella.evolution.mcp_registry.v1',
    owner_account_id: 'account_demo',
    checked_at: '2026-07-27T12:00:01Z',
    complete,
    source: complete ? {
      kind: 'ACCOUNT_SCOPED_HOST_PROVIDER',
      id: 'evolution.mcp.registry',
      version: '1.0.0',
      sha256: '2'.repeat(64),
    } : {
      kind: 'UNAVAILABLE',
      id: 'evolution.mcp.registry',
      version: '1.0.0',
      sha256: null,
    },
    connections: complete ? [{
      connection_id: 'connection.crm',
      automation_id: 'automation.demo',
      name: { ru: 'CRM', en: 'CRM' },
      transport: 'streamable_http',
      endpoint: 'https://mcp.example.test',
      credential_ref: 'credential:extella/crm',
      health: {
        status: 'UP',
        checked_at: '2026-07-27T11:59:30Z',
      },
      provenance: provenance(),
    }] : [],
    tools: complete ? [{
      tool_id: 'tool.crm.read',
      automation_id: 'automation.demo',
      connection_id: 'connection.crm',
      name: { ru: 'Читать клиента', en: 'Read customer' },
      version: '2.0.0',
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
    }] : [],
    extensions: complete ? [{
      extension_id: 'extension.audit',
      automation_ids: ['automation.demo'],
      name: { ru: 'Аудит', en: 'Audit' },
      version: '1.1.0',
      hooks: ['authorize', 'after_call'],
      package_sha256: '3'.repeat(64),
      provenance: provenance('shared', '4'.repeat(64)),
    }] : [],
    bindings: complete ? [{
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
    }] : [],
    run_evidence: complete ? [{
      evidence_id: 'evidence.crm.older',
      automation_id: 'automation.demo',
      platform_agent_id: 'agent_demo',
      tool_id: 'tool.crm.read',
      binding_id: 'binding.agent.crm',
      occurred_at: '2026-07-27T11:00:00Z',
      status: 'SUCCEEDED',
      latency_ms: 100,
      cost: null,
      input_sha256: '5'.repeat(64),
      output_sha256: '6'.repeat(64),
      provenance: provenance(),
    }, {
      evidence_id: 'evidence.crm.latest',
      automation_id: 'automation.demo',
      platform_agent_id: 'agent_demo',
      tool_id: 'tool.crm.read',
      binding_id: 'binding.agent.crm',
      occurred_at: '2026-07-27T11:30:00Z',
      status: 'FAILED',
      latency_ms: 180,
      cost: null,
      input_sha256: '7'.repeat(64),
      output_sha256: null,
      provenance: provenance(),
    }] : [],
    warnings: complete ? [] : [{
      code: 'MCP_REGISTRY_UNAVAILABLE',
      message_ru: 'Состав MCP пока не подтверждён.',
      message_en: 'MCP composition is not yet proven.',
      source: 'evolution.mcp.registry',
    }],
  };
}

function loadModules() {
  const context = {
    ETB: {},
    Promise,
    Date,
  };
  vm.runInNewContext(contractSource, context, {
    filename: 'evolution-mcp-contract.js',
  });
  vm.runInNewContext(gatewaySource, context, {
    filename: 'evolution-mcp-read-gateway.js',
  });
  return context.ETB;
}

function callContext(overrides = {}) {
  return {
    actorId: 'account_demo',
    accountId: 'account_demo',
    tenantId: 'account_demo',
    requestId: 'request_demo_1',
    ...overrides,
  };
}

function gatewayFixture(options = {}) {
  const ETB = loadModules();
  const counters = {
    automationReads: 0,
    mcpReads: 0,
    writes: 0,
    contextChecks: 0,
  };
  const gateway = ETB.evolutionMcpReadGateway.create({
    actorId: 'account_demo',
    accountId: 'account_demo',
    tenantId: 'account_demo',
    now: '2026-07-27T12:01:00Z',
    assertContext() {
      counters.contextChecks += 1;
    },
    loadAutomationRegistry() {
      counters.automationReads += 1;
      return Promise.resolve(options.automation || automationRegistry());
    },
    loadMcpRegistry() {
      counters.mcpReads += 1;
      return Promise.resolve(options.mcp || mcpRegistry());
    },
    hash() {
      return Promise.resolve('f'.repeat(64));
    },
  });
  return { gateway, counters };
}

test('Gateway exposes the exact read allowlist and no execution primitive', () => {
  const { gateway } = gatewayFixture();
  assert.deepEqual(
    plain(gateway.listTools().map((tool) => tool.name)),
    [
      'automations.list',
      'automations.get',
      'automations.get_state',
      'automations.get_composition',
      'mcp.connections.list',
      'mcp.tools.list',
      'mcp.extensions.list',
      'mcp.bindings.list',
      'runs.get_evidence',
    ],
  );
  assert.doesNotMatch(
    gateway.listTools().map((tool) => tool.name).join(' '),
    /\b(?:run|save|publish|activate|rollback|request)\b/,
  );
  assert.doesNotMatch(
    gatewaySource,
    /\bkvSet\b|\blocalStorage\b|\bfetch\s*\(|\bXMLHttpRequest\b|\brunExpert\b/,
  );
});

test('composition reuses exact Automation Registry components and projects Agent Cabinet bindings', async () => {
  const { gateway, counters } = gatewayFixture();
  const response = plain(await gateway.invoke(
    'automations.get_composition',
    { automation_id: 'automation.demo' },
    callContext(),
  ));

  assert.equal(
    response.schema,
    'extella.evolution.mcp_read_response.v1.1',
  );
  assert.equal(
    response.snapshot.schema,
    'extella.evolution.mcp_read_snapshot.v1.1',
  );
  assert.equal(response.context.account_id, 'account_demo');
  assert.equal(response.snapshot.complete, false);
  assert.equal(response.data.complete, false);
  assert.equal(response.data.mcp.complete, false);
  assert.deepEqual(response.data.mcp.availability, {
    automation_id: 'automation.demo',
    connections: 'UNKNOWN',
    tool_contracts: 'UNKNOWN',
    extensions: 'UNKNOWN',
    bindings: 'UNKNOWN',
    run_evidence: 'UNKNOWN',
  });
  assert.ok(response.warnings.some(
    (row) => row.code === 'MCP_LEGACY_COVERAGE_UNAVAILABLE',
  ));
  assert.equal(
    response.snapshot.snapshot_id,
    `mcp_read_${'f'.repeat(64)}`,
  );
  assert.deepEqual(
    response.data.components,
    automationRegistry().rows[0].components,
  );
  assert.equal(response.data.mcp.connections[0].connection_id, 'connection.crm');
  assert.equal(response.data.mcp.tools[0].tool_id, 'tool.crm.read');
  assert.equal(response.data.agent_cabinet.surface, 'Agent Cabinet');
  assert.deepEqual(response.data.agent_cabinet.agents, [{
    platform_agent_id: 'agent_demo',
    component_state: 'PRESENT',
    tool_binding_count: 1,
    access_posture: null,
  }]);
  assert.equal(counters.automationReads, 1);
  assert.equal(counters.mcpReads, 1);
  assert.equal(counters.writes, 0);
  assert.ok(counters.contextChecks >= 3);
});

test('complete bindings must target exact internal agents and partial mismatches stay hidden', async () => {
  const foreign = mcpRegistry();
  foreign.bindings[0].platform_agent_id = 'agent_other';
  foreign.run_evidence.forEach((row) => {
    row.platform_agent_id = 'agent_other';
  });
  await assert.rejects(
    () => gatewayFixture({ mcp: foreign }).gateway.invoke(
      'automations.get_composition',
      { automation_id: 'automation.demo' },
      callContext(),
    ),
    (error) => {
      assert.equal(error.code, 'MCP_PLATFORM_AGENT_REFERENCE_DANGLING');
      return true;
    },
  );

  foreign.complete = false;
  foreign.warnings = [{
    code: 'MCP_REGISTRY_PARTIAL',
    message_ru: 'Состав MCP подтверждён частично.',
    message_en: 'MCP composition is only partially proven.',
    source: 'evolution.mcp.registry',
  }];
  const partial = plain(await gatewayFixture({ mcp: foreign }).gateway.invoke(
    'automations.get_composition',
    { automation_id: 'automation.demo' },
    callContext(),
  ));
  assert.equal(partial.snapshot.complete, false);
  assert.equal(partial.data.mcp.bindings.length, 0);
  assert.equal(
    partial.data.agent_cabinet.agents[0].tool_binding_count,
    0,
  );
  assert.ok(partial.warnings.some(
    (row) => row.code === 'MCP_PLATFORM_AGENT_REFERENCE_UNRESOLVED',
  ));

  const missingAutomation = automationRegistry();
  missingAutomation.rows[0].components.platform_agents[0].state = 'MISSING';
  await assert.rejects(
    () => gatewayFixture({
      automation: missingAutomation,
    }).gateway.invoke(
      'automations.get_composition',
      { automation_id: 'automation.demo' },
      callContext(),
    ),
    (error) => {
      assert.equal(error.code, 'MCP_PLATFORM_AGENT_REFERENCE_DANGLING');
      return true;
    },
  );

  const unknownAutomation = automationRegistry();
  unknownAutomation.rows[0].components.platform_agents[0].state = 'UNKNOWN';
  const unknown = plain(await gatewayFixture({
    automation: unknownAutomation,
  }).gateway.invoke(
    'automations.get_composition',
    { automation_id: 'automation.demo' },
    callContext(),
  ));
  assert.equal(unknown.snapshot.complete, false);
  assert.equal(unknown.data.complete, false);
  assert.equal(unknown.data.mcp.complete, false);
  assert.equal(unknown.data.mcp.bindings.length, 0);
  assert.equal(unknown.data.agent_cabinet.agents[0].tool_binding_count, 0);
  assert.ok(unknown.warnings.some(
    (row) => row.code === 'MCP_PLATFORM_AGENT_REFERENCE_UNRESOLVED',
  ));
});

test('only enabled exact Tool Bindings are effective', async () => {
  const registry = mcpRegistry();
  registry.bindings.push({
    ...registry.bindings[0],
    binding_id: 'binding.agent.crm.disabled',
    enabled: false,
  }, {
    ...registry.bindings[0],
    binding_id: 'binding.agent.crm.unknown',
    enabled: 'UNKNOWN',
  });
  const gateway = gatewayFixture({ mcp: registry }).gateway;
  const composition = plain(await gateway.invoke(
    'automations.get_composition',
    { automation_id: 'automation.demo' },
    callContext(),
  ));
  assert.deepEqual(
    composition.data.mcp.bindings.map((row) => row.binding_id),
    ['binding.agent.crm'],
  );
  assert.equal(
    composition.data.agent_cabinet.agents[0].tool_binding_count,
    1,
  );

  const bindings = plain(await gateway.invoke(
    'mcp.bindings.list',
    { automation_id: 'automation.demo' },
    callContext({ requestId: 'request_demo_bindings' }),
  ));
  assert.deepEqual(
    bindings.data.items.map((row) => row.binding_id),
    ['binding.agent.crm'],
  );
});

test('automation state preserves STATE_UNAVAILABLE instead of success', async () => {
  const { gateway } = gatewayFixture();
  const response = plain(await gateway.invoke(
    'automations.get_state',
    { automation_id: 'automation.second' },
    callContext(),
  ));

  assert.equal(response.data.complete, false);
  assert.equal(
    response.data.state.operational_status,
    'STATE_UNAVAILABLE',
  );
});

test('list filters and pagination are bounded and cursor-bound', async () => {
  const { gateway } = gatewayFixture();
  const first = plain(await gateway.invoke(
    'automations.list',
    { limit: 1 },
    callContext(),
  ));
  assert.equal(first.data.items.length, 1);
  assert.equal(first.data.items[0].automation_id, 'automation.demo');
  assert.equal(first.data.page.next_cursor, 'automation.demo');

  const second = plain(await gateway.invoke(
    'automations.list',
    { limit: 1, cursor: first.data.page.next_cursor },
    callContext({ requestId: 'request_demo_2' }),
  ));
  assert.equal(second.data.items[0].automation_id, 'automation.second');

  const installed = plain(await gateway.invoke(
    'automations.list',
    { installed: true },
    callContext({ requestId: 'request_demo_3' }),
  ));
  assert.deepEqual(
    installed.data.items.map((row) => row.automation_id),
    ['automation.demo'],
  );

  await assert.rejects(
    () => gateway.invoke(
      'automations.list',
      { cursor: 'automation.missing' },
      callContext({ requestId: 'request_demo_4' }),
    ),
    (error) => {
      assert.equal(error.code, 'MCP_READ_CURSOR_INVALID');
      return true;
    },
  );
});

test('latest Run Evidence is first and contains hashes rather than payloads', async () => {
  const { gateway } = gatewayFixture();
  const response = plain(await gateway.invoke(
    'runs.get_evidence',
    {
      automation_id: 'automation.demo',
      platform_agent_id: 'agent_demo',
      tool_id: 'tool.crm.read',
    },
    callContext(),
  ));

  assert.deepEqual(
    response.data.items.map((row) => row.evidence_id),
    ['evidence.crm.latest', 'evidence.crm.older'],
  );
  assert.equal(response.data.items[0].output_sha256, null);
  assert.doesNotMatch(JSON.stringify(response), /input_payload|output_payload/);
});

test('composition preserves historical evidence after its binding is disabled', async () => {
  const registry = mcpRegistry();
  registry.bindings[0].enabled = false;
  const { gateway } = gatewayFixture({ mcp: registry });

  const composition = plain(await gateway.invoke(
    'automations.get_composition',
    { automation_id: 'automation.demo' },
    callContext({ requestId: 'request_historical_evidence' }),
  ));
  const evidence = plain(await gateway.invoke(
    'runs.get_evidence',
    { automation_id: 'automation.demo' },
    callContext({ requestId: 'request_historical_evidence_list' }),
  ));

  assert.equal(composition.data.complete, false);
  assert.deepEqual(composition.data.mcp.bindings, []);
  assert.deepEqual(
    composition.data.mcp.run_evidence.map((row) => row.evidence_id).sort(),
    ['evidence.crm.latest', 'evidence.crm.older'],
  );
  assert.deepEqual(
    composition.data.mcp.run_evidence.map((row) => row.evidence_id).sort(),
    evidence.data.items.map((row) => row.evidence_id).sort(),
  );
});

test('Travel composition preserves honest absence and account-wide access', async () => {
  const registry = plain(travelRegistry);
  const { gateway } = gatewayFixture({
    automation: travelAutomationRegistry(),
    mcp: registry,
  });
  const composition = plain(await gateway.invoke(
    'automations.get_composition',
    { automation_id: 'extella_travel_agency' },
    callContext({ requestId: 'request_travel_composition' }),
  ));

  assert.equal(composition.snapshot.complete, false);
  assert.equal(composition.data.complete, false);
  assert.equal(
    composition.data.mcp.connections[0].connection_id,
    'sys__all__sys_mcp_extella',
  );
  assert.deepEqual(composition.data.mcp.tools, []);
  assert.deepEqual(composition.data.mcp.extensions, []);
  assert.deepEqual(composition.data.mcp.bindings, []);
  assert.deepEqual(composition.data.mcp.run_evidence, []);
  assert.deepEqual(composition.data.mcp.availability, {
    automation_id: 'extella_travel_agency',
    connections: 'OBSERVED',
    tool_contracts: 'NOT_EXPOSED',
    extensions: 'NOT_APPLICABLE',
    bindings: 'NOT_APPLICABLE',
    run_evidence: 'OBSERVED_EMPTY',
  });
  assert.deepEqual(
    composition.data.mcp.access_posture,
    registry.access_posture,
  );
  assert.equal(
    composition.data.agent_cabinet.agents[0].tool_binding_count,
    0,
  );
  assert.deepEqual(
    composition.data.agent_cabinet.agents[0].access_posture,
    registry.access_posture[0],
  );
  assert.doesNotMatch(
    JSON.stringify(composition),
    /tool\.travel|extension\.travel|evidence\.travel|mcp\.example\.test/,
  );

  const connections = plain(await gateway.invoke(
    'mcp.connections.list',
    { automation_id: 'extella_travel_agency' },
    callContext({ requestId: 'request_travel_connections' }),
  ));
  assert.deepEqual(connections.data.availability, registry.availability[0]);
  assert.deepEqual(connections.data.access_posture, registry.access_posture);
});

test('one shared platform Connection projects to every declared automation consumer', async () => {
  const registry = plain(travelRegistry);
  registry.connections[0].automation_ids.push('automation.second');
  registry.availability.push({
    automation_id: 'automation.second',
    connections: 'OBSERVED',
    tool_contracts: 'OBSERVED_EMPTY',
    extensions: 'OBSERVED_EMPTY',
    bindings: 'OBSERVED_EMPTY',
    run_evidence: 'OBSERVED_EMPTY',
  });
  const automations = travelAutomationRegistry();
  automations.rows.push(automationRegistry().rows[1]);
  automations.counters = {
    total: 2,
    installed: 1,
    catalog: 2,
  };
  const { gateway } = gatewayFixture({
    automation: automations,
    mcp: registry,
  });

  const first = plain(await gateway.invoke(
    'mcp.connections.list',
    { automation_id: 'extella_travel_agency' },
    callContext({ requestId: 'request_shared_connection_travel' }),
  ));
  const second = plain(await gateway.invoke(
    'mcp.connections.list',
    { automation_id: 'automation.second' },
    callContext({ requestId: 'request_shared_connection_second' }),
  ));

  assert.deepEqual(
    first.data.items.map((row) => row.connection_id),
    ['sys__all__sys_mcp_extella'],
  );
  assert.deepEqual(
    second.data.items.map((row) => row.connection_id),
    ['sys__all__sys_mcp_extella'],
  );
});

test('complete v1.1 coverage cannot omit access posture for a present agent', async () => {
  const registry = plain(travelRegistry);
  registry.complete = true;
  registry.availability[0].tool_contracts = 'OBSERVED_EMPTY';
  registry.availability[0].bindings = 'OBSERVED_EMPTY';
  registry.access_posture = [];
  registry.warnings = [];

  await assert.rejects(
    () => gatewayFixture({
      automation: travelAutomationRegistry(),
      mcp: registry,
    }).gateway.invoke(
      'automations.get_composition',
      { automation_id: 'extella_travel_agency' },
      callContext({ requestId: 'request_missing_access_posture' }),
    ),
    (error) => {
      assert.equal(error.code, 'MCP_ACCESS_POSTURE_REFERENCE_MISSING');
      return true;
    },
  );
});

test('foreign access posture fails closed or stays unresolved', async () => {
  const registry = plain(travelRegistry);
  registry.access_posture[0].platform_agent_id = 'agent_foreign';

  await assert.rejects(
    () => gatewayFixture({
      automation: travelAutomationRegistry(),
      mcp: registry,
    }).gateway.invoke(
      'automations.get_composition',
      { automation_id: 'extella_travel_agency' },
      callContext({ requestId: 'request_foreign_access' }),
    ),
    (error) => {
      assert.equal(error.code, 'MCP_ACCESS_POSTURE_REFERENCE_DANGLING');
      return true;
    },
  );

  const partialAutomation = travelAutomationRegistry(false);
  const response = plain(await gatewayFixture({
    automation: partialAutomation,
    mcp: registry,
  }).gateway.invoke(
    'automations.get_composition',
    { automation_id: 'extella_travel_agency' },
    callContext({ requestId: 'request_unresolved_access' }),
  ));
  assert.deepEqual(response.data.mcp.access_posture, []);
  assert.equal(
    response.data.agent_cabinet.agents[0].access_posture,
    null,
  );
  assert.ok(response.warnings.some(
    (row) => row.code === 'MCP_ACCESS_POSTURE_REFERENCE_UNRESOLVED',
  ));
});

test('access posture from another automation cannot satisfy no-bindings coverage', async () => {
  const registry = plain(travelRegistry);
  registry.access_posture[0].platform_agent_id = 'agent_other_automation';
  const automations = travelAutomationRegistry();
  automations.rows.push({
    ...automationRegistry().rows[0],
    automation_id: 'automation.other',
    components: {
      ...automationRegistry().rows[0].components,
      platform_agents: [{
        id: 'agent_other_automation',
        state: 'PRESENT',
        source: 'AUTOMATION_PASSPORT',
      }],
    },
  });
  automations.counters.total = 2;
  automations.counters.installed = 2;
  automations.counters.catalog = 2;

  const response = plain(await gatewayFixture({
    automation: automations,
    mcp: registry,
  }).gateway.invoke(
    'automations.get_composition',
    { automation_id: 'extella_travel_agency' },
    callContext({ requestId: 'request_wrong_automation_access' }),
  ));

  assert.equal(response.snapshot.complete, false);
  assert.equal(response.data.mcp.complete, false);
  assert.deepEqual(response.data.mcp.access_posture, []);
  assert.ok(response.warnings.some(
    (row) => row.code === 'MCP_ACCESS_POSTURE_REFERENCE_UNRESOLVED',
  ));
});

test('non-affecting risk warnings do not falsify an otherwise complete snapshot', async () => {
  const registry = plain(travelRegistry);
  registry.complete = true;
  registry.availability[0].tool_contracts = 'OBSERVED_EMPTY';
  registry.warnings = [{
    code: 'ACCOUNT_WIDE_ACCESS_REVIEW',
    message_ru: 'Доступ требует отдельного решения владельца.',
    message_en: 'Access requires a separate owner decision.',
    source: 'travel.mcp.live_facts',
    severity: 'error',
    affects_completeness: false,
  }];
  const response = plain(await gatewayFixture({
    automation: travelAutomationRegistry(),
    mcp: registry,
  }).gateway.invoke(
    'automations.get_composition',
    { automation_id: 'extella_travel_agency' },
    callContext({ requestId: 'request_non_affecting_warning' }),
  ));

  assert.equal(response.snapshot.complete, true);
  assert.equal(response.data.complete, true);
  assert.equal(response.data.mcp.complete, true);
  assert.equal(response.warnings[0].severity, 'error');
  assert.equal(response.warnings[0].affects_completeness, false);
});

test('legacy warnings keep MCP composition incomplete even when source claims complete', async () => {
  const registry = mcpRegistry();
  registry.warnings = [{
    code: 'LEGACY_SOURCE_WARNING',
    message_ru: 'Источник требует проверки.',
    message_en: 'The source requires review.',
    source: 'evolution.mcp.registry',
  }];
  const response = plain(await gatewayFixture({ mcp: registry }).gateway.invoke(
    'automations.get_composition',
    { automation_id: 'automation.demo' },
    callContext({ requestId: 'request_legacy_warning' }),
  ));

  assert.equal(response.snapshot.complete, false);
  assert.equal(response.data.complete, false);
  assert.equal(response.data.mcp.complete, false);
  response.warnings.forEach((row) => {
    assert.equal(typeof row.severity, 'string');
    assert.equal(typeof row.affects_completeness, 'boolean');
  });
});

test('wrong context, unknown tools and open arguments fail before source reads', async () => {
  const { gateway, counters } = gatewayFixture();
  assert.throws(
    () => gateway.invoke(
      'automations.get',
      { automation_id: 'automation.demo' },
      callContext({ accountId: 'account_other' }),
    ),
    (error) => {
      assert.equal(error.code, 'MCP_READ_CONTEXT_MISMATCH');
      return true;
    },
  );
  assert.equal(counters.automationReads, 0);
  assert.equal(counters.mcpReads, 0);

  assert.throws(
    () => gateway.invoke('candidate.activate', {}, callContext()),
    (error) => {
      assert.equal(error.code, 'MCP_READ_TOOL_UNSUPPORTED');
      return true;
    },
  );
  assert.throws(
    () => gateway.invoke(
      'automations.get',
      { automation_id: 'automation.demo', platform_request: '/api/write' },
      callContext(),
    ),
    (error) => {
      assert.equal(error.code, 'MCP_READ_ARGUMENTS_INVALID');
      return true;
    },
  );
  assert.throws(
    () => gateway.invoke(
      'automations.list',
      { limit: 101 },
      callContext(),
    ),
    (error) => {
      assert.equal(error.code, 'MCP_READ_ARGUMENTS_INVALID');
      return true;
    },
  );
});

test('incomplete sources remain incomplete with bilingual warnings', async () => {
  const { gateway } = gatewayFixture({
    automation: automationRegistry(false),
    mcp: mcpRegistry(false),
  });
  const response = plain(await gateway.invoke(
    'automations.get_composition',
    { automation_id: 'automation.demo' },
    callContext(),
  ));

  assert.equal(response.snapshot.complete, false);
  assert.equal(response.data.complete, false);
  assert.ok(response.warnings.length >= 2);
  response.warnings.forEach((row) => {
    assert.ok(row.message_ru);
    assert.ok(row.message_en);
  });
  assert.deepEqual(response.data.mcp.connections, []);
});

test('complete cross-source disagreement and source secret leakage fail closed', async () => {
  const dangling = mcpRegistry();
  dangling.connections[0].automation_id = 'automation.unknown';
  dangling.tools[0].automation_id = 'automation.unknown';
  dangling.bindings[0].automation_id = 'automation.unknown';
  dangling.run_evidence[0].automation_id = 'automation.unknown';
  dangling.run_evidence[1].automation_id = 'automation.unknown';
  dangling.extensions[0].automation_ids = ['automation.unknown'];
  const first = gatewayFixture({ mcp: dangling }).gateway;
  await assert.rejects(
    () => first.invoke(
      'automations.list',
      {},
      callContext(),
    ),
    (error) => {
      assert.equal(error.code, 'MCP_AUTOMATION_REFERENCE_DANGLING');
      return true;
    },
  );

  const leakedAutomation = automationRegistry();
  leakedAutomation.rows[0].token = 'Bearer abcdefghijklmnop';
  const second = gatewayFixture({ automation: leakedAutomation }).gateway;
  await assert.rejects(
    () => second.invoke(
      'automations.get',
      { automation_id: 'automation.demo' },
      callContext(),
    ),
    (error) => {
      assert.equal(error.code, 'MCP_SECRET_FIELD_FORBIDDEN');
      return true;
    },
  );
});
