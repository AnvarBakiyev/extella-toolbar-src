#!/usr/bin/env node
'use strict';

// Гейт переносимости рантайма тулбара.
//
// ПЕРЕПИСАН 29.07.2026. Прежняя редакция была списком из 13 запрещённых подстрок и давала 39
// срабатываний на трёх артефактах, из которых настоящими были два. Она ругалась на:
//
//   • `~/.nvm`, `/opt/homebrew`, `/usr/local/bin` — это НАШ ЖЕ фикс инцидента с PATH: список
//     кандидатов, по которому эксперт ищет бинарь, когда PATH урезан. Запрещать его значит
//     запрещать лекарство;
//   • `~/extella-plugins` — каноническое место реестра плагинов, оно и должно быть в коде;
//   • `os.kill(` по своему же pid-файлу — обычное завершение своего процесса;
//   • `label:'Работает'` — метка, у которой перевод ЕСТЬ («Running»), она переводится
//     наблюдателем DOM;
//   • `CRITICAL — ACT IMMEDIATELY` и `ETB.installPrompt =` — это не переносимость вообще.
//
// Гейт, который кричит там, где всё правильно, перестают читать — и он пропускает настоящее.
// Поэтому теперь проверяются СВОЙСТВА, и каждое правило объясняет, чем оно ломает клиента.
//
// Что НЕ проверяется здесь сознательно: судьба автономного установщика с GitHub
// (`toolbar/src/core/install-prompt.js`). Прежняя редакция требовала, чтобы его не
// существовало — но это продуктовое решение, которое НЕ БЫЛО ПРИНЯТО: выборочный мерж
// `9a1a663` взял инфраструктуру Codex «без их продуктовых выключателей». Гейт не вправе
// требовать то, чего никто не решал; вопрос открыт и лежит на доске.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sources = [
  path.join(root, 'toolbar', 'src'),
  path.join(root, 'toolbar', 'public'),
  path.join(root, 'toolbar', 'plugins'),
];

// Настоящие поломки переносимости: код, который у клиента на другой системе просто не работает.
const rules = [
  {
    code: 'HARDCODED_TMP',
    // На Windows каталога /tmp нет вовсе, и pid-файл туда не ляжет.
    // Файл, который сам нормализует путь (`_tmp_path`), про Windows знает — литерал в нём
    // это вход нормализатора, а не поломка. Ловим тех, кто нормализации не делает вовсе.
    test: (text) => /['"]\/tmp\//.test(text) && !text.includes('_tmp_path'),
    ru: 'жёсткий путь /tmp: на Windows такого каталога нет. Спроси временный каталог у системы',
    en: 'hardcoded /tmp path: Windows has no such directory. Ask the OS for a temp directory',
  },
  {
    code: 'UNIX_ONLY_KILL',
    // lsof и kill -9 есть не везде, и убивают чужой процесс, занявший порт.
    // Именно ЗАПУСК связки, а не упоминание в пояснении: иначе гейт валит комментарий,
    // объясняющий, почему так делать нельзя.
    test: (text) => /(subprocess|bash"?\s*,?\s*"?-c)[^\n]{0,80}lsof[^\n]{0,40}kill\s+-9/.test(text),
    ru: 'связка lsof + kill -9: этих команд нет на Windows, а на других системах она убьёт '
      + 'чужой процесс, занявший порт. Гаси свой процесс по своему pid-файлу',
    en: 'lsof + kill -9: these commands are absent on Windows, and elsewhere this kills whatever '
      + 'process holds the port. Stop your own process via your own pid file',
  },
];

const failures = [];

function files(target) {
  if (!fs.existsSync(target)) return [];
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) return files(child);
    return entry.isFile() && /\.(js|html)$/.test(entry.name) ? [child] : [];
  });
}

for (const source of sources) {
  for (const file of files(source)) {
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(root, file);
    for (const rule of rules) {
      // Осознанное исключение помечается в коде: `canon-ok: причина`.
      const hit = typeof rule.test === 'function' ? rule.test(text) : rule.test.test(text);
      if (hit && !/canon-ok:\s*\S+/.test(text)) {
        failures.push(`${rel}: ${rule.code} — ${rule.ru}`);
      }
    }
  }
}

// Установщик как отдельный файл ретайрен — это решение БЫЛО принято и выполнено.
const retiredInstaller = path.join(root, 'install.sh');
if (!fs.existsSync(retiredInstaller)) {
  failures.push('install.sh: заглушка ретайренного установщика отсутствует');
} else {
  const source = fs.readFileSync(retiredInstaller, 'utf8');
  if (!source.includes('EXTELLA_STANDALONE_INSTALLER_RETIRED=1')) {
    failures.push('install.sh: отдельный установщик не помечен ретайренным (fail-closed)');
  }
  for (const value of ['api_token.txt', 'npm install -g', 'git clone', 'read -p', 'shell=True']) {
    if (source.includes(value)) {
      failures.push(`install.sh: в заглушке осталось «${value}» — она обязана только печатать `
        + 'рабочую команду, а не ставить');
    }
  }
}

if (failures.length) {
  process.stderr.write(`переносимость рантайма — нарушения:\n${failures.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write('toolbar runtime portability: passed\n');
