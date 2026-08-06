// Чтение реестра с устройства: три правила, каждое куплено живой поломкой.
//
// 06.08.2026, Агент 1С у владельца: на диске лежала свежая оболочка (3899
// символов), а витрина показывала «страницу нужно прочитать с устройства» и
// круг замыкался. Разбор нашёл ДВЕ причины, и обе были в этом файле:
//
//   1. ридер запускался АСИНХРОННО и с параметрами ожидания в теле запроса —
//      платформа отбивает такой прогон «Worker hung» (прямая проба 04.08:
//      синхронно 9,6 с и полный ответ, асинхронно 2,2 с и отказ);
//   2. перед КАЖДЫМ открытием панели эксперт-ридер пересохранялся: лишний
//      прогон ~10 с на каждый клик и лишняя точка отказа.
//
// Тест сторожит исходник, а не поведение браузера: DevTools в проде выключены,
// и «витрина показывает вчерашнюю карточку» иначе не разбирается.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const registry = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'core', 'registry.js'), 'utf8');
const router = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'core', 'router.js'), 'utf8');

function syncFromDeviceCode() {
  return syncFromDeviceBody()
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

function syncFromDeviceBody() {
  const start = registry.indexOf('syncFromDevice: function');
  assert.ok(start >= 0, 'syncFromDevice не найден');
  const end = registry.indexOf('clearDeviceTombstone: function', start);
  assert.ok(end > start, 'конец syncFromDevice не найден');
  return registry.slice(start, end);
}

// Комментарии вырезаем: в них объясняется, ПОЧЕМУ async и maxWait запрещены, и
// первая версия этого теста краснела ровно на своём объяснении. Ложный запрет
// обходят целиком, поэтому проверяем исполняемый код.

test('ридер реестра запускается синхронно и без параметров ожидания в теле', () => {
  const body = syncFromDeviceCode();
  assert.doesNotMatch(body, /runExpertAsync\(fnName/,
    'асинхронный прогон ридера платформа отбивает «Worker hung» — карточка не обновится');
  assert.match(body, /ETB\.api\.runExpert\(fnName/);
  assert.doesNotMatch(body, /maxWait\s*:/,
    'своё ожидание в теле запроса даёт тот же «Worker hung» — это забота клиента');
});

test('закрепление устройства — массивом targets', () => {
  const body = syncFromDeviceCode();
  assert.match(body, /opts\.targets = \[deviceId\]/,
    'одиночный target платформа игнорирует молча: чтение уйдёт на чужое устройство');
});

test('эксперт-ридер не пересохраняется на каждое открытие панели', () => {
  const body = syncFromDeviceCode();
  assert.match(body, /_readerReady\(code\)/,
    'сохранение обязано быть под условием «код уже принят аккаунтом»');
  assert.match(body, /_looksMissingExpert/,
    'повторное сохранение допустимо только когда аккаунт эксперта не знает');
  // Сохранение под условием: безусловного вызова в теле остаться не должно.
  assert.doesNotMatch(body, /^\s*var work = ETB\.api\.saveExpert\(\{/m,
    'saveExpert перед каждым чтением — лишний прогон и лишняя точка отказа');
});

test('страница панели помнится вместе с версией карточки', () => {
  assert.match(router, /function _rememberHtml\(id, version, html\)/);
  assert.match(router, /function _recallHtml\(id, version\)/,
    'без версии человек открывал бы вчерашнюю страницу после обновления продукта');
});

test('сбой чтения показывает последнюю рабочую оболочку, а не пустой экран', () => {
  const start = router.indexOf('_deviceReadFailedHTML()), opts)');
  assert.ok(start >= 0, 'ветка отказа не найдена');
  const around = router.slice(Math.max(0, start - 600), start + 80);
  assert.match(around, /_recallAnyHtml\(id\)/,
    'при отказе обязана показываться последняя рабочая страница, если она есть');
  assert.match(around, /_staleNoticeHTML\(\)/,
    'устаревшую страницу нельзя показывать молча — нужна честная плашка');
});
