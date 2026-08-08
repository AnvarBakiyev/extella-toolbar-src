#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

// agent_extella_default — ПЛАТНЫЙ Claude. Запрещён абсолютно: канон Extella —
// клиентские агенты только Qwen, и деньги клиента не тратятся по чужому тарифу.
const forbiddenAbsolute = ['agent_extella_default'];


// agent_extella_alibaba_default — платформенный Qwen. Разрешён ТОЛЬКО как
// единственный документированный фолбэк в api.js (и в сгенерированных из него
// артефактах). Причина — живая проверка 26.07.2026: на аккаунте БЕЗ личного
// Qwen-агента /api/agent/list отдаёт только Claude и MiniMax. Ранжирование в
// api.js намеренно исключает не-Qwen провайдеров, поэтому без этого фолбэка у
// такого аккаунта не остаётся НИ ОДНОГО допустимого агента: заголовок
// X-Agent-Id уходит пустым и платформа отвечает 400 «Agent required».
// Раньше правило запрещало и его — то есть пройти проверку можно было только
// нарушив канон. Гейт, который нельзя пройти честно, сам является дефектом.
const platformQwenFallback = 'agent_extella_alibaba_default';
const qwenFallbackAllowedIn = [
  path.join('toolbar', 'src', 'core', 'api.js'),
  path.join('toolbar', 'toolbar.js'),
  path.join('HANDOFF', 'toolbar.js'),
];
const inputs = [
  path.join(root, 'toolbar', 'src'),
  path.join(root, 'toolbar', 'public'),
  path.join(root, 'modules', 'library', 'src'),
  path.join(root, 'toolbar', 'toolbar.js'),
  path.join(root, 'HANDOFF', 'toolbar.js'),
];

function files(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(target, entry.name);
    return entry.isDirectory() ? files(child) : entry.isFile() ? [child] : [];
  });
}

const failures = [];
for (const input of inputs) {
  for (const file of files(input)) {
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(root, file);
    for (const value of forbiddenAbsolute) {
      // Без исключений, включая комментарии: строки этого id не должно быть даже
      // в поставляемом артефакте, иначе следующая проверка снова покажет ложный след.
      // 28.07.2026: исключение для скоупа общих реестров заводили и ОТМЕНИЛИ — конфликт снят
      // переносом реестров в свободные имена, читателю закреплять агента больше не нужно.
      if (text.includes(value)) failures.push(`${rel}: ${value} (платный Claude — запрещён)`);
    }
    if (text.includes(platformQwenFallback) && !qwenFallbackAllowedIn.includes(rel)) {
      failures.push(`${rel}: ${platformQwenFallback} — платформенный Qwen допустим только как фолбэк в api.js`);
    }
  }
}
if (failures.length) {
  process.stderr.write(`account-scope portability failed:\n${failures.join('\n')}\n`);
  process.exit(1);
}

const api = fs.readFileSync(path.join(root, 'toolbar', 'src', 'core', 'api.js'), 'utf8');
if (!api.includes("_post('/api/agent/list', {})") || !api.includes("var BOOTSTRAP_AGENT_SCOPE = 'agent_XXXXXXXX'")) {
  process.stderr.write('account-scope portability failed: dynamic current-account resolution contract is missing\n');
  process.exit(1);
}
if (!api.includes("_post('/api/agent/list', {}, { 'X-Agent-Id': BOOTSTRAP_AGENT_SCOPE })") ||
    !api.includes('resolveAccountScope: _resolveAccountScope')) {
  process.stderr.write('account-scope portability failed: concrete current-account storage resolver is missing\n');
  process.exit(1);
}
const codexInstaller = fs.readFileSync(
  path.join(root, 'toolbar', 'src', 'core', 'codex-installer.js'),
  'utf8'
);
if (!codexInstaller.includes('return ETB.api.resolveAccountScope();')) {
  process.stderr.write('account-scope portability failed: Codex installer bypasses current-account storage resolution\n');
  process.exit(1);
}
process.stdout.write('account-scope portability: passed\n');
