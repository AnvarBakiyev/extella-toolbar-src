'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { TextEncoder } = require('node:util');

const toolbarRoot = path.resolve(__dirname, '..');
const router = fs.readFileSync(path.join(toolbarRoot, 'src', 'core', 'router.js'), 'utf8');
const api = fs.readFileSync(path.join(toolbarRoot, 'src', 'core', 'api.js'), 'utf8');
const controlCore = fs.readFileSync(
  path.join(toolbarRoot, 'src', 'core', 'agent-control.js'),
  'utf8',
);
const manifest = JSON.parse(fs.readFileSync(
  path.join(toolbarRoot, 'plugins', 'scenarios', 'profit-growth.json'),
  'utf8',
));
const agentControlConstants = [...router.matchAll(
  /^\s*var (AGENT_CONTROL_[A-Z0-9_]+\s*=\s*[^;]+);/gm,
)].map((match) => `var ${match[1]};`).join('\n');
const LEDGER_KEY = 'xtl_agent_control:profitability_governance_v1';
const OWNER_ACCOUNT_ID = 'account_owner_real';

function controlSlice() {
  const start = router.indexOf('  function _agentControlSerialize');
  const end = router.indexOf('  function _studioReadObjects', start);
  assert.ok(start >= 0 && end > start, 'Agent Control helpers must be extractable');
  return router.slice(start, end);
}

test('legacy Agent Control bridge is retired and cannot bypass Evolution Console gates', () => {
  assert.match(router, /e\.data\.type === 'etb_agent_control'/);
  assert.match(router, /var src7 = _srcIframe\(e\);\s*if \(!src7\) return;/);
  const legacyStart = router.indexOf(
    "} else if (e.data.type === 'etb_agent_control')",
  );
  const legacyEnd = router.indexOf(
    "} else if (e.data.type === 'etb_evolution_console')",
    legacyStart,
  );
  assert.ok(legacyStart >= 0 && legacyEnd > legacyStart);
  const legacyBridge = router.slice(legacyStart, legacyEnd);
  assert.match(legacyBridge, /LEGACY_AGENT_CONTROL_BRIDGE_RETIRED/);
  assert.match(legacyBridge, /use etb_evolution_console/);
  assert.doesNotMatch(legacyBridge, /_agentControlAction\(/);

  const evolutionBridge = router.slice(
    legacyEnd,
    router.indexOf("} else if (e.data.type === 'etb_governance_probe')", legacyEnd),
  );
  assert.match(evolutionBridge, /if \(!_isBuiltinEvolutionConsole\(\)\)/);
  assert.match(router, /plugin === canonical/);
  assert.match(router, /ui\.tokenless === true/);
  assert.match(router, /iframe\.setAttribute\('sandbox',\s*'allow-scripts'\)/);
  assert.doesNotMatch(router, /sandbox['"],\s*['"][^'"]*allow-same-origin/);
  assert.match(router, /if \(!ui\.tokenless\) initPayload\.token = token/);
  assert.match(router, /type:\s*'etb_agent_control_result'/);
  assert.match(
    evolutionBridge,
    /result8\.public_error = _evolutionClone\(error\.publicError\)/,
  );
  assert.doesNotMatch(
    evolutionBridge,
    /e\.data\.type === 'etb_evolution_publish'/,
  );
});

test('Agent Control API surface is read-only outside its fixed verified KV ledger', () => {
  const source = controlSlice();
  assert.match(router, /AGENT_CONTROL_LEDGER_KEY = 'xtl_agent_control:profitability_governance_v1'/);
  assert.match(source, /_agentControlReadJson\(\s*AGENT_CONTROL_LEDGER_KEY/);
  assert.match(source, /_agentControlWriteJson\(\s*AGENT_CONTROL_LEDGER_KEY/);
  assert.match(router, /AGENT_CONTROL_MAX_SHARD_BYTES = 13000/);
  assert.match(source, /schemaVersion:\s*AGENT_CONTROL_INDEX_SCHEMA/);
  assert.match(source, /schemaVersion:\s*AGENT_CONTROL_SHARD_SCHEMA/);
  assert.match(source, /Immutable candidate\/evidence\/state shards are written and verified/);
  assert.match(source, /The final single root-index write is the managed active-pointer commit/);
  assert.match(source, /agentId:\s*ownerAgentId/);
  assert.match(source, /control-plane ledger owner mismatch/);
  assert.match(source, /ETB\.agentControl\.canonical\(readBack\) !== expected/);
  assert.match(source, /control-plane shard read-back mismatch/);
  assert.match(source, /control-plane sharded ledger read-back mismatch/);
  assert.doesNotMatch(
    source,
    /ETB\.api\.(?:conceptAddScoped|conceptDeleteScoped|ruleAddScoped|ruleUpdateScoped|ruleDeleteScoped|saveExpert|deleteExpert)\(/,
  );
});

function storageHarness() {
  const start = router.indexOf('  function _agentControlSerialize');
  const end = router.indexOf('  function _agentControlAgentRows', start);
  assert.ok(start >= 0 && end > start, 'storage helpers must be extractable');

  const values = new Map();
  const writes = [];
  const reads = [];
  const io = [];
  let failNextRootWrite = false;
  const context = {
    __testCurrentAccountId: OWNER_ACCOUNT_ID,
    ETB: {
      api: {
        kvGet(key, opts) {
          reads.push({ key, opts: opts || null });
          io.push({ type: 'read', key });
          if (!values.has(key)) {
            return Promise.resolve({ status: 'error', message: 'Key not found' });
          }
          return Promise.resolve({ status: 'success', value: values.get(key) });
        },
        kvSet(key, value, description, opts) {
          writes.push(key);
          io.push({ type: 'write', key });
          if (key === LEDGER_KEY && failNextRootWrite) {
            failNextRootWrite = false;
            return Promise.resolve({
              status: 'error',
              message: 'Injected root index write failure',
            });
          }
          values.set(key, value);
          return Promise.resolve({ status: 'success' });
        },
      },
    },
    crypto: webcrypto,
    TextEncoder,
    console,
  };
  vm.runInNewContext(controlCore, context, { filename: 'agent-control.js' });
  vm.runInNewContext(`
    ${agentControlConstants}
    var _agentControlSessionEpoch = 1;
    var _agentControlOperationChains = {};
    function _studioCurrentUserId() { return __testCurrentAccountId; }
    function _agentControlTestContext() {
      return {
        actorId: String(__testCurrentAccountId || ''),
        epoch: _agentControlSessionEpoch,
        operationId: 'test-operation',
        deadlineAt: Date.now() + 210000
      };
    }
    function _agentControlAssertContext(context, allowExpired) {
      if (!context || !context.actorId ||
          context.epoch !== _agentControlSessionEpoch ||
          String(_studioCurrentUserId() || '') !== context.actorId) {
        throw new Error('authenticated account changed; Agent Control operation was fenced');
      }
      if (!allowExpired && Date.now() > context.deadlineAt) {
        throw new Error('operation deadline exceeded');
      }
    }
    function _studioApiOk(response, label) {
      if (!response || response.detail || response.error ||
          response.status === 'error' || response.status === 'not_found' ||
          response.status === 'failed') {
        throw new Error((response && (response.message || response.error)) || (label + ' failed'));
      }
      return response;
    }
    ${router.slice(start, end)}
    this.storage = {
      read: function (ownerAgentId) {
        return _agentControlReadLedger(ownerAgentId, _agentControlTestContext());
      },
      write: function (ownerAgentId, ledger) {
        return _agentControlWriteLedger(
          ownerAgentId,
          ledger,
          _agentControlTestContext()
        );
      },
      readJson: function (key, ownerAgentId, allowMissing) {
        return _agentControlReadJson(
          key,
          ownerAgentId,
          allowMissing,
          _agentControlTestContext()
        );
      },
      isMissing: _agentControlIsMissingKv,
      setAccount: function (accountId) {
        __testCurrentAccountId = String(accountId || '');
        _agentControlSessionEpoch += 1;
      }
    };
  `, context, { filename: 'agent-control-storage-slice.js' });
  return {
    control: context.ETB.agentControl,
    storage: context.storage,
    values,
    writes,
    reads,
    io,
    failNextRootWrite() {
      failNextRootWrite = true;
    },
  };
}

function storageFixture() {
  const agents = [
    {
      id: 'agent_one_c_real',
      name: 'Агент 1С',
      role: 'one_c_controller',
      provider: 'alibaba',
      model: 'qwen',
    },
    {
      id: 'agent_target_real',
      name: 'Агент-таргетолог',
      role: 'targetologist',
      provider: 'alibaba',
      model: 'qwen',
    },
  ];
  const inventories = {};
  agents.forEach((agent, agentIndex) => {
    inventories[agent.id] = {
      agent: {
        ...agent,
        tools: [`read_tool_${agentIndex}`],
        instructionsSha256: String(agentIndex + 1).repeat(64),
      },
      hashes: {
        agent: 'a'.repeat(64),
        concepts: 'b'.repeat(64),
        rules: 'c'.repeat(64),
        experts: 'd'.repeat(64),
      },
      counts: { concepts: 12, rules: 12, experts: 20 },
      knowledge: Array.from({ length: 12 }, (_, index) => ({
        id: `knowledge_${agentIndex}_${index}`,
        name: `Знание ${index}`,
        preview: `Проверенное знание ${index} для управляемого решения по марже.`,
      })),
      localRules: Array.from({ length: 12 }, (_, index) => ({
        id: `local_rule_${agentIndex}_${index}`,
        text: `Локальное правило ${index}; оно не должно распространяться на другого агента.`,
      })),
      capabilities: [
        {
          id: 'profitability_gate',
          name: 'Управляемая политика прибыльного роста',
          shared: true,
          version: 'POLICY_EVALUATOR_V1',
        },
        {
          id: 'profitability_calculation',
          name: 'Расчёт фактической маржи',
          shared: false,
          version: 'CALC_V1',
        },
        ...Array.from({ length: 8 }, (_, index) => ({
          id: `capability_${agentIndex}_${index}`,
          name: `Возможность ${index}`,
          version: '1.0.0',
        })),
      ],
      processes: [{
        id: `managed_process_${agentIndex}`,
        name: 'Контроль маржи перед решением о росте',
      }],
    };
  });
  return { agents, inventories };
}

async function publishedStorageLedger(control) {
  const { agents, inventories } = storageFixture();
  const ownerAgentId = agents[0].id;
  let ledger = await control.newLedger(agents, inventories, {
    ownerAgentId,
    ownerAccountId: OWNER_ACCOUNT_ID,
    actorId: 'actor_owner',
    now: '2026-07-25T08:00:00.000Z',
  });
  ledger = await control.createDraft(ledger, {
    scope: { kind: 'selected', agentIds: agents.map((agent) => agent.id) },
    capabilityId: 'profitability_gate',
    actorId: 'actor_owner',
    now: '2026-07-25T08:05:00.000Z',
  });
  ledger = await control.runPlayground(ledger, ledger.currentDraftId, null, {
    actorId: 'actor_owner',
    now: '2026-07-25T08:10:00.000Z',
  });
  ledger = await control.publishDraft(
    ledger,
    ledger.currentDraftId,
    ledger.currentTestRunId,
    { actorId: 'actor_owner', now: '2026-07-25T08:15:00.000Z' },
  );
  return { agents, ledger, ownerAgentId };
}

test('verified sharded KV persists the full published ledger and fails closed on tampering', async () => {
  const { control, storage, values, writes } = storageHarness();
  const { agents, inventories } = storageFixture();
  const ownerAgentId = agents[0].id;
  let ledger = await control.newLedger(agents, inventories, {
    ownerAgentId,
    ownerAccountId: OWNER_ACCOUNT_ID,
    actorId: 'actor_owner',
    now: '2026-07-25T08:00:00.000Z',
  });
  ledger = await control.createDraft(ledger, {
    scope: { kind: 'selected', agentIds: agents.map((agent) => agent.id) },
    capabilityId: 'profitability_gate',
    actorId: 'actor_owner',
    now: '2026-07-25T08:05:00.000Z',
  });
  ledger = await control.runPlayground(ledger, ledger.currentDraftId, null, {
    actorId: 'actor_owner',
    now: '2026-07-25T08:10:00.000Z',
  });
  ledger = await control.publishDraft(
    ledger,
    ledger.currentDraftId,
    ledger.currentTestRunId,
    { actorId: 'actor_owner', now: '2026-07-25T08:15:00.000Z' },
  );
  agents.forEach((agent, index) => {
    const receipt = control.runActive(ledger, agent.id, {
      marginBps: index === 0 ? 1800 : 3000,
      runId: `managed_run_${index}_verified`,
    });
    ledger = control.recordRun(ledger, receipt, {
      actorId: 'actor_owner',
      now: `2026-07-25T08:16:0${index}.000Z`,
    });
  });

  const readBack = await storage.write(ownerAgentId, ledger);
  assert.equal(control.canonical(readBack), control.canonical(ledger));
  assert.equal(
    writes.at(-1),
    LEDGER_KEY,
    'verified shards must land before the active-pointer index',
  );
  assert.ok(
    writes.slice(0, -1).every((key) => key !== LEDGER_KEY),
  );
  assert.ok(values.size >= 6, 'version, test, run, and index records must be separate');
  for (const [key, value] of values) {
    assert.ok(
      Buffer.byteLength(value, 'utf8') <= 13000,
      `${key} must stay inside the practical KV shard limit`,
    );
  }
  const index = JSON.parse(values.get(LEDGER_KEY));
  assert.equal(index.schemaVersion, 'agent-control-index.v1');
  assert.equal(index.ownerAgentId, ownerAgentId);
  assert.equal(index.ownerAccountId, OWNER_ACCOUNT_ID);
  assert.equal(index.ledgerStateRef, `${LEDGER_KEY}:ledger:${index.ledgerStateId}`);
  assert.ok(values.has(index.ledgerStateRef), 'root index must refer to a verified ledger-state shard');
  assert.equal(Object.hasOwn(index, 'ledger'), false, 'unbounded ledger state must not stay in root index');
  assert.match(index.ledgerSha256, /^[a-f0-9]{64}$/);

  const versionKey = [...values.keys()].find(
    (key) => key.includes(':version:') && !key.includes(':chunk:'),
  );
  const tampered = JSON.parse(values.get(versionKey));
  if (tampered.payload) {
    tampered.payload.agents[ownerAgentId].agent.name = 'Подменённый агент';
    values.set(versionKey, control.canonical(tampered));
  } else {
    const chunkKey = tampered.chunkRefs[0];
    const chunk = JSON.parse(values.get(chunkKey));
    chunk.data = `${chunk.data} `;
    values.set(chunkKey, control.canonical(chunk));
  }
  await assert.rejects(
    storage.read(ownerAgentId),
    /(?:chunked payload|hydrated ledger) (?:length|hash) mismatch/,
  );
});

test('KV missing detection ignores valid values containing "key not found" and treats empty success as corruption', async () => {
  const { control, storage, values } = storageHarness();
  const key = `${LEDGER_KEY}:probe:missing-semantics`;
  const valid = { note: 'This valid evidence says key not found inside its value.' };

  values.set(key, control.canonical(valid));
  assert.equal(
    storage.isMissing({ status: 'success', value: control.canonical(valid) }),
    false,
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(await storage.readJson(key, 'agent_one_c_real', true))),
    valid,
  );

  values.set(key, '');
  await assert.rejects(
    storage.readJson(key, 'agent_one_c_real', true),
    /control-plane KV value is empty/,
  );
  values.delete(key);
  assert.equal(await storage.readJson(key, 'agent_one_c_real', true), null);
});

test('owner account is bound in the root index and a different account cannot hydrate the ledger', async () => {
  const { control, storage, values } = storageHarness();
  const { ledger, ownerAgentId } = await publishedStorageLedger(control);

  await storage.write(ownerAgentId, ledger);
  const index = JSON.parse(values.get(LEDGER_KEY));
  assert.equal(ledger.ownerAccountId, OWNER_ACCOUNT_ID);
  assert.equal(index.ownerAccountId, OWNER_ACCOUNT_ID);

  storage.setAccount('account_other_real');
  await assert.rejects(
    storage.read(ownerAgentId),
    /invalid control-plane ledger index|account|owner/i,
  );
});

test('immutable evidence shards are read before first write and reject same-key payload collisions', async () => {
  const {
    control, storage, values, writes, reads, io,
  } = storageHarness();
  const setup = await publishedStorageLedger(control);
  let { ledger } = setup;
  const { agents, ownerAgentId } = setup;
  const receipt = control.runActive(ledger, agents[0].id, {
    marginBps: 1800,
    runId: 'managed_collision_probe_run',
  });
  ledger = control.recordRun(ledger, receipt, {
    actorId: 'actor_owner',
    now: '2026-07-25T08:16:00.000Z',
  });

  await storage.write(ownerAgentId, ledger);
  const runKey = [...values.keys()].find(
    (key) => key.includes(':run:managed_collision_probe_run') && !key.includes(':chunk:'),
  );
  assert.ok(runKey, 'the immutable run evidence shard must exist');
  const firstRead = io.findIndex((entry) => entry.type === 'read' && entry.key === runKey);
  const firstWrite = io.findIndex((entry) => entry.type === 'write' && entry.key === runKey);
  assert.ok(firstRead >= 0 && firstRead < firstWrite, 'immutable shard must be read before write');

  const originalStoredRun = values.get(runKey);
  const tampered = JSON.parse(control.canonical(ledger));
  tampered.runs.managed_collision_probe_run.plannedActions = ['FORGED_ACTION'];
  writes.length = 0;
  reads.length = 0;
  io.length = 0;

  await assert.rejects(
    storage.write(ownerAgentId, tampered),
    /immutable|collision|content-addressed|different payload/i,
  );
  assert.equal(values.get(runKey), originalStoredRun, 'collision must not overwrite evidence');
  assert.ok(reads.some((entry) => entry.key === runKey), 'collision check must read existing shard');
  assert.equal(writes.includes(runKey), false, 'colliding shard must never be written');
  assert.equal(writes.includes(LEDGER_KEY), false, 'failed collision must not advance root index');
});

test('failed final root commit leaves the previously readable ledger active', async () => {
  const harness = storageHarness();
  const {
    control, storage, values, failNextRootWrite,
  } = harness;
  const setup = await publishedStorageLedger(control);
  const { agents, ownerAgentId } = setup;
  let { ledger } = setup;

  const oldLedger = await storage.write(ownerAgentId, ledger);
  const oldRoot = values.get(LEDGER_KEY);
  const receipt = control.runActive(ledger, agents[0].id, {
    marginBps: 1800,
    runId: 'managed_after_old_root_failure_probe',
  });
  ledger = control.recordRun(ledger, receipt, {
    actorId: 'actor_owner',
    now: '2026-07-25T08:17:00.000Z',
  });

  failNextRootWrite();
  await assert.rejects(
    storage.write(ownerAgentId, ledger),
    /read-back mismatch|Injected root index write failure/i,
  );
  assert.equal(values.get(LEDGER_KEY), oldRoot, 'failed commit must not replace the old root');
  const stillActive = await storage.read(ownerAgentId);
  assert.equal(
    control.canonical(stillActive),
    control.canonical(oldLedger),
    'orphaned new immutable shards must not corrupt the previously active ledger',
  );
});

test('ledger-state shard keeps the atomic root index below 13KB after at least twenty receipts', async () => {
  const { control, storage, values } = storageHarness();
  const setup = await publishedStorageLedger(control);
  let { ledger } = setup;
  const { agents, ownerAgentId } = setup;

  for (let index = 0; index < 20; index += 1) {
    const agent = agents[index % agents.length];
    const receipt = control.runActive(ledger, agent.id, {
      marginBps: index % 3 === 0 ? 1800 : 3000,
      runId: `managed_history_receipt_${String(index).padStart(2, '0')}`,
    });
    ledger = control.recordRun(ledger, receipt, {
      actorId: 'actor_owner',
      now: `2026-07-25T08:${String(20 + index).padStart(2, '0')}:00.000Z`,
    });
  }

  const readBack = await storage.write(ownerAgentId, ledger);
  assert.equal(control.canonical(readBack), control.canonical(ledger));
  const rootValue = values.get(LEDGER_KEY);
  const index = JSON.parse(rootValue);
  assert.ok(Buffer.byteLength(rootValue, 'utf8') < 13000, 'atomic root index must stay bounded');
  assert.equal(index.ownerAccountId, OWNER_ACCOUNT_ID);
  assert.match(index.ledgerStateId, /^[A-Za-z0-9_-]{8,96}$/);
  assert.equal(index.ledgerStateRef, `${LEDGER_KEY}:ledger:${index.ledgerStateId}`);
  assert.ok(values.has(index.ledgerStateRef), 'full ledger state must live in its own verified shard');
  assert.equal(Object.hasOwn(index, 'ledger'), false);
  for (const [key, value] of values) {
    assert.ok(
      Buffer.byteLength(value, 'utf8') <= 13000,
      `${key} must remain inside the practical KV limit`,
    );
  }
});

function agentInspectionHarness() {
  const start = router.indexOf('  function _agentControlAgentRows');
  const end = router.indexOf('  function _agentControlPlatformStatus', start);
  assert.ok(start >= 0 && end > start, 'agent inspection helpers must be extractable');

  let detail = {};
  const calls = [];
  const context = {
    ETB: {
      api: {
        agentsList() {
          return Promise.resolve({ status: 'success', agents: [] });
        },
        agentGetScoped(agentId) {
          calls.push({ surface: 'agent', agentId });
          return Promise.resolve({ status: 'success', agent: detail });
        },
        ruleListScoped(opts) {
          calls.push({ surface: 'rules', global: opts.global, agentId: opts.agentId });
          return Promise.resolve({ status: 'success', results: [] });
        },
        expertsListScoped(opts) {
          calls.push({ surface: 'experts', global: opts.global, agentId: opts.agentId });
          return Promise.resolve({ status: 'success', results: [] });
        },
      },
    },
    crypto: webcrypto,
    TextEncoder,
    console,
  };
  vm.runInNewContext(controlCore, context, { filename: 'agent-control.js' });
  vm.runInNewContext(`
    var __inspectionCalls = [];
    var _agentControlSessionEpoch = 1;
    function _studioCurrentUserId() { return '${OWNER_ACCOUNT_ID}'; }
    function _agentControlInspectionContext() {
      return {
        actorId: '${OWNER_ACCOUNT_ID}',
        epoch: _agentControlSessionEpoch,
        operationId: 'inspection-test',
        deadlineAt: Date.now() + 210000
      };
    }
    function _agentControlAssertContext(context, allowExpired) {
      if (!context || context.actorId !== _studioCurrentUserId() ||
          context.epoch !== _agentControlSessionEpoch) {
        throw new Error('authenticated account changed; Agent Control operation was fenced');
      }
      if (!allowExpired && Date.now() > context.deadlineAt) {
        throw new Error('operation deadline exceeded');
      }
    }
    function _studioApiOk(response, label) {
      if (!response || response.detail || response.error ||
          response.status === 'error' || response.status === 'not_found' ||
          response.status === 'failed') {
        throw new Error((response && (response.message || response.error)) || (label + ' failed'));
      }
      return response;
    }
    function _studioListAllConcepts(opts) {
      __inspectionCalls.push({
        surface: 'concepts',
        global: opts.global === true,
        agentId: opts.agentId
      });
      return Promise.resolve([]);
    }
    function _studioObjectId(row) {
      return row && (row.id != null ? row.id :
        (row.concept_id != null ? row.concept_id : row.rule_id));
    }
    function _studioConceptText(row) {
      return String((row && (row.text || row.concept_text)) || '');
    }
    function _studioRuleText(row) {
      return String((row && (row.rule || row.text)) || '');
    }
    ${router.slice(start, end)}
    this.agentInspection = {
      slim: _agentControlSlimAgent,
      inspectOne: function (agent) {
        return _agentControlInspectOne(agent, _agentControlInspectionContext());
      },
      conceptCalls: __inspectionCalls
    };
  `, context, { filename: 'agent-control-inspection-slice.js' });

  return {
    inspection: context.agentInspection,
    calls,
    setDetail(value) {
      detail = value;
    },
  };
}

test('agent eligibility uses authoritative provider/model only and /agent/get is revalidated', async () => {
  const { inspection, calls, setDetail } = agentInspectionHarness();
  const confirmed = {
    id: 'agent_qwen_real',
    name: 'Финансовый контролёр',
    provider: 'alibaba',
    model: 'qwen-plus',
    category: 'finance',
  };

  assert.equal(inspection.slim(confirmed).eligible, true);
  assert.equal(inspection.slim({
    id: 'agent_qwen_spoofed',
    name: 'Qwen Alibaba in a display name',
    provider: 'openai',
    model: 'gpt-5',
  }).eligible, false);
  assert.equal(inspection.slim({
    id: 'agent_other',
    name: 'Обычный агент',
    provider: 'alibaba',
    model: 'gpt-5',
  }).eligible, false);
  assert.equal(inspection.slim({
    id: 'agent_other_2',
    name: 'Обычный агент',
    provider: 'anthropic',
    model: 'qwen-plus',
  }).eligible, false);
  assert.equal(inspection.slim({
    id: 'agent_missing_model',
    name: 'Обычный агент',
    provider: 'alibaba',
    model: '',
  }).eligible, false);
  assert.equal(inspection.slim({
    id: 'agent_missing_provider',
    name: 'Обычный агент',
    provider: '',
    model: 'qwen-plus',
  }).eligible, false);

  setDetail({
    id: confirmed.id,
    name: confirmed.name,
    provider: confirmed.provider,
    model: confirmed.model,
    category: confirmed.category,
    instructions: 'Read-only instructions',
    tools: [],
  });
  await inspection.inspectOne(confirmed);
  assert.deepEqual(
    Array.from(inspection.conceptCalls, (entry) => entry.global).sort(),
    [false, true],
    'effective Concepts require both local and account-global reads',
  );
  assert.deepEqual(
    calls.filter((entry) => entry.surface === 'rules')
      .map((entry) => entry.global).sort(),
    [false, true],
    'effective Rules require both local and account-global reads',
  );

  setDetail({
    ...confirmed,
    id: 'agent_different_from_requested',
  });
  await assert.rejects(
    inspection.inspectOne(confirmed),
    /agent|get|identity|id|mismatch/i,
  );

  setDetail({
    ...confirmed,
    provider: 'openai',
    model: 'gpt-5',
  });
  await assert.rejects(
    inspection.inspectOne(confirmed),
    /provider|model|qwen|mismatch/i,
  );
});

test('Agent Control inventory reads exact agent/config surfaces and returns bounded previews', () => {
  const source = controlSlice();
  assert.match(source, /ETB\.api\.agentGetScoped\(agent\.id\)/);
  assert.match(
    source,
    /_studioListAllConcepts\(\{\s*agentId:\s*agent\.id,\s*global:\s*false,[\s\S]{0,80}?context:\s*context\s*\}\)/,
  );
  assert.match(
    source,
    /_studioListAllConcepts\(\{\s*agentId:\s*agent\.id,\s*global:\s*true,[\s\S]{0,80}?context:\s*context\s*\}\)/,
  );
  assert.match(source, /ETB\.api\.ruleListScoped\(\{\s*agentId:\s*agent\.id,\s*global:\s*false\s*\}\)/);
  assert.match(source, /ETB\.api\.ruleListScoped\(\{\s*agentId:\s*agent\.id,\s*global:\s*true\s*\}\)/);
  assert.match(source, /ETB\.api\.expertsListScoped\(\{\s*agentId:\s*agent\.id,\s*global:\s*true\s*\}\)/);
  assert.match(source, /ETB\.agentControl\.sha256\(exactAgent\.instructions\)/);
  assert.match(source, /configurationSnapshotSha256/);
  assert.match(source, /exactConcepts\.slice\(0,\s*\d+\)/);
  assert.match(source, /exactRules\.slice\(0,\s*\d+\)/);
  assert.match(source, /exactExperts\.filter[\s\S]*?\.slice\(0,\s*\d+\)/);
  const displayStart = source.indexOf('          display: {');
  const displayEnd = source.indexOf(
    '            hashes: inventory.hashes\n          }',
    displayStart,
  );
  assert.ok(displayStart >= 0 && displayEnd > displayStart);
  const displayProjection = source.slice(displayStart, displayEnd);
  assert.doesNotMatch(displayProjection, /\binstructions\s*:/);
  assert.doesNotMatch(displayProjection, /\bcode\s*:/);
});

test('inventory previews redact obvious secrets and personal contact data before persistence', () => {
  const start = router.indexOf('  function _agentControlPreview');
  const end = router.indexOf('  function _agentControlInspectOne', start);
  assert.ok(start >= 0 && end > start);
  const context = {};
  vm.runInNewContext(
    `${router.slice(start, end)}\nthis.preview = _agentControlPreview;`,
    context,
  );
  assert.match(context.preview('API_KEY=super-secret-value'), /СКРЫТО/);
  assert.match(context.preview('owner@example.com'), /СКРЫТО/);
  assert.match(context.preview('+7 (777) 123-45-67'), /СКРЫТО/);
  assert.equal(context.preview('Обычное знание о марже', 80), 'Обычное знание о марже');
});

test('Agent Control actions are explicit, require authoritative Qwen/Alibaba identity, and fail closed for organization scope', () => {
  const source = controlSlice();
  for (const action of [
    'bootstrap',
    'inspect',
    'baseline_create',
    'load',
    'draft_create',
    'playground_run',
    'publish',
    'rollback',
    'active_run',
  ]) {
    assert.match(source, new RegExp(`action === '${action}'`));
  }
  assert.match(source, /unsupported Agent Control action/);
  assert.match(source, /selected agents must be confirmed Qwen\/Alibaba agents/);
  assert.match(source, /var provider = String\(\(row && row\.provider\) \|\| ''\)/);
  assert.match(source, /var model = String\(\(row && row\.model\) \|\| ''\)/);
  assert.match(source, /ETB\.api\.agentGetScoped\(agent\.id\)/);
  assert.doesNotMatch(source, /var signature\s*=/);
  assert.match(
    source,
    /organization scope requires platform RBAC and a complete organization registry/,
  );
  assert.match(source, /baselineIds\.length !== 2/);
  assert.match(source, /new Set\(baselineIds\)\.size !== 2/);
});

test('business-rule parser accepts the exact 20% policy and rejects code, credentials, and drift', () => {
  const start = router.indexOf('  function _agentControlRuleText');
  const end = router.indexOf('  function _agentControlOwner', start);
  assert.ok(start >= 0 && end > start);
  const context = {};
  vm.runInNewContext(
    `${router.slice(start, end)}\nthis.parseRule = _agentControlRuleText;`,
    context,
  );
  const exact = 'Если фактическая маржа продукта ниже 20%, не увеличивать рекламный бюджет. Предложить остановку или пересмотр кампании.';
  assert.equal(context.parseRule(exact), exact);
  assert.throws(
    () => context.parseRule('Если маржа ниже 25%, не увеличивать рекламный бюджет и проверить кампанию.'),
    /below 20%/,
  );
  assert.throws(
    () => context.parseRule('Если фактическая маржа выше 20%, не увеличивать рекламный бюджет и проверить кампанию.'),
    /below 20%/,
  );
  assert.throws(
    () => context.parseRule('Если маржа ниже 20% или 30%, не увеличивать рекламный бюджет и проверить кампанию.'),
    /no percentage threshold other than 20%/,
  );
  assert.throws(
    () => context.parseRule(`${exact} function run() { return api_token; }`),
    /code and credentials/,
  );
});

test('managed publication is labelled as adapter-only, not native platform atomicity', () => {
  const source = controlSlice();
  assert.match(source, /id:\s*'profitability_gate'/);
  assert.match(source, /scope:\s*'managed_policy'/);
  assert.match(source, /capabilityId:\s*'profitability_gate'/);
  assert.match(source, /Deterministic managed policy evaluator/);
  assert.doesNotMatch(
    source,
    /Allowlisted deterministic Expert result consumed by managed runs/,
  );
  assert.match(source, /nativeBundleVersioning:\s*'PLATFORM_UNAVAILABLE'/);
  assert.match(source, /nativeAtomicPublish:\s*'PLATFORM_UNAVAILABLE'/);
  assert.match(source, /nativeRunVersionBinding:\s*'PLATFORM_UNAVAILABLE'/);
  assert.match(source, /multiDeviceCompareAndSwap:\s*'PLATFORM_UNAVAILABLE'/);
  assert.match(source, /auditIntegrity:\s*'KV_READBACK_VERIFIED_NOT_TAMPER_EVIDENT'/);
  assert.match(
    source,
    /dependencyGraph:\s*'MANAGED_LEDGER_DECLARATION_NOT_NATIVE_EXPERT_BINDING'/,
  );
  assert.match(
    source,
    /conflictDetection:\s*'MANAGED_POLICY_ONLY_NATIVE_RULES_NOT_EVALUATED'/,
  );
  assert.match(source, /profileScope:\s*'DEFAULT_PROFILE_ONLY'/);
  assert.match(
    source,
    /effectiveConfigCompleteness:\s*'LOCAL_AND_ACCOUNT_GLOBAL_READ_DEFAULT_PROFILE'/,
  );
  assert.match(
    source,
    /managedGuarantee:\s*'[^']*deterministic managed policy evaluator[^']*'/i,
  );
  assert.match(
    source,
    /nativeGuarantee:\s*'[^']*(?:Native Rules|outside this adapter)[^']*'/,
  );
});

test('active-run bridge passes immutable actor and timestamp metadata into recordRun', () => {
  const source = controlSlice();
  assert.match(controlCore, /function recordRun\(ledger,\s*receipt,\s*opts\)/);
  assert.match(controlCore, /RUN_ACTOR_REQUIRED/);
  assert.match(
    source,
    /ETB\.agentControl\.recordRun\(next,\s*receipt,\s*\{\s*actorId:\s*actorId,\s*now:\s*recordedAt\s*\}\)/,
  );
});

test('scoped API helpers keep credentials in the host and bind reads/writes to agent headers', () => {
  assert.match(api, /agentGetScoped:\s*function \(agentId\)/);
  assert.match(api, /_post\('\/api\/agent\/get'/);
  assert.match(api, /expertsListScoped:\s*function \(opts\)/);
  assert.match(api, /_post\('\/api\/experts_db\/list'/);
  assert.match(
    api,
    /kvGet:\s*function \(key,\s*opts\)[\s\S]*?'X-Agent-Id':\s*opts\.agentId/,
  );
  assert.match(
    api,
    /kvSet:\s*function \(key,\s*value,\s*desc,\s*opts\)[\s\S]*?'X-Agent-Id':\s*opts\.agentId/,
  );
});

test('Evolution Console manifest keeps the stable install identity and narrow trusted publish declaration', () => {
  assert.equal(manifest.id, 'profit-growth-scenario');
  assert.equal(manifest.name, 'Evolution Console');
  assert.equal(manifest.version, '0.19.0');
  assert.equal(manifest.ui.htmlFile, 'evolution-console.html');
  assert.equal(manifest.ui.tokenless, true);
  assert.deepEqual(
    manifest.capabilities.map((capability) => capability.id).sort(),
    [
      'agent_change_management',
      'agent_passport_risks',
      'automation_registry',
      'data_protection_posture',
      'evolution_lab',
      'evolution_loop',
      'mcp_read_inventory',
      'shared_genes_map',
      'trusted_publish_action',
    ],
  );
  assert.equal(
    manifest.capabilities.find(
      (capability) => capability.id === 'agent_change_management',
    ).version,
    'EVOLUTION_AGENT_CONTROL_SURFACE_V1',
  );
  assert.deepEqual(
    manifest.capabilities.filter((capability) => capability.external_writes),
    [manifest.capabilities.find((capability) => capability.id === 'trusted_publish_action')],
  );
  assert.equal(
    manifest.capabilities.find(
      (capability) => capability.id === 'trusted_publish_action',
    ).version,
    'EVOLUTION_TRUSTED_PUBLISH_ACTION_V1',
  );
  assert.deepEqual(manifest.experts, ['_etb_evolution_registry_scan_v1']);
  assert.equal(manifest.expert_defs.length, 1);
  assert.equal(
    manifest.expert_defs[0].name,
    '_etb_evolution_registry_scan_v1',
  );
  assert.equal(manifest.owned_experts, true);
});
