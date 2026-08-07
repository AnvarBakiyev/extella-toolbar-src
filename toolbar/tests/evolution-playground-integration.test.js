'use strict';
// Полигон против НАСТОЯЩИХ контрактов хоста, а не своей заглушки.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ. Тесты полигона проверяют логику runner на стенде, и стенд легко
// сделать удобным вместо правдивого — так и вышло дважды: сначала бандл описали формой
// «до преобразования», потом ждали от чтения агента исключения, хотя боевой `_post` на
// 404 возвращает ОТВЕТ. Здесь стенда нет: поднимаем живой `api.js` с подставным fetch и
// сверяем ожидания runner с тем, что действительно приходит из хоста и из `router.js`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const CORE = path.join(__dirname, '..', 'src', 'core');
const RUNNER_SRC = fs.readFileSync(path.join(CORE, 'evolution-playground-runner.js'), 'utf8');
const ROUTER_SRC = fs.readFileSync(path.join(CORE, 'router.js'), 'utf8');
// Код без комментариев: запреты проверяем по исполняемым строкам, иначе тест краснеет
// на объяснении, которое сам же требует («прежняя форма была такой-то»).
const RUNNER_CODE = RUNNER_SRC.split('\n')
  .filter((line) => !line.trim().startsWith('//')).join('\n');

// Живой api.js в песочнице: ему нужен минимальный каркас ETB (auth.onToken зовётся
// на загрузке) и подставной fetch, который отвечает нужным HTTP-кодом.
function loadRealApi(responder) {
  const calls = [];
  const context = {
    console, JSON, Promise, Date, Math, String, Number, Array, Object, Set, Map, RegExp, Error,
    setTimeout, clearTimeout, AbortController, TextEncoder,
    crypto: crypto.webcrypto,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    location: { href: 'https://extella.ai/' },
    navigator: { userAgent: 'node' },
    fetch: (url, init) => {
      const body = init && init.body ? JSON.parse(init.body) : {};
      calls.push({ url: String(url), body });
      const answer = responder(String(url), body);
      return Promise.resolve({
        ok: answer.status >= 200 && answer.status < 300,
        status: answer.status,
        headers: { get: () => 'application/json' },
        text: () => Promise.resolve(JSON.stringify(answer.body || {})),
        json: () => Promise.resolve(answer.body || {}),
      });
    },
  };
  context.window = context;
  context.globalThis = context;
  // Каркас auth — ровно тот, который api.js зовёт на загрузке и в работе.
  context.ETB = {
    auth: {
      onToken: () => {},
      onSessionChange: () => {},
      refreshSession: () => Promise.resolve(),
      getToken: () => 'token',
      getUserId: () => 'actor',
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(CORE, 'api.js'), 'utf8'), context,
    { filename: 'api.js' });
  return { api: context.ETB.api, calls, context };
}

test('боевой api.js на 404 отдаёт ОТВЕТ, а не исключение', async () => {
  const { api } = loadRealApi(() => ({ status: 404, body: { error: 'Agent not found' } }));
  const res = await api.agentGetScoped('agent_gone');
  assert.equal(res.status, 'not_found');
  assert.equal(res.httpStatus, 404);
});

test('runner принимает этот ответ как подтверждённый снос', async () => {
  // Собираем ровно ту связку, что бывает в бою: runner + живой api.js.
  const { api } = loadRealApi((url) => {
    if (url.endsWith('/api/agent/get')) return { status: 404, body: { error: 'Agent not found' } };
    if (url.endsWith('/api/agent/delete')) return { status: 200, body: { message: 'Agent deleted' } };
    return { status: 200, body: { status: 'success' } };
  });
  const ctx = {
    ETB: { api, agentControl: { sha256: (t) => Promise.resolve(
      crypto.createHash('sha256').update(String(t), 'utf8').digest('hex')) } },
    console, JSON, Promise, Date, Math, String, Number, Array, Object, Set, RegExp, Error,
  };
  ctx.globalThis = ctx;
  vm.runInNewContext(RUNNER_SRC, ctx, { filename: 'evolution-playground-runner.js' });
  const runner = ctx.ETB.evolutionPlaygroundRunner;
  // Прямая проверка ветки сноса: правило не добавлялось, значит убирать нечего.
  await assert.doesNotReject(() => runner._teardown('agent_gone', null));
});

test('spec из router.js совпадает с тем, что читает runner', () => {
  // Литерал payload у routed action — источник истины про имена полей. Если Console
  // добавит поле или переименует, тест покажет расхождение здесь, а не на живом прогоне.
  const at = ROUTER_SRC.indexOf("'runClassTest',");
  assert.ok(at > 0, 'вызов runClassTest в router.js не найден');
  const literal = ROUTER_SRC.slice(at, ROUTER_SRC.indexOf('}', at));
  const routerKeys = [...new Set([...literal.matchAll(
    /([A-Za-z0-9_]+):\s*(?:change\.|actor|candidateId)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(routerKeys, [
    'actorId', 'affectedAgentIds', 'baselineVersionByAgent',
    'candidateBundle', 'candidateBundleSha256', 'candidateId', 'targetListSha256',
  ], 'состав payload изменился — сверьте runner и тесты');
  // Каждое поле, которое runner читает из spec, обязано быть в этом составе.
  const used = [...new Set([...RUNNER_CODE.matchAll(/spec\.([A-Za-z0-9_]+)/g)].map((m) => m[1]))];
  for (const name of used) {
    assert.ok(routerKeys.includes(name),
      'runner читает spec.' + name + ', которого router не передаёт');
  }
});

test('форма candidateBundle в runner — та же, что проверяет evolution-console.js', () => {
  const consoleSrc = fs.readFileSync(path.join(CORE, 'evolution-console.js'), 'utf8');
  for (const marker of ['agent-configuration-bundle.v1',
    'extella.evolution.shared_gene_change.v1', 'beforeVersionByAgent', 'desiredVersion']) {
    assert.ok(consoleSrc.includes(marker), 'в evolution-console.js нет ' + marker);
    assert.ok(RUNNER_SRC.includes(marker), 'runner не сверяет ' + marker);
  }
  // Прежняя (ошибочная) форма не должна остаться нигде в полигоне.
  assert.doesNotMatch(RUNNER_CODE, /managed-agent-class-candidate\.v1/,
    'это вход ДО преобразования — на живом вызове он отбил бы правильный bundle');
});
