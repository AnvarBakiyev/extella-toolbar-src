'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const toolbarRoot = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(
  toolbarRoot,
  'plugins',
  'scenarios',
  'evolution-console.html',
), 'utf8');
const contractSource = fs.readFileSync(path.join(
  toolbarRoot,
  'src',
  'core',
  'evolution-mcp-contract.js',
), 'utf8');
const standardsBundle = JSON.parse(fs.readFileSync(path.join(
  toolbarRoot,
  'plugins',
  'scenarios',
  'evolution-standards',
  'evolution-standards-bundle.json',
), 'utf8'));

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function functionSlice(name, nextName) {
  const start = html.indexOf(`function ${name}(`);
  const end = html.indexOf(`function ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `${name} source must exist`);
  return html.slice(start, end);
}

test('MCP composition stays lazy and inside a closed automation disclosure', () => {
  const composition = functionSlice(
    'renderAutomationComposition',
    'renderAutomationRisks',
  );
  assert.match(
    composition,
    /data-internal-agents="collapsed" data-automation-composition=/,
  );
  assert.doesNotMatch(
    composition,
    /<details class="composition"[^>]*\bopen\b/,
  );
  assert.match(composition, /data-mcp-composition=/);

  const fleetStart = html.indexOf('function renderFleet()');
  const fleetEnd = html.indexOf('function statusMark(', fleetStart);
  const fleet = html.slice(fleetStart, fleetEnd);
  assert.match(
    fleet,
    /details\.ontoggle=function\(\)\{if\(details\.open\)loadMcpComposition/,
  );
  assert.doesNotMatch(
    html.slice(0, html.indexOf('<script>')),
    /data-mcp-composition|MCP Connection|Tool Contract/,
    'MCP topology must not become a new top-level navigation surface',
  );
});

test('Console invokes one exact read tool and validates its response identity', () => {
  const load = functionSlice(
    'loadMcpComposition',
    'renderAutomationComposition',
  );
  assert.match(
    load,
    /request\('mcp_read',\{tool:'automations\.get_composition',arguments:\{automation_id:automationId\}\}\)/,
  );
  assert.match(
    load,
    /response\.schema!=='extella\.evolution\.mcp_read_response\.v1\.1'/,
  );
  assert.match(
    load,
    /response\.data\.automation_id!==automationId/,
  );
  assert.match(
    load,
    /epoch!==state\.accountEpoch\|\|mcpEpoch!==state\.mcpEpoch/,
    'stale account or refresh responses must be discarded',
  );
});

test('incomplete MCP data remains visibly incomplete in Russian and English', () => {
  for (const copy of [
    "mcpUnavailable:'Состав инструментов пока не подтверждён'",
    "mcpIncomplete:'Показаны только подтверждённые данные; остальное неизвестно.'",
    "mcpUnavailable:'Tool composition is not yet proven'",
    "mcpIncomplete:'Only proven data is shown; everything else is unknown.'",
  ]) {
    assert.match(html, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  const render = functionSlice(
    'renderMcpCompositionContent',
    'renderMcpCompositionHost',
  );
  const accessRender = functionSlice(
    'mcpAccessContent',
    'renderMcpCompositionContent',
  );
  assert.match(
    render,
    /data\.complete!==true\|\|!response\.snapshot\|\|response\.snapshot\.complete!==true/,
  );
  assert.match(render, /entry\.status==='error'/);
  assert.match(render, /t\('mcpIncomplete'\)/);
  assert.match(render, /mcpCoverageContent\(availability\)/);
  assert.match(render, /mcpAccessContent\(access,bindings\.length\)/);
  assert.match(render, /t\('mcpSourceWarnings'\)/);
  assert.match(render, /mcpInventoryCount\(tools\.length,availability&&availability\.tool_contracts/);
  assert.match(render, /availability\.tool_contracts!=='OBSERVED_EMPTY'/);
  assert.match(accessRender, /risk==='LEAST_PRIVILEGE'\?'leastPrivilegeAccess':'unknownAccess'/);
  assert.match(accessRender, /scopeKey=unscoped\?'unscopedAccess':scoped\?'scopedAccess':'unknownAccessScope'/);
  assert.match(accessRender, /bindingCount===0\?/);
  assert.match(html, /Ноль Tool Bindings не означает отсутствие доступа\./);
  assert.match(html, /Zero Tool Bindings does not mean zero access\./);
  assert.match(html, /уровень прав неизвестен/);
  assert.match(html, /access level unknown/);
});

test('Tool Bindings point to Agent Cabinet without creating another Cabinet', () => {
  const render = functionSlice(
    'renderMcpCompositionContent',
    'renderMcpCompositionHost',
  );
  assert.match(render, /binding\.platform_agent_id/);
  assert.match(render, /binding\.enabled===true/);
  assert.match(render, /t\('toolBindings'\)/);
  assert.match(render, /Tool Binding/);
  assert.doesNotMatch(render, /renderCabinet|buildCabinet|cabinet_get/);

  assert.match(
    html,
    /data-action="open-agent-cabinet"[\s\S]*?openCabinet\(/,
  );
  assert.match(
    html,
    /window\.renderCabinet[\s\S]*?renderCabinet\(cab,'cabinetHost','passport'\)/,
    'the existing generated Agent Cabinet must remain the only Cabinet renderer',
  );
});

test('Console table sizing does not force the generated Agent Cabinet off-screen', () => {
  assert.match(
    html,
    /\.table-wrap table\{width:100%;border-collapse:collapse;min-width:920px\}/,
  );
  assert.doesNotMatch(
    html,
    /(?:^|})table\{[^}]*min-width:920px/,
    'the fleet table width must not leak into canonical Agent Cabinet tables',
  );
  assert.match(
    html,
    /#cabinetHost\{min-width:0;max-width:100%;overflow-x:auto\}/,
  );
});

test('reviewed Travel demo shows only observed platform MCP facts', () => {
  const source = functionSlice('demoMcpComposition', 'mockRequest');
  const context = {
    ETB: {},
  };
  vm.runInNewContext(contractSource, context, {
    filename: 'evolution-mcp-contract.js',
  });
  vm.runInNewContext(`
    function clone(value) {
      return value == null ? value : JSON.parse(JSON.stringify(value));
    }
    function componentArrays(components) {
      return {
        platform_agents: components.platform_agents || []
      };
    }
    function demoAutomationRegistry() {
      return {
        rows: [{
          automation_id: 'extella_travel_agency',
          components: {
            platform_agents: [{
              id: 'agent_demo_fixture_valid_beta',
              state: 'PRESENT'
            }]
          }
        }]
      };
    }
    ${source}
    this.demo = demoMcpComposition;
  `, context, { filename: 'evolution-console-demo-mcp.js' });

  const response = plain(context.demo('extella_travel_agency'));
  assert.equal(response.data.mcp.connections.length, 1);
  assert.equal(
    response.data.mcp.connections[0].connection_id,
    'sys__all__sys_mcp_extella',
  );
  assert.equal(
    response.data.mcp.connections[0].transport,
    null,
  );
  assert.equal(response.data.mcp.connections[0].platform_managed, true);
  assert.equal(
    response.data.mcp.connections[0].scope_boundary,
    'ACCOUNT_SHARED_PLATFORM',
  );
  assert.deepEqual(
    response.data.mcp.connections[0].automation_ids,
    ['extella_travel_agency'],
  );
  assert.equal(response.data.mcp.connections[0].endpoint, null);
  assert.equal(response.data.mcp.tools.length, 0);
  assert.equal(response.data.mcp.extensions.length, 0);
  assert.equal(response.data.mcp.bindings.length, 0);
  assert.equal(response.data.mcp.run_evidence.length, 0);
  assert.deepEqual(response.data.mcp.availability, {
    automation_id: 'extella_travel_agency',
    connections: 'OBSERVED',
    tool_contracts: 'NOT_EXPOSED',
    extensions: 'NOT_APPLICABLE',
    bindings: 'NOT_APPLICABLE',
    run_evidence: 'OBSERVED_EMPTY',
  });
  assert.equal(response.data.mcp.access_posture.length, 1);
  assert.deepEqual(response.data.mcp.access_posture[0], {
    platform_agent_id: 'agent_demo_fixture_valid_beta',
    scope: 'ACCOUNT_WIDE',
    policy: 'UNSCOPED',
    risk: 'EXCESSIVE',
    observed_tool_count: 48,
    business_tool_count: 0,
    risk_evidence_tool_ids: [
      'agent_delete_mcp_extella',
      'profile_delete_mcp_extella',
      'token_generate_mcp_extella',
    ],
  });
  assert.equal(response.data.complete, false);
  assert.equal(response.snapshot.complete, false);
  assert.equal(
    response.data.agent_cabinet.agents[0].tool_binding_count,
    0,
  );
  assert.deepEqual(
    response.data.agent_cabinet.agents[0].access_posture,
    response.data.mcp.access_posture[0],
  );
  const generatedCabinetIds = new Set(standardsBundle.agents.map((entry) => (
    entry.platformAgentId ||
    entry.platform_agent_id ||
    entry.cabinet?.passport?.identity?.platform_agent_id
  )));
  assert.equal(
    generatedCabinetIds.has(
      response.data.agent_cabinet.agents[0].platform_agent_id,
    ),
    true,
    'preview composition must open an existing generated Agent Cabinet',
  );

  const registry = {
    schema: 'extella.evolution.mcp_registry.v1.1',
    owner_account_id: 'demo_actor',
    checked_at: '2026-07-27T12:00:00Z',
    complete: false,
    source: {
      kind: 'REVIEWED_LIVE_FACTS',
      id: 'MCP_REGISTRY_FACTS_travel.md',
      version: null,
      sha256: '0731b0290eaead8768f3d02693f5cc7897284c356b461ee2fb7ae59d77119b7e',
    },
    availability: [response.data.mcp.availability],
    access_posture: response.data.mcp.access_posture,
    connections: response.data.mcp.connections,
    tools: response.data.mcp.tools,
    extensions: response.data.mcp.extensions,
    bindings: response.data.mcp.bindings,
    run_evidence: response.data.mcp.run_evidence,
    warnings: response.warnings,
  };
  assert.deepEqual(
    plain(context.ETB.evolutionMcpContract.validateRegistry(
      registry,
      { accountId: 'demo_actor' },
    )),
    registry,
  );
  assert.doesNotMatch(
    JSON.stringify(registry),
    /credential_value|Bearer\s|private_key|api_key/,
  );
  assert.doesNotMatch(
    JSON.stringify(registry),
    /mcp\.example\.test|tool\.travel\.search|extension\.travel\.audit|evidence\.travel/,
    'the preview must not invent business MCP tools, Extensions or runs',
  );
});

test('manifest declares the read-only MCP inventory without adding an Expert', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(
    toolbarRoot,
    'plugins',
    'scenarios',
    'profit-growth.json',
  ), 'utf8'));
  const capability = manifest.capabilities.find(
    (row) => row.id === 'mcp_read_inventory',
  );
  assert.ok(capability);
  assert.equal(capability.version, 'EVOLUTION_MCP_READ_CONTRACT_V1_1');
  assert.equal(capability.external_writes, false);
  assert.deepEqual(manifest.experts, ['_etb_evolution_registry_scan_v1']);
});
