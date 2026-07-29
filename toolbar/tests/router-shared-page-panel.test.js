'use strict';

// Дефект «шапка своя, тело — мастер автоматизаций» (Алия, пункт 8 задания 28.07).
//
// Четыре плитки — «Скрыть личные данные», Композитор, Студия языков, «Команда» — это одна
// страница wizard.html на :8765, различающаяся только `?app=`. Проверено по живому реестру
// устройства. Панель кэшируется вместе с iframe, и если внутри окна ушли на Мастер, кэш
// сохранял и это: следующее открытие давало свою шапку и чужое тело.
//
// Тест закрепляет ровно границу починки: виды общей страницы (адрес с `?`) при повторном
// показе возвращаются на свой адрес, а окна с собственной страницей состояние сохраняют.
// Без этой границы «починка» превратилась бы в перезагрузку всего подряд.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const toolbarRoot = path.resolve(__dirname, '..');
const router = fs.readFileSync(path.join(toolbarRoot, 'src', 'core', 'router.js'), 'utf8');

function load() {
  const parts = ['  function _serviceUrl(plugin) {', '  function _resetSharedPagePanel(entry, plugin) {'];
  let src = '';
  for (const marker of parts) {
    const start = router.indexOf(marker);
    assert.ok(start >= 0, `не найдено начало ${marker.trim()}`);
    // Функция заканчивается на первой строке "  }" в начале строки.
    const end = router.indexOf('\n  }\n', start);
    assert.ok(end > start, `не найден конец ${marker.trim()}`);
    src += router.slice(start, end + 4) + '\n';
  }
  const context = { module: {} };
  vm.createContext(context);
  vm.runInContext(src + '\nmodule.exports = { _serviceUrl, _resetSharedPagePanel };', context);
  return context.module.exports;
}

function fakePanel(initialSrc) {
  const frame = { src: initialSrc };
  return {
    frame,
    entry: { panel: { querySelector: (sel) => (sel === 'iframe' ? frame : null) } },
  };
}

const SHARED = { ui: { port: 8765, mainFile: 'wizard.html?app=anon' } };
const OWN = { ui: { port: 34794, mainFile: 'ui/index.html' } };

test('вид общей страницы возвращается на свой адрес после ухода внутри окна', () => {
  const { _resetSharedPagePanel } = load();
  // Человек ушёл внутри окна на мастер автоматизаций — именно это кэш и сохранял.
  const { entry, frame } = fakePanel('http://localhost:8765/wizard.html');
  _resetSharedPagePanel(entry, SHARED);
  assert.equal(frame.src, 'http://localhost:8765/wizard.html?app=anon');
});

test('окно с собственной страницей состояние сохраняет — его не трогаем', () => {
  const { _resetSharedPagePanel } = load();
  const { entry, frame } = fakePanel('http://localhost:34794/ui/index.html#step=3');
  _resetSharedPagePanel(entry, OWN);
  assert.equal(frame.src, 'http://localhost:34794/ui/index.html#step=3');
});

test('четыре плитки визарда действительно делят одну страницу — это и есть причина', () => {
  const { _serviceUrl } = load();
  const apps = ['anon', 'composer', 'cspl', 'team'];
  const bases = new Set(
    apps.map((a) => _serviceUrl({ ui: { port: 8765, mainFile: 'wizard.html?app=' + a } }).split('?')[0]),
  );
  assert.equal(bases.size, 1, 'плитки обязаны делить одну базовую страницу');
  assert.equal([...bases][0], 'http://localhost:8765/wizard.html');
});

test('панель без iframe и плагин без порта не роняют повторный показ', () => {
  const { _resetSharedPagePanel } = load();
  const empty = { panel: { querySelector: () => null } };
  assert.doesNotThrow(() => _resetSharedPagePanel(empty, SHARED));
  const { entry, frame } = fakePanel('http://localhost:8765/wizard.html');
  _resetSharedPagePanel(entry, { ui: { mainFile: 'wizard.html?app=anon' } });
  assert.equal(frame.src, 'http://localhost:8765/wizard.html', 'без порта адреса нет — не трогаем');
});
