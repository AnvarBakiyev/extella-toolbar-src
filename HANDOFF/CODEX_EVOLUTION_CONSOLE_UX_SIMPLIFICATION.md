# Передача интегратору: упрощение Evolution Console

Дата: 26.07.2026

Ветка: `codex/evolution-console-ux-simplification`

База: свежий `origin/main` (`a0db59f`)

## Результат

Первый экран Evolution Console перестроен вокруг трёх вопросов пользователя:

1. сколько агентов в парке;
2. что требует внимания;
3. какое следующее действие доступно.

Доменные контракты, единый расчёт рисков через канонический
`check_agent_passport.py`, Agent Cabinet из стандартов, Shared Genes,
Evolution Lab, Evolution Loop, гейты массовых операций и Evolution Receipts
не заменялись и не дублировались.

## Основные изменения

- Первый уровень навигации сокращён до `Обзор`, `Shared Genes` и
  `Эскалации`.
- Риски, массовые операции и Evolution Receipts находятся в свёрнутом меню
  `Дополнительно`.
- На обзоре появились три понятные метрики и список задач
  `Что требует внимания`.
- Карточки внимания рассчитываются только из канонической проекции парка и
  ведут к точному фильтру или экрану действия.
- Реестр сокращён до пяти колонок:
  агент, статус, Agent Genome, проблема, следующий шаг.
- Основной CTA для прошедшего проверку агента открывает существующий
  Agent Cabinet.
- Поиск и четыре быстрых фильтра остаются на виду; расширенные фильтры и
  экспорт JSON/CSV свёрнуты.
- Технические коды checker, пути, SHA-256 и сведения об источнике перенесены
  в раскрываемые технические блоки.
- На ширине до 700 px каждая строка реестра становится отдельной карточкой
  с явными подписями всех пяти полей.
- Добавлены видимый focus-ring, live regions, семантика таблицы и диалога,
  Escape/focus trap/возврат фокуса для Agent Cabinet.
- Русская и английская копия используют обязательный словарь Extella
  Evolution без новых продуктовых названий.

## Изменённые файлы

- `toolbar/plugins/scenarios/evolution-console.html`
- `toolbar/tests/evolution-console-ux-simplicity.test.js`
- `HANDOFF/CODEX_EVOLUTION_CONSOLE_UX_SIMPLIFICATION.md`

## Проверки

Зелёные проверки:

- standards-gated `node --test tests/*.test.js`: **125/125**, без skipped;
- строгий brand checker: **PASS**;
- `npm run test:account-scope`: **PASS**;
- `npm run test:managed-runtime`: **PASS**;
- `npm run test:reproducible` на изолированной копии: **PASS**;
- `git diff --check`: **PASS**;
- проверка изменённых файлов на распространённые форматы секретов:
  совпадений нет.

Существующие baseline-гейты, не затронутые этой UX-веткой:

- `npm run test:runtime-portability` остаётся красным на старых
  `toolbar.js`, `HANDOFF/toolbar.js`, install-prompt и release module list;
- `npm run test:catalog-contract` остаётся красным на существующих
  capability-studio/evolution-standards/profit-growth и managed-runtime
  контрактах.

Перечень этих baseline-проблем уже зафиксирован в командной доске и прежних
handoff-документах.

## Официальное включение

1. Провести review и влить ветку в `main`.
2. В чистом checkout актуального `origin/main` повторить профильные тесты и
   строгий brand checker.
3. Выполнить канонический build/release/install согласно
   `docs/TEAM_PROTOCOL.md`.
4. Полностью перезапустить Extella Desktop.
5. Проверить пользовательский путь:

   `Extella Evolution → Evolution Console → Обзор`.

6. Убедиться, что:
   - карточки внимания открывают правильный фильтр или экран;
   - Agent Cabinet открывается из строки агента;
   - меню `Дополнительно` закрыто по умолчанию;
   - mobile-реестр отображается карточками;
   - изменение Shared Genes проходит только через существующие гейты
     Evolution Lab и Evolution Loop.

**Запрещено:** устанавливать или публиковать toolbar напрямую из этой
side-ветки. По командному протоколу deploy выполняет интегратор только из
чистого `origin/main` после merge и канонической release-сборки.

## Rollback

1. Откатить merge-коммит этой ветки в `main`.
2. Повторить официальный build/release/install из чистого `origin/main`.
3. Полностью перезапустить Extella Desktop.

Изменений в ledger, Agent Genome, Agent Passport, Shared Genes или данных
агентов эта ветка не выполняет.
