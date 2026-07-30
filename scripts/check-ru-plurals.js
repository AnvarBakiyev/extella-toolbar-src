#!/usr/bin/env node
'use strict';

/**
 * Полнота русских форм числа в словарях Библиотеки.
 *
 * ЗАЧЕМ. 30.07 я перевёл 565 строк, объявив в записке для Эллы и на доске, что «в русском
 * ТРИ формы множественного числа». Это неверно: i18next берёт категорию из
 * Intl.PluralRules, а там у русского ЧЕТЫРЕ — one (1, 21), few (2–4), many (5–20, 25…),
 * other (дробные). Ключа `_many` у меня не было, и на пятёрке интерфейс молча уезжал на
 * английский fallback: «5 concepts» посреди русского экрана. Поймала Элла на вычитке.
 *
 * Хуже самой ошибки было то, что моя же самопроверка её пропустила: она требовала
 * «у каждого _one есть _few и _other» — то есть проверяла МОЮ ГИПОТЕЗУ, а не поведение
 * библиотеки. Поэтому здесь проверка идёт от Intl.PluralRules, а не от списка суффиксов,
 * который кто-то once записал руками: правило берётся у того, кто его исполняет.
 */

const fs = require('fs');
const path = require('path');

const dir = path.resolve(__dirname, '..', 'modules', 'library', 'src', 'i18n', 'locales', 'ru');
const failures = [];

if (!fs.existsSync(dir)) {
  process.stdout.write('русских словарей нет — проверять нечего\n');
  process.exit(0);
}

// Категории, которые реально может вернуть рантайм для русского.
const pr = new Intl.PluralRules('ru');
const NEEDED = Array.from(new Set(
  [0, 1, 2, 3, 4, 5, 11, 21, 22, 25, 100, 1.5].map((n) => pr.select(n))
)).sort();

for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const dict = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  const bases = new Set(
    Object.keys(dict)
      .filter((k) => /_(one|few|many|other)$/.test(k))
      .map((k) => k.replace(/_(one|few|many|other)$/, ''))
  );
  for (const base of bases) {
    for (const form of NEEDED) {
      if (!(`${base}_${form}` in dict)) {
        failures.push(`${file}: ${base}_${form} — без него это число уедет на английский`);
      }
    }
    // Счётчик без подстановки — почти наверняка ошибка копирования.
    for (const form of NEEDED) {
      const value = dict[`${base}_${form}`];
      if (typeof value === 'string' && !value.includes('{{count}}')) {
        failures.push(`${file}: ${base}_${form} не содержит {{count}}`);
      }
    }
  }
}

if (failures.length) {
  process.stderr.write(`русские формы числа неполны:\n${failures.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`русские формы числа: полны (категории ${NEEDED.join(', ')})\n`);
