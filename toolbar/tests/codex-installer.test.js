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

function loadInstaller(api, globals) {
  const context = Object.assign(
    { ETB: { api: api || undefined } },
    globals || {},
  );
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
  assert.equal(metadata.pluginVersion, '0.2.1');
  assert.equal(metadata.standardsRef, 'v0.2.1');
  assert.doesNotMatch(installerSource, /0\.2\.0/);
  assert.equal(metadata.expertSha256, actualHash);
  assert.match(code, /BUILDER_REF = "v0\.2\.1"/);
  assert.match(code, /AnvarBakiyev\/extella-codex-bridge/);
  assert.match(code, /extella-codex-bridge@extella-codex/);
  assert.match(code, /STANDARDS_REF = "v0\.2\.1"/);
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

test('compact host preflight is pinned and has no installation side effects', () => {
  const installer = loadInstaller();
  const code = installer.healthExpertCode();
  const metadata = installer.metadata();
  const actualHash = crypto.createHash('sha256').update(code).digest('hex');

  assert.equal(metadata.healthExpertName, '_etb_codex_host_health_v1');
  assert.equal(metadata.healthExpertSha256, actualHash);
  assert.match(code, /action="preflight"/);
  assert.match(code, /"\/opt\/homebrew\/bin"/);
  assert.match(code, /"model_called": False/);
  assert.doesNotMatch(code, /launchctl/);
  assert.doesNotMatch(code, /\/api\/token\/validate/);
  assert.doesNotMatch(code, /plugin", "marketplace/);

  const syntax = spawnSync(
    'python3',
    ['-c', 'import sys; compile(sys.stdin.read(), "<expert>", "exec")'],
    { input: code, encoding: 'utf8' },
  );
  assert.equal(syntax.status, 0, syntax.stderr);
});

test('compact plugin installer is pinned and does not invoke a model or agent', () => {
  const installer = loadInstaller();
  const code = installer.installExpertCode();
  const metadata = installer.metadata();
  const actualHash = crypto.createHash('sha256').update(code).digest('hex');

  assert.equal(metadata.installExpertName, 'extella_codex_plugin_install_v1');
  assert.equal(metadata.installExpertSha256, actualHash);
  assert.match(code, /action="install"/);
  assert.match(code, /"extella-codex-bridge@extella-codex"/);
  assert.match(code, /"model_called": False/);
  assert.match(code, /env\["PATH"\]/);
  assert.doesNotMatch(code, /codex", "exec"/);
  assert.doesNotMatch(code, /\/api\/agent\/run/);
  const syntax = spawnSync(
    'python3',
    ['-c', 'import sys; compile(sys.stdin.read(), "<expert>", "exec")'],
    { input: code, encoding: 'utf8' },
  );
  assert.equal(syntax.status, 0, syntax.stderr);
});

test('compact credentials setup is pinned and never returns a credential', () => {
  const installer = loadInstaller();
  const code = installer.credentialsExpertCode();
  const metadata = installer.metadata();
  const actualHash = crypto.createHash('sha256').update(code).digest('hex');

  assert.equal(metadata.credentialsExpertName, 'extella_codex_credentials_v1');
  assert.equal(metadata.credentialsExpertSha256, actualHash);
  assert.match(code, /action="credentials"/);
  assert.match(code, /\.extella", "api_token\.txt/);
  assert.doesNotMatch(code, /account_config/);
  assert.doesNotMatch(code, /__api_token__/);
  assert.match(code, /EXTELLA_BRIDGE_SECRET/);
  assert.match(code, /"model_called": False/);
  assert.match(code, /token = ""/);
  assert.doesNotMatch(code, /return\s+token\b/);
  assert.doesNotMatch(code, /codex", "exec"/);
  const syntax = spawnSync(
    'python3',
    ['-c', 'import sys; compile(sys.stdin.read(), "<expert>", "exec")'],
    { input: code, encoding: 'utf8' },
  );
  assert.equal(syntax.status, 0, syntax.stderr);
});

test('compact bridge setup is pinned and enables only the verified local live bridge', () => {
  const installer = loadInstaller();
  const code = installer.bridgeSetupExpertCode();
  const metadata = installer.metadata();
  const actualHash = crypto.createHash('sha256').update(code).digest('hex');

  assert.equal(metadata.bridgeSetupExpertName, 'extella_codex_bridge_setup_v1');
  assert.equal(metadata.bridgeSetupExpertSha256, actualHash);
  assert.match(code, /action="bridge"/);
  assert.match(code, /"--provider", "codex"/);
  assert.match(code, /"--port", str\(port\)/);
  assert.match(code, /port = 18787/);
  assert.match(code, /bridge_port_unavailable/);
  assert.match(code, /"I_UNDERSTAND_COST"/);
  assert.match(code, /configure-bridge-macos\.mjs/);
  assert.match(code, /"model_called": False/);
  assert.doesNotMatch(code, /return\s+token\b/);
  assert.doesNotMatch(code, /codex", "exec"/);
  const syntax = spawnSync(
    'python3',
    ['-c', 'import sys; compile(sys.stdin.read(), "<expert>", "exec")'],
    { input: code, encoding: 'utf8' },
  );
  assert.equal(syntax.status, 0, syntax.stderr);
});

test('compact bridge verification is pinned and does not invoke a model or agent', () => {
  const installer = loadInstaller();
  const code = installer.verifyExpertCode();
  const metadata = installer.metadata();
  const actualHash = crypto.createHash('sha256').update(code).digest('hex');

  assert.equal(metadata.verifyExpertName, 'extella_codex_verify_v1');
  assert.equal(metadata.verifyExpertSha256, actualHash);
  assert.match(code, /action="verify"/);
  assert.match(code, /127\.0\.0\.1/);
  assert.match(code, /EXTELLA_BRIDGE_ACCOUNT_BINDING/);
  assert.match(code, /"model_called": False/);
  assert.doesNotMatch(code, /codex", "exec"/);
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

  assert.equal(metadata.bridgeExpertName, 'extella_codex_account_bridge_v2');
  assert.equal(metadata.bridgeExpertSha256, actualHash);
  assert.match(code, /"schema_version": "1\.2"/);
  assert.match(code, /conversation_id: str = ""/);
  assert.match(code, /body\["conversation_id"\] = conversation_id/);
  assert.match(code, /"provider": "codex"/);
  assert.match(code, /"capability": "general-assistance"/);
  assert.match(code, /extella-account-v1\./);
  assert.match(code, /local_environment\("EXTELLA_API_TOKEN"\)/);
  assert.doesNotMatch(code, /account_config/);
  assert.match(code, /\["\/bin\/launchctl", "getenv", name\]/);
  assert.doesNotMatch(code, /agent_id: str|provider: str|capability: str/);
});

test('host bridge pins the installer and account scope instead of accepting commands', () => {
  assert.match(marketplaceSource, /e\.data\.type === 'etb_codex_install'/);
  assert.match(
    marketplaceSource,
    /e\.source !== _cf\.contentWindow/,
  );
  assert.match(
    marketplaceSource,
    /ETB\.codexInstaller\.install/,
  );
  assert.match(
    marketplaceSource,
    /ETB\.codexInstaller\.connectionStatus/,
  );
  assert.doesNotMatch(
    marketplaceSource,
    /etb_codex_install[\s\S]{0,600}e\.data\.(name|command|target|token)/,
  );

  const installer = loadInstaller();
  const source = installerSource;
  assert.doesNotMatch(source, /window\.extellaDesktop\.getDeviceID/);
  assert.doesNotMatch(source, /targets: \[deviceId\]/);
  assert.doesNotMatch(source, /ETB\.api\.targetsListScoped/);
  assert.match(source, /ETB\.api\.runExpertAsyncScoped/);
  assert.match(source, /ETB\.api\.getExpertScoped/);
  assert.match(source, /_readExpertCode\(readback\) !== code/);
  assert.match(source, /HEALTH_EXPERT_NAME/);
  assert.match(source, /ETB\.api\.agentsList\(\)/);
  assert.match(source, /ETB\.api\.saveExpert\(/);
  assert.match(source, /ETB\.api\.getExpert\(bridge\.name, \{ global: true \}\)/);
  assert.doesNotMatch(source, /getExpertScoped\(bridge\.name/);
  assert.match(source, /extella:codex-connection:v2/);
  assert.match(source, /global:\s*true/);
  assert.match(source, /ETB\.api\.agentToolsUpdateScoped/);
  assert.match(source, /ETB\.api\.ruleAddScoped/);
  assert.match(source, /EXTELLA_CODEX_ROUTING_V3/);
  assert.match(source, /reconcile_future_agents: true/);
  assert.match(apiSource, /saveExpertScoped/);
  assert.match(apiSource, /getExpertScoped/);
  assert.match(apiSource, /runExpertAsyncScoped/);
  assert.match(apiSource, /agentToolsUpdateScoped/);
});

test('installer stores setup in the concrete scope resolved for the current account', async () => {
  const currentAccountScope = 'agent_customer_current_12345678';
  let installerCode = '';
  let healthCode = '';
  let pluginInstallCode = '';
  let credentialsCode = '';
  let bridgeSetupCode = '';
  let verifyCode = '';
  let bridgeCode = '';
  let routingRule = '';
  let globalBridgeCode = '';
  let tools = ['existing_tool'];
  const targetScopes = [];
  const installerScopes = [];
  const recordRun = (name, params, opts, agentId) => {
    assert.equal(opts.global, false);
    assert.equal(Object.hasOwn(opts, 'targets'), false);
    if (targetScopes.length === 0) {
      assert.equal(name, '_etb_codex_host_health_v1');
      assert.equal(params.action, 'preflight');
      assert.equal(opts.wait, true);
    } else if (targetScopes.length === 1) {
      assert.equal(name, 'extella_codex_plugin_install_v1');
      assert.equal(params.action, 'install');
      assert.equal(opts.wait, true);
    } else if (targetScopes.length === 2) {
      assert.equal(name, 'extella_codex_credentials_v1');
      assert.equal(params.action, 'credentials');
      assert.equal(opts.wait, true);
    } else if (targetScopes.length === 3) {
      assert.equal(name, 'extella_codex_bridge_setup_v1');
      assert.equal(params.action, 'bridge');
      assert.equal(opts.wait, true);
    } else if (targetScopes.length === 4) {
      assert.equal(name, 'extella_codex_verify_v1');
      assert.equal(params.action, 'verify');
      assert.equal(opts.wait, true);
    } else {
      assert.fail('unexpected installer step');
    }
    targetScopes.push(agentId);
    return {
      result: JSON.stringify({
        status: 'success',
        code: params.step ? params.step + '_ok' : 'preflight_ok',
        message: 'ok',
        step: params.step || 'preflight',
        plugin_version: '0.2.1',
        restart_required: false,
        live_enabled: true,
        authorization_scope: 'account',
      }),
    };
  };
  const api = {
    resolveAccountScope: async () => currentAccountScope,
    runExpertScoped: async (name, params, opts, agentId) => recordRun(name, params, opts, agentId),
    runExpertAsyncScoped: async (name, params, opts, agentId) => recordRun(name, params, opts, agentId),
    agentsList: async () => ({ agents: [{ id: 'agent_async_device_12345678' }] }),
    agentGetScoped: async () => ({ tools: tools.slice() }),
    getExpertScoped: async (name, _agentId, opts) => {
      if (name === '_etb_codex_host_health_v1') {
        return { expert_code: healthCode };
      }
      if (name === 'extella_codex_plugin_install_v1') {
        return { expert_code: pluginInstallCode };
      }
      if (name === 'extella_codex_credentials_v1') {
        return { expert_code: credentialsCode };
      }
      if (name === 'extella_codex_bridge_setup_v1') {
        return { expert_code: bridgeSetupCode };
      }
      if (name === 'extella_codex_verify_v1') {
        return { expert_code: verifyCode };
      }
      if (name === '_etb_codex_setup_v2') {
        return { expert_code: installerCode };
      }
      throw new Error('not found');
    },
    getExpert: async (name, opts) => {
      assert.equal(name, 'extella_codex_account_bridge_v2');
      assert.equal(opts.global, true);
      return { expert_code: globalBridgeCode, global: true };
    },
    saveExpertScoped: async (def, agentId) => {
      if (def.name === '_etb_codex_host_health_v1') {
        healthCode = def.code;
        installerScopes.push(agentId);
        return { status: 'success' };
      }
      if (def.name === 'extella_codex_plugin_install_v1') {
        pluginInstallCode = def.code;
        installerScopes.push(agentId);
        return { status: 'success' };
      }
      if (def.name === 'extella_codex_credentials_v1') {
        credentialsCode = def.code;
        installerScopes.push(agentId);
        return { status: 'success' };
      }
      if (def.name === 'extella_codex_bridge_setup_v1') {
        bridgeSetupCode = def.code;
        installerScopes.push(agentId);
        return { status: 'success' };
      }
      if (def.name === 'extella_codex_verify_v1') {
        verifyCode = def.code;
        installerScopes.push(agentId);
        return { status: 'success' };
      }
      if (def.name === '_etb_codex_setup_v2') {
        installerCode = def.code;
        installerScopes.push(agentId);
        return { status: 'success' };
      }
      throw new Error('unexpected scoped Expert');
    },
    saveExpert: async (def) => {
      assert.equal(def.global, true);
      globalBridgeCode = def.code;
      return { status: 'success' };
    },
    ruleListScoped: async (opts) => {
      assert.equal(opts.global, true);
      return { rules: routingRule ? [{ rule_id: 1, rule: routingRule }] : [] };
    },
    ruleAddScoped: async (rule, opts) => {
      assert.equal(opts.global, true);
      routingRule = rule;
      return { rule_id: 1 };
    },
    ruleUpdateScoped: async (_id, rule) => {
      routingRule = rule;
      return { status: 'success' };
    },
    agentToolsUpdateScoped: async (_agentId, nextTools) => {
      tools = nextTools.slice();
      return { status: 'success' };
    },
    kvSet: async () => ({ status: 'success' }),
  };
  const installer = loadInstaller(api);

  const result = await installer.install();

  assert.equal(result.status, 'success');
  // The default Mac is resolved by Extella itself. Private setup Experts stay
  // inside a concrete scope returned from the current account's agent list.
  assert.deepEqual(targetScopes, Array(5).fill(currentAccountScope));
  assert.deepEqual(installerScopes, Array(6).fill(currentAccountScope));
});

test('fleet reconciliation preserves tools and installs Codex for every agent', async () => {
  const bridgeCodeContext = { ETB: {} };
  vm.runInNewContext(accountBridgeSource, bridgeCodeContext);
  const bridge = bridgeCodeContext.ETB.codexAccountBridge;
  const agentRows = [
    { id: 'agent_current_12345678' },
    { id: 'agent_future_12345678' },
    { id: 'agent_extella_default' },
    { id: 'agent_stock_short_12345678' },
  ];
  const agentDetails = [
    { id: 'agent_current_12345678', tools: ['web_search'] },
    { id: 'agent_future_12345678', tools: [bridge.name, 'other_tool'] },
    {
      id: 'agent_extella_default',
      isPublic: true,
      tools: ['sys__all__sys_mcp_extella', 'web_search'],
    },
    {
      id: 'agent_stock_short_12345678',
      tools: ['run_expert', 'web_search'],
    },
  ];
  let globalExpertCode = '';
  let routingRule = '';
  const updates = [];
  const saves = [];
  let stateWrite = null;
  let globalReadCount = 0;
  const api = {
    agentsList: async () => ({ agents: agentRows }),
    getExpert: async (name, opts) => {
      assert.equal(opts.global, true);
      assert.equal(name, bridge.name);
      globalReadCount += 1;
      if (!globalExpertCode) return { status: 'not_found' };
      return { expert_code: globalExpertCode, name, global: true };
    },
    saveExpert: async (def) => {
      saves.push({ def });
      globalExpertCode = def.code;
      return { status: 'success' };
    },
    ruleListScoped: async (opts) => {
      assert.equal(opts.global, true);
      return { rules: routingRule ? [{ rule_id: 1, rule: routingRule }] : [] };
    },
    ruleAddScoped: async (rule, opts) => {
      assert.equal(opts.global, true);
      routingRule = rule;
      return { rule_id: 1 };
    },
    ruleUpdateScoped: async (_id, rule) => {
      routingRule = rule;
      return { status: 'success' };
    },
    agentToolsUpdateScoped: async (agentId, tools) => {
      updates.push({ agentId, tools: tools.slice() });
      // Stock agents may omit isPublic and silently ignore direct tool writes.
      // Their read-back still proves access through the built-in run_expert.
      if (agentId !== 'agent_stock_short_12345678') {
        agentDetails.find((item) => item.id === agentId).tools = tools.slice();
      }
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
  assert.equal(result.agentCount, 4);
  assert.equal(result.inheritedCount, 2);
  assert.deepEqual(
    updates,
    [
      {
        agentId: 'agent_current_12345678',
        tools: ['web_search', bridge.name],
      },
      {
        agentId: 'agent_stock_short_12345678',
        tools: ['run_expert', 'web_search', bridge.name],
      },
    ],
  );
  assert.equal(saves.length, 1);
  assert.equal(saves[0].def.global, true);
  assert.equal(saves[0].def.name, 'extella_codex_account_bridge_v2');
  assert.equal(globalReadCount, 2);
  assert.deepEqual(agentDetails[0].tools, ['web_search', bridge.name]);
  assert.deepEqual(agentDetails[1].tools, [bridge.name, 'other_tool']);
  assert.deepEqual(
    agentDetails[2].tools,
    ['sys__all__sys_mcp_extella', 'web_search'],
  );
  assert.deepEqual(
    agentDetails[3].tools,
    ['run_expert', 'web_search'],
  );
  assert.equal(stateWrite.enabled, true);
  assert.equal(stateWrite.schema_version, '2.0');
  assert.equal(stateWrite.expert_name, 'extella_codex_account_bridge_v2');
  assert.equal(stateWrite.reconcile_future_agents, true);
  assert.equal(stateWrite.system_mcp_agent_count, 2);
  assert.equal(stateWrite.routing_rule_marker, 'EXTELLA_CODEX_ROUTING_V3');
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
    getExpert: async () => {
      throw new Error('must not be reached');
    },
    saveExpert: async () => { writes += 1; },
    agentToolsUpdateScoped: async () => { writes += 1; },
    kvSet: async () => { writes += 1; },
  };

  await assert.rejects(
    loadInstaller(api).reconcileFleet(),
    /agent unavailable/,
  );
  assert.equal(writes, 0);
});

test('fleet reconciliation refuses connected state when global Expert readback is stale', async () => {
  let stateWrites = 0;
  const api = {
    agentsList: async () => ({
      agents: [{ id: 'agent_user_scope_12345678' }],
    }),
    agentGetScoped: async () => ({ tools: [] }),
    getExpert: async () => ({ expert_code: '' }),
    saveExpert: async () => ({ status: 'success' }),
    ruleListScoped: async () => ({ rules: [] }),
    ruleAddScoped: async () => ({ rule_id: 1 }),
    agentToolsUpdateScoped: async () => ({ status: 'success' }),
    kvSet: async () => { stateWrites += 1; },
  };

  await assert.rejects(
    loadInstaller(api).reconcileFleet(),
    /Проверка глобального Codex Expert после сохранения не прошла/,
  );
  assert.equal(stateWrites, 0);
});

test('storefront exposes a sibling Codex button and explicit consent states', () => {
  const claudeAt = storefrontSource.indexOf('onclick="claudeConnectModal()"');
  const codexAt = storefrontSource.indexOf('onclick="codexConnectModal()"');
  const automationAt = storefrontSource.indexOf('id="autoBtn"');

  assert.ok(claudeAt >= 0);
  assert.ok(codexAt > claudeAt);
  assert.ok(automationAt > codexAt);
  assert.match(storefrontSource, /Подключить Codex/);
  assert.match(storefrontSource, /Codex уже подключён/);
  assert.match(storefrontSource, /Проверить подключение/);
  assert.match(storefrontSource, /Обновить Codex/);
  assert.match(storefrontSource, /Сейчас будет подключено агентов/);
  assert.match(storefrontSource, /skAgentsFetch\(\)/);
  assert.match(storefrontSource, /id="cx_install_button"/);
  assert.match(storefrontSource, /_cxAgentCount>=0/);
  assert.match(storefrontSource, /Task ID:/);
  assert.match(storefrontSource, /4 000 знаков запроса/);
  assert.match(storefrontSource, /2 000 выходных токенов/);
  assert.match(storefrontSource, /120 секунд/);
  assert.match(storefrontSource, /всем текущим и будущим агентам/);
  assert.match(storefrontSource, /Сама установка бесплатна/);
  assert.match(storefrontSource, /могут расходовать лимит подписки Codex\/ChatGPT/);
  assert.match(storefrontSource, /Перезапуск не нужен/);
  assert.match(storefrontSource, /Не используй run_agent/);
  assert.match(storefrontSource, /etb_codex_install_progress/);
  assert.match(storefrontSource, /etb_codex_install_result/);
  assert.match(storefrontSource, /etb_codex_status/);
  assert.match(storefrontSource, /etb_codex_status_result/);
  assert.match(
    storefrontSource,
    new RegExp(loadInstaller().metadata().expertSha256),
  );
});

test('Codex modal uses the canonical panel typography and spacing scales', () => {
  const start = storefrontSource.indexOf('function _cxStepIndex');
  const end = storefrontSource.indexOf('function codexStartInstall');
  assert.ok(start >= 0 && end > start, 'Codex modal source must be present');
  const modalSource = storefrontSource.slice(start, end);
  const fontScale = new Set([11, 13, 15, 20, 26]);
  const spacingScale = new Set([4, 8, 12, 16, 24, 32, 48]);

  for (const match of modalSource.matchAll(/(?:font-size|font):([^;"']+)/g)) {
    for (const value of match[1].matchAll(/(\d+(?:\.\d+)?)px/g)) {
      assert.ok(fontScale.has(Number(value[1])), `non-canonical Codex font: ${value[1]}px`);
    }
  }
  for (const match of modalSource.matchAll(/(?:margin(?:-(?:top|right|bottom|left))?|padding(?:-(?:top|right|bottom|left))?|gap):([^;"']+)/g)) {
    for (const value of match[1].matchAll(/(\d+(?:\.\d+)?)px/g)) {
      assert.ok(spacingScale.has(Number(value[1])), `non-canonical Codex spacing: ${value[1]}px`);
    }
  }
});
