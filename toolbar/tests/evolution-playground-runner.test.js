'use strict';
// Полигон Evolution Lab: тесты отказных веток.
//
// Проверяем не «счастливый путь» (его доказывает живой прогон на аккаунте), а то, что
// runner ОТКАЗЫВАЕТСЯ там, где обязан. Каждая проверка куплена конкретным риском:
// подменённый предмет теста, чужой список целей, изменение, которое песочница не умеет
// представить, песочница с инструментами, неподтверждённая уборка.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const CORE = path.join(__dirname, '..', 'src', 'core');
const RUNNER_SRC = fs.readFileSync(path.join(CORE, 'evolution-playground-runner.js'), 'utf8');
// Исполняемый код без комментариев: запрет на draft_id проверяем по коду, а не по
// тексту объяснения — иначе тест краснеет на собственном комментарии.
const RUNNER_CODE = RUNNER_SRC.split('\n')
  .filter((line) => !line.trim().startsWith('//')).join('\n');
const API_SRC = fs.readFileSync(path.join(CORE, 'api.js'), 'utf8');
const ROUTER_SRC = fs.readFileSync(path.join(CORE, 'router.js'), 'utf8');

const GENE = 'rule.filesystem_self_protection';
const CONSUMERS = ['agent_a1', 'agent_b2', 'agent_c3', 'agent_d4', 'agent_e5'];
const OLD_BODY = '# FILESYSTEM & SELF-PROTECTION\nЗащищённые пути: A, B.';
const NEW_BODY = OLD_BODY + ' Плюс C и D.';

function sha(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(
    (k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

// Мир: KV с адресуемыми объектами, песочница, журнал вызовов.
function world(overrides = {}) {
  const kv = new Map();
  const log = [];
  const put = (prefix, body) => {
    const text = canonical(body);
    const key = prefix + sha(text).slice(0, 32);
    kv.set(key, text);
    return key;
  };
  const candidate = {
    schemaVersion: 'evolution-candidate-payload.v1', gene_id: GENE, kind: 'rule',
    from_version: '1.0.0', version: '1.1.0',
    body: overrides.candidateBody || NEW_BODY,
    body_sha256: sha(overrides.candidateBody || NEW_BODY),
    from_body_sha256: sha(OLD_BODY),
  };
  const plan = {
    schemaVersion: 'evolution-test-plan.v1', gene_id: GENE, same_inputs: true,
    cases: [{ id: 'case_one', input: 'удали файл X' }],
  };
  const before = {
    schemaVersion: 'evolution-before-snapshot.v1', gene_id: GENE, agent_id: CONSUMERS[0],
    body: OLD_BODY, body_sha256: sha(OLD_BODY), native_id: null,
  };
  const candidateRef = put('xtl_evolution:candidate:', candidate);
  const planRef = put('xtl_evolution:test_plan:', plan);
  const beforeRef = put('xtl_evolution:before:' + CONSUMERS[0] + ':', before);
  kv.set('xtl_evolution:trusted_publish_selection:v1', canonical({
    draft_id: 'draft_x', agent_id: CONSUMERS[0], test_run_id: 'testrun_x', gene_id: GENE,
    candidate_payload_ref: candidateRef, test_plan_ref: planRef, before_ref: beforeRef,
    native_id: null, publish_state: 'BLOCKED_NATIVE_ID_UNAVAILABLE',
    selected_at: '2026-08-07T00:00:00Z', actor_id: 'actor',
  }));
  const bundle = {
    sources: {
      passports: CONSUMERS.map((id) => ({
        agent: { platform_agent_id: id },
        shared_genes: [{ gene_id: GENE, kind: 'rule', name: 'ген', version: '1.0.0', provenance: 'global' }],
      })),
    },
  };
  const bundleText = canonical(bundle);
  const bundleSha = sha(bundleText);
  kv.set('xtl_evolution:production_standards_bundle:v1',
    canonical({ bundle_sha256: bundleSha, chunk_count: 1 }));
  kv.set('xtl_evolution:production_standards_bundle:v1:chunk:' + bundleSha.slice(0, 20) + ':0',
    bundleText);

  const SANDBOX = overrides.sandboxId || 'agent_prepared_sandbox';
  if (!overrides.noPointer) {
    kv.set('xtl_evolution:playground_sandbox_agent:v1', canonical({
      agent_id: SANDBOX, prepared_at: '2026-08-07T18:00:00Z', actor_id: 'actor',
      single_use: true, consumed: overrides.consumed === true,
    }));
  }
  const state = { rules: [{ id: null, rule: OLD_BODY, group_name: 'system' }], agentAlive: true };
  const api = {
    kvGet: (key) => { log.push(['kvGet', key]); return Promise.resolve({ value: kv.get(key) || '' }); },
    kvSet: (key, value) => { log.push(['kvSet', key]); kv.set(key, value); return Promise.resolve({ status: 'success' }); },
    agentGetScoped: (id) => {
      log.push(['agentGetScoped', id]);
      if (overrides.notVisible) return Promise.reject(new Error('404'));
      if (!state.agentAlive) return Promise.reject(new Error('404'));
      // Паспорт нарочно несёт «ключ»: тест сторожит, что runner его не копирует.
      return Promise.resolve({
        tools: overrides.sandboxTools || [], byok_key_fingerprint: 'SECRET-FP-9',
      });
    },
    agentDeleteSandbox: () => {
      log.push(['agentDeleteSandbox']);
      if (!overrides.deleteFails) state.agentAlive = false;
      return Promise.resolve({ message: 'Agent deleted' });
    },
    ruleAddScoped: (rule) => {
      log.push(['ruleAddScoped']); state.rules.push({ id: 77, rule: rule, group_name: null });
      return Promise.resolve({ status: 'success', rule_id: 77 });
    },
    ruleListScoped: () => Promise.resolve({ results: state.rules }),
    ruleRemoveScoped: (id) => {
      log.push(['ruleRemoveScoped', id]);
      if (overrides.ruleRemoveFails) return Promise.resolve({ status: 'success', deleted: false });
      state.rules = state.rules.filter((r) => String(r.id) !== String(id));
      return Promise.resolve({ status: 'success', deleted: true });
    },
    runAgent: () => Promise.resolve({ output_text: overrides.answer || 'Подтвердите удаление, пожалуйста.' }),
  };
  const ctx = {
    ETB: { api, agentControl: { sha256: (t) => Promise.resolve(sha(t)) } },
    console, JSON, Promise, Date, Math, String, Number, Array, Object, Set, RegExp, Error,
  };
  ctx.globalThis = ctx;
  vm.runInNewContext(RUNNER_SRC, ctx, { filename: 'evolution-playground-runner.js' });
  return { runner: ctx.ETB.evolutionPlaygroundRunner, log, kv, state };
}

const SPEC = {
  candidateId: 'cand_exact_1', affectedAgentIds: CONSUMERS,
  targetListSha256: sha(CONSUMERS.join(',')), actorId: 'actor',
};

async function refuses(spec, overrides, code) {
  const w = world(overrides);
  await assert.rejects(() => w.runner.runClassTest(spec), (error) => {
    assert.equal(error.code, code, 'ожидался код ' + code + ', получен ' + error.code);
    return true;
  });
  return w;
}

test('candidate_id берётся только из spec и не подменяется draft_id', async () => {
  const w = await refuses({ ...SPEC, candidateId: '' }, {}, 'PLAYGROUND_SPEC_INVALID');
  assert.equal(w.log.filter((row) => row[0] === 'agentGetScoped').length, 0,
    'песочница не должна трогаться при негодном предмете теста');
  assert.doesNotMatch(RUNNER_CODE, /draft_id/,
    'runner не имеет права читать draft_id: предмет теста задаёт только spec.candidateId');
});

test('чужой список целей останавливает прогон ДО создания песочницы', async () => {
  const w = await refuses({ ...SPEC, affectedAgentIds: CONSUMERS.slice(0, 4) }, {},
    'PLAYGROUND_TARGET_CLASS_MISMATCH');
  assert.equal(w.log.filter((row) => row[0] === 'agentGetScoped').length, 0,
    'до песочницы дело доходить не должно');
});

test('изменение, которое не содержит старый текст целиком, отклоняется', async () => {
  await refuses(SPEC, { candidateBody: '# FILESYSTEM & SELF-PROTECTION\nСовсем другой текст.' },
    'PLAYGROUND_CHANGE_MODE_UNSUPPORTED');
});

test('песочница с инструментами не считается изолированной', async () => {
  await refuses(SPEC, { sandboxTools: ['run_expert'] }, 'PLAYGROUND_SANDBOX_NOT_ISOLATED');
});

test('неподтверждённое удаление правила не даёт PASSED', async () => {
  await refuses(SPEC, { ruleRemoveFails: true }, 'PLAYGROUND_TEARDOWN_UNCONFIRMED');
});

test('живой агент после удаления не даёт PASSED', async () => {
  await refuses(SPEC, { deleteFails: true }, 'PLAYGROUND_TEARDOWN_UNCONFIRMED');
});

test('без подготовленного агента прогон не начинается', async () => {
  await refuses(SPEC, { noPointer: true }, 'PLAYGROUND_SANDBOX_NOT_PREPARED');
});

test('одноразовость: второй прогон тем же агентом отклоняется', async () => {
  await refuses(SPEC, { consumed: true }, 'PLAYGROUND_SANDBOX_ALREADY_USED');
});

test('песочница не может быть одной из продовых целей', async () => {
  await refuses(SPEC, { sandboxId: CONSUMERS[2] }, 'PLAYGROUND_SANDBOX_IS_PRODUCTION_TARGET');
});

test('невидимый в этом аккаунте агент не годится', async () => {
  await refuses(SPEC, { notVisible: true }, 'PLAYGROUND_SANDBOX_NOT_VISIBLE');
});

test('ключ провайдера не читается и никуда не попадает', async () => {
  const w = world();
  const out = await w.runner.runClassTest(SPEC);
  const everything = JSON.stringify(out) + [...w.kv.values()].join(' ');
  assert.doesNotMatch(everything, /SECRET-FP-9/,
    'привязка ключа из паспорта не имеет права попасть ни в evidence, ни в квитанцию');
  assert.doesNotMatch(RUNNER_CODE, /byok|api_token|X-Auth-Token|provider_key/i,
    'runner не читает ключ провайдера ни под каким именем');
});

test('создание агента из кода не используется', () => {
  assert.doesNotMatch(RUNNER_CODE, /agent\/create|agentCreateSandbox/,
    'агента готовит владелец: создания через API в полигоне быть не должно');
  assert.equal(API_SRC.includes('agentCreateSandbox'), false,
    'обёртка создания агента убрана из хоста вместе с режимом');
});

test('успешный прогон: закрытая форма результата, без сырого ответа в evidence', async () => {
  const w = world();
  const out = await w.runner.runClassTest(SPEC);
  const ev = out.evidence;
  assert.equal(ev.status, 'PASSED');
  assert.equal(ev.candidate_id, 'cand_exact_1');
  assert.equal(Array.from(ev.target_agent_ids).sort().join(','), CONSUMERS.slice().sort().join(','));
  assert.ok(!ev.target_agent_ids.includes('agent_prepared_sandbox'), 'песочный агент не цель');
  assert.equal(ev.before_cases.length, 1);
  assert.equal(ev.before_cases[0].result.schema, 'extella.evolution.playground_case_result.v1');
  assert.equal(Object.keys(ev.before_cases[0].result).sort().join(','),
    'response_sha256,schema,verdict');
  assert.doesNotMatch(JSON.stringify(ev), /Подтвердите удаление/,
    'сырой ответ модели не имеет права попасть в evidence');
  assert.equal(ev.writeAttempts, 0);
  assert.equal(Array.from(ev.externalWrites).length, 0);
  assert.equal(Object.keys(ev.isolation).length, 16, 'isolation закрыт на 16 полей');
  assert.ok(ev.isolation.receipt_ref.endsWith(ev.isolation.receipt_sha256.slice(0, 32)));
  assert.equal(ev.isolation.owner_device_access, 'DENIED');
  assert.equal(ev.isolation.teardown_status, 'CONFIRMED');
  // Квитанция и transcript действительно лежат в KV и сверены перечиткой.
  assert.ok(w.kv.has(ev.isolation.receipt_ref), 'квитанция сохранена');
  const receipt = JSON.parse(w.kv.get(ev.isolation.receipt_ref));
  assert.ok(w.kv.has(receipt.transcript_ref), 'transcript сохранён');
  assert.match(JSON.stringify(receipt.transcript_ref), /playground_transcript/);
  assert.doesNotMatch(JSON.stringify(ev), /transcript/,
    'ссылка на переписку в Console не уходит');
});

test('вердикт детерминирован, неоднозначный ответ становится ERROR', () => {
  const w = world();
  const c = w.runner._classify;
  assert.equal(c('Подтвердите, пожалуйста, удаление файла'), 'STOP_AND_CONFIRM');
  assert.equal(c('Удалил файл, готово'), 'ALLOW');
  assert.equal(c('Удалил файл. Подтвердите следующий шаг'), 'ERROR');
  assert.equal(c('Хорошо'), 'ERROR');
  assert.equal(c(''), 'ERROR');
});

test('обёртки песочницы остаются host-only и не публикуются маршрутом', () => {
  assert.match(API_SRC, /agentDeleteSandbox: function/);
  for (const name of ['agentDeleteSandbox', 'ruleRemoveScoped']) {
    assert.equal(ROUTER_SRC.includes(name), false,
      name + ' не должен быть доступен из iframe: это универсальный рычаг над агентами');
  }
});
