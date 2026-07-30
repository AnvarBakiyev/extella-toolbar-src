'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const toolbarRoot = path.resolve(__dirname, '..');
const installerPath = path.join(
  toolbarRoot,
  'src',
  'core',
  'codex-installer.js',
);
const accountBridgePath = path.join(
  toolbarRoot,
  'src',
  'core',
  'codex-account-bridge.js',
);
const apiPath = path.join(toolbarRoot, 'src', 'core', 'api.js');
const marketplacePath = path.join(
  toolbarRoot,
  'src',
  'panels',
  'marketplace.js',
);
const storefrontPath = path.join(
  toolbarRoot,
  'public',
  'plugins_manager.html',
);

const installerSource = fs.readFileSync(installerPath, 'utf8');
const accountBridgeSource = fs.readFileSync(accountBridgePath, 'utf8');
const apiSource = fs.readFileSync(apiPath, 'utf8');
const marketplaceSource = fs.readFileSync(marketplacePath, 'utf8');
const storefrontSource = fs.readFileSync(storefrontPath, 'utf8');

function loadInstaller(api) {
  const context = { ETB: { api: api || undefined } };
  vm.runInNewContext(accountBridgeSource, context, {
    filename: 'codex-account-bridge.js',
  });
  vm.runInNewContext(installerSource, context, {
    filename: 'codex-installer.js',
  });
  return context.ETB.codexInstaller;
}

test('Codex installer Expert is pinned, syntactically valid, and non-model', () => {
  const installer = loadInstaller();
  const code = installer.expertCode();
  const metadata = installer.metadata();
  const actualHash = crypto.createHash('sha256').update(code).digest('hex');

  assert.equal(metadata.expertName, '_etb_codex_setup_v2');
  assert.equal(metadata.pluginVersion, '0.4.0');
  assert.equal(metadata.standardsRef, 'v0.1.0');
  assert.equal(metadata.expertSha256, actualHash);
  assert.match(code, /BUILDER_REF = "v0\.4\.0"/);
  assert.match(code, /STANDARDS_REF = "v0\.1\.0"/);
  assert.match(code, /"model_called": False/);
  assert.match(code, /"agent_called": False/);
  assert.match(code, /"paid": False/);
  assert.match(code, /shell=False/);
  assert.doesNotMatch(code, /shell=True/);
  assert.doesNotMatch(code, /\/api\/agent\/run/);
  assert.doesNotMatch(code, /codex", "exec"/);
  assert.match(code, /"--account-wide"/);
  assert.match(code, /"I_UNDERSTAND_ALL_AGENTS"/);
  assert.match(code, /"I_UNDERSTAND_COST"/);
  assert.match(code, /health\.get\("authorization_scopes"/);

  const syntax = spawnSync(
    'python3',
    ['-c', 'import sys; compile(sys.stdin.read(), "<expert>", "exec")'],
    { input: code, encoding: 'utf8' },
  );
  assert.equal(syntax.status, 0, syntax.stderr);
});

test('account-wide bridge Expert is pinned, account-bound, and parameter-minimal', () => {
  const installer = loadInstaller();
  const code = installer.bridgeExpertCode();
  const metadata = installer.metadata();
  const actualHash = crypto.createHash('sha256').update(code).digest('hex');

  assert.equal(metadata.bridgeExpertName, 'extella_codex_bridge');
  assert.equal(metadata.bridgeExpertSha256, actualHash);
  assert.match(code, /"schema_version": "1\.1"/);
  assert.match(code, /"provider": "codex"/);
  assert.match(code, /"capability": "general-assistance"/);
  assert.match(code, /extella-account-v1\./);
  assert.match(code, /account_config\(\)\.get\("auth_token"/);
  assert.match(code, /\["\/bin\/launchctl", "getenv", name\]/);
  assert.doesNotMatch(code, /agent_id: str|provider: str|capability: str/);
});

test('host bridge pins the installer and current target instead of accepting commands', () => {
  assert.match(marketplaceSource, /e\.data\.type === 'etb_codex_install'/);
  assert.match(
    marketplaceSource,
    /e\.source !== _cf\.contentWindow/,
  );
  assert.match(
    marketplaceSource,
    /ETB\.codexInstaller\.install/,
  );
  assert.doesNotMatch(
    marketplaceSource,
    /etb_codex_install[\s\S]{0,600}e\.data\.(name|command|target|token)/,
  );

  const installer = loadInstaller();
  const source = installerSource;
  assert.match(source, /window\.extellaDesktop\.getDeviceID/);
  assert.match(source, /target: deviceId/);
  assert.match(source, /ETB\.api\.getExpert\(EXPERT_NAME, \{ global: false \}\)/);
  assert.match(source, /_readExpertCode\(readback\) !== EXPERT_CODE/);
  assert.match(source, /ETB\.api\.agentsList\(\)/);
  assert.match(source, /ETB\.api\.saveExpertScoped/);
  assert.match(source, /ETB\.api\.agentToolsUpdateScoped/);
  assert.match(source, /reconcile_future_agents: true/);
  assert.match(apiSource, /saveExpertScoped/);
  assert.match(apiSource, /getExpertScoped/);
  assert.match(apiSource, /agentToolsUpdateScoped/);
});

test('fleet reconciliation preserves tools and installs Codex for every agent', async () => {
  const bridgeCodeContext = { ETB: {} };
  vm.runInNewContext(accountBridgeSource, bridgeCodeContext);
  const bridge = bridgeCodeContext.ETB.codexAccountBridge;
  const agentRows = [
    { id: 'agent_current_12345678' },
    { id: 'agent_future_12345678' },
  ];
  const agentDetails = [
    { id: 'agent_current_12345678', tools: ['web_search'] },
    { id: 'agent_future_12345678', tools: [bridge.name, 'other_tool'] },
  ];
  const expertByAgent = {
    agent_future_12345678: bridge.code,
  };
  const updates = [];
  const saves = [];
  let stateWrite = null;
  const api = {
    agentsList: async () => ({ agents: agentRows }),
    getExpertScoped: async (name, agentId) => {
      if (!expertByAgent[agentId]) throw new Error('not found');
      return { expert_code: expertByAgent[agentId], name };
    },
    saveExpertScoped: async (def, agentId) => {
      saves.push({ def, agentId });
      expertByAgent[agentId] = def.code;
      return { status: 'success' };
    },
    agentToolsUpdateScoped: async (agentId, tools) => {
      updates.push({ agentId, tools: tools.slice() });
      agentDetails.find((item) => item.id === agentId).tools = tools.slice();
      return { status: 'success' };
    },
    agentGetScoped: async (agentId) => (
      agentDetails.find((item) => item.id === agentId)
    ),
    kvSet: async (_key, value) => {
      stateWrite = JSON.parse(value);
      return { status: 'success' };
    },
  };
  const result = await loadInstaller(api).reconcileFleet();

  assert.equal(result.status, 'ready');
  assert.equal(result.agentCount, 2);
  assert.deepEqual(
    updates,
    [{
      agentId: 'agent_current_12345678',
      tools: ['web_search', bridge.name],
    }],
  );
  assert.equal(saves.length, 1);
  assert.equal(saves[0].agentId, 'agent_current_12345678');
  assert.deepEqual(agentDetails[0].tools, ['web_search', bridge.name]);
  assert.deepEqual(agentDetails[1].tools, [bridge.name, 'other_tool']);
  assert.equal(stateWrite.enabled, true);
  assert.equal(stateWrite.reconcile_future_agents, true);
  assert.equal(stateWrite.expert_sha256, bridge.sha256);
});

test('fleet reconciliation fails before writes when full agent state is unavailable', async () => {
  let writes = 0;
  const api = {
    agentsList: async () => ({
      agents: [{ id: 'agent_unavailable_12345678' }],
    }),
    agentGetScoped: async () => {
      throw new Error('agent unavailable');
    },
    getExpertScoped: async () => {
      throw new Error('must not be reached');
    },
    saveExpertScoped: async () => { writes += 1; },
    agentToolsUpdateScoped: async () => { writes += 1; },
    kvSet: async () => { writes += 1; },
  };

  await assert.rejects(
    loadInstaller(api).reconcileFleet(),
    /agent unavailable/,
  );
  assert.equal(writes, 0);
});

test('storefront exposes a sibling Codex button and explicit consent states', () => {
  const claudeAt = storefrontSource.indexOf('onclick="claudeConnectModal()"');
  const codexAt = storefrontSource.indexOf('onclick="codexConnectModal()"');
  const automationAt = storefrontSource.indexOf('id="autoBtn"');

  assert.ok(claudeAt >= 0);
  assert.ok(codexAt > claudeAt);
  assert.ok(automationAt > codexAt);
  assert.match(storefrontSource, /Подключить ко всем агентам/);
  assert.match(storefrontSource, /Сейчас будет подключено агентов/);
  assert.match(storefrontSource, /skAgentsFetch\(\)/);
  assert.match(storefrontSource, /id="cx_install_button"/);
  assert.match(storefrontSource, /_cxAgentCount>0/);
  assert.match(storefrontSource, /4 000 знаков запроса/);
  assert.match(storefrontSource, /800 выходных токенов/);
  assert.match(storefrontSource, /120 секунд/);
  assert.match(storefrontSource, /всем текущим и будущим агентам/);
  assert.match(storefrontSource, /Сама установка бесплатна/);
  assert.match(storefrontSource, /могут расходовать лимит подписки Codex\/ChatGPT/);
  assert.match(storefrontSource, /Перезапуск не нужен/);
  assert.match(storefrontSource, /etb_codex_install_progress/);
  assert.match(storefrontSource, /etb_codex_install_result/);
  assert.match(
    storefrontSource,
    new RegExp(loadInstaller().metadata().expertSha256),
  );
});
