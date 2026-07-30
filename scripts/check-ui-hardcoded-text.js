#!/usr/bin/env node
'use strict';

/**
 * Английский текст, зашитый в компоненты Библиотеки мимо словаря.
 *
 * ЗАЧЕМ. Предложение Эллы 30.07, и она права по существу: счётчики ключей этот класс
 * НЕ ЛОВЯТ ПО КОНСТРУКЦИИ — ни её, ни мой. Ключ может лежать в словаре, быть переведён
 * и вычитан, а на экране всё равно английский, потому что компонент пишет строку сам.
 * Так у нас и вышло: словарь заведён, а меню, счётчики «0 of 0», «Select all», «Retry»
 * и заголовки ошибок остались английскими.
 *
 * ЧЕСТНАЯ ОГОВОРКА О МЕТОДЕ. Элла предлагала рендерить собранную страницу и падать на
 * латинице. Это точнее, но требует браузерного движка в зависимостях — решение не моё
 * одно. Здесь проверка ищет то же самое в исходниках: текст, который ДОЙДЁТ до экрана —
 * подписи в разметке и строковые значения тех свойств, что видит человек. Метод слабее
 * рендера (динамику он не увидит), но сильнее счёта ключей, и на всех находках Эллы
 * срабатывает — это проверено на коммите до правок, а не предположено.
 *
 * Запуск:  node scripts/check-ui-hardcoded-text.js [--list]
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', 'modules', 'library', 'src');

// Слова, которым по-русски делать нечего: имена, протоколы, форматы, техника.
const ALLOW = new Set([
  'Anthropic', 'OpenAI', 'Google', 'Bedrock', 'Azure', 'Composio', 'Extella', 'GitHub',
  'HuggingFace', 'Qwen', 'Claude', 'MCP', 'KV', 'ID', 'API', 'CSV', 'JSON', 'YAML',
  'URL', 'HTTP', 'HTTPS', 'CSPL', 'UI', 'AI', 'SDK', 'RU', 'EN', 'KZ', 'OK',
]);
// Технические заглушки и примеры — их человек читает как код, а не как речь.
const ALLOW_RE = [
  /^[a-z0-9_.-]+$/,            // user-id, agent_id, app.timeout
  /^[A-Z0-9_]+$/,              // ENV_VAR
  /^\W+$/,                     // ·, —, ⌘K
  /^\d+$/,
  /^(px|rem|em|%)$/,
];

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.tsx')) files.push(p);
  }
})(root);

// Свойства, значение которых человек ВИДИТ (или слышит через экранный диктор).
const VISIBLE_PROPS = /\b(title|aria-label|placeholder|label|subtitle|emptyLabel|emptyTitle|emptySubtitle|caption|tooltip)=\{?"([^"]{2,})"/g;
// Текст между тегами: >Что-то английское<
const JSX_TEXT = />\s*([A-Z][A-Za-z][^<>{}\n]{1,60}?)\s*</g;
// Литерал между выражениями: {a} of {b}. Только на строках, которые ЯВНО разметка —
// иначе ловится TypeScript: дженерики Promise<...> и объявления интерфейсов.
const BETWEEN = /\}\s+([A-Za-z][A-Za-z ]{0,20}?)\s+\{/g;
const TS_NOISE = /\b(interface|type|extends|implements|Promise|Record|Array|Partial|Omit|Pick)\b/;

function suspicious(text) {
  const t = text.trim();
  if (!t || t.length < 2) return false;
  if (ALLOW.has(t)) return false;
  if (ALLOW_RE.some((re) => re.test(t))) return false;
  if (!/[A-Za-z]/.test(t)) return false;
  if (/[А-Яа-яЁё]/.test(t)) return false;      // русский текст — уже переведено
  if (t.split(/\s+/).every((w) => ALLOW.has(w))) return false;
  return true;
}

const findings = [];
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const seen = new Set();
  function add(idx, text, kind) {
    const line = src.slice(0, idx).split('\n').length;
    const key = line + ':' + text;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ file: path.relative(root, file), line, text: text.trim(), kind });
  }
  for (const m of src.matchAll(VISIBLE_PROPS)) if (suspicious(m[2])) add(m.index, m[2], 'свойство');
  function lineOf(idx) { return lines[src.slice(0, idx).split('\n').length - 1] || ''; }
  for (const m of src.matchAll(JSX_TEXT)) {
    const l = lineOf(m.index);
    if (TS_NOISE.test(l) || l.includes('=>')) continue;   // это код, а не подпись
    if (suspicious(m[1])) add(m.index, m[1], 'подпись');
  }
  for (const m of src.matchAll(BETWEEN)) {
    const l = lineOf(m.index);
    if (TS_NOISE.test(l) || !l.includes('<')) continue;
    if (suspicious(m[1])) add(m.index, m[1], 'между значениями');
  }
}

if (process.argv.includes('--list') || findings.length) {
  for (const f of findings.slice(0, 60)) {
    process.stdout.write(`  ${f.file}:${f.line}  ${f.kind}: «${f.text}»\n`);
  }
  if (findings.length > 60) process.stdout.write(`  …и ещё ${findings.length - 60}\n`);
}

if (findings.length) {
  process.stderr.write(
    `\nанглийский текст мимо словаря: ${findings.length} мест.\n` +
    'Словарь тут не поможет: строка написана прямо в компоненте, и русский экран покажет её как есть.\n');
  process.exit(1);
}
process.stdout.write(`английский текст мимо словаря: не найден (проверено файлов: ${files.length})\n`);
