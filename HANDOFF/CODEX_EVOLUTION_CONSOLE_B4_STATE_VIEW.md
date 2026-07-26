# Evolution Console B4 — честное состояние и мёртвые расписания

Дата: 2026-07-27
Ветка: `codex/console-state-view`
База: `origin/main@c31c501b6bc7b59c58b9b298b135ddd2dc4bd5a9`
Задание: `extella-core-portal/docs/handoffs/B4_CONSOLE_STATE_VIEW_GO.md`

## Симптом

Evolution Console различала только условно живую и неживую автоматизацию:
ответ порта мог выглядеть как работающая служба даже без `/api/state`.
Неизвестные `active_version`, последний запуск, результат и ошибка не были
видимы как отдельные факты. Действия с расписаниями можно было инициировать из
устаревшего UI-снимка, а ссылка на удалённое расписание не участвовала в
`dead_reference`.

## Причина

- Строгий сканер карточек не читал bounded localhost-контракт состояния.
- `agent_state:<automation_id>` и `agent_runs:<automation_id>` не входили в
  единую проекцию.
- `sched:__index__` в штатном скоупе не сверялся с объявленными расписаниями.
- Операционное состояние расписания и целостность его ссылки были смешаны.
- UI схлопывал `dead_reference=UNKNOWN` в благополучное `false`.
- Fail-closed проверка schedule bulk-flow существовала только в iframe, а не
  перед каждым серверным шагом.

## Результат

### Состояние автоматизации

Для установленной автоматизации проекция выдаёт ровно три состояния:

- `WORKING` — валидный `/api/state` получен и согласован с
  `agent_state:<id>`;
- `NOT_RUNNING` — валидное состояние получено, canonical `enabled=false`;
- `STATE_UNAVAILABLE` — контракт отсутствует, недоступен, невалиден или
  противоречит canonical state.

Evolution Console показывает `active_version`, `last_run`, `last_result` и
локализованный `last_error` с кодом. Любой `null`, включая
`active_version:null`, остаётся «неизвестно» / `unknown`.

История запуска берётся только из `agent_runs:<id>`. Ошибка одного KV-факта
не скрывает валидное состояние остальных автоматизаций: snapshot становится
неполным, но достоверные per-row факты сохраняются.

Действия автоматизации остаются read-only. При `STATE_UNAVAILABLE` и
`UNKNOWN` они показываются отключёнными с `STATE_REQUIRED` и двуязычным
объяснением.

### Расписания

Для каждого расписания показаны две независимые оси:

- `operational_status`: `ACTIVE`, `PAUSED`, `NO_SCHEDULE`, `UNKNOWN`;
- `reference_status`: `PRESENT`, `MISSING`, `UNKNOWN`, `NOT_APPLICABLE`.

`active:false, next_run:null` отображается как «Расписания нет» /
`No schedule`, а не как ошибка и не как работающее расписание.

Обязательная external-cron ссылка сверяется с `sched:__index__`. Валидный
пустой индекс доказывает `MISSING`; недоступный или невалидный индекс даёт
`UNKNOWN`. Внутренние расписания получают `NOT_APPLICABLE`.
`dead_reference` теперь учитывает расписания как трёхзначный факт и не
схлопывается в UI или CSV.

Проверка работает не только для трёх reviewed migrations: объявления из
`manifest.schedules` и `manifest.components.schedules` будущих
автоматизаций также входят в расчёт.

Перед **каждым** шагом существующих `schedule_pause` / `schedule_resume`
router заново читает authoritative Automation Registry. Прямой bridge-вызов,
устаревший UI payload, неизвестная установка, несопоставленная цель,
`STATE_UNAVAILABLE` и `UNKNOWN` блокируются до adapter/ledger write.

## Изменённые файлы

Runtime и проекция:

- `toolbar/plugins/scenarios/evolution-registry-scanner.py`
- `toolbar/src/core/evolution-automation-registry-provider.js`
- `toolbar/src/core/evolution-automation-registry.js`
- `toolbar/src/core/router.js`

Поверхность:

- `toolbar/plugins/scenarios/evolution-console.html`
- `toolbar/plugins/scenarios/profit-growth.json`

Приёмка:

- `toolbar/tests/agent-control-bridge.test.js`
- `toolbar/tests/evolution-automation-registry-provider.test.js`
- `toolbar/tests/evolution-automation-registry-router.test.js`
- `toolbar/tests/evolution-automation-registry.test.js`
- `toolbar/tests/evolution-console-surface.test.js`
- `toolbar/tests/evolution-console-ux-simplicity.test.js`
- `toolbar/tests/evolution-registry-scanner.test.js`
- `toolbar/tests/evolution-router-hardening.test.js`

## Живая проверка

На текущем устройстве:

- Travel: `GET 127.0.0.1:8766/api/health` → 200, версия `1.0.0`;
  `/api/state` → 200, `enabled:true`, `active_version:1.0.0`,
  локализованный `last_error.code=no_tourvisor`,
  `campaigns_birthday active:false,next_run:null`.
- Агент 1С: `GET 127.0.0.1:8792/api/health` → 200,
  версия `0.3.0-dev.6`; текущий установленный `/api/state` → 404.

Таким образом Travel проходит ветку `WORKING + NO_SCHEDULE`, а установленный
Агент 1С — ветку `STATE_UNAVAILABLE` с заблокированными действиями. Состояние
за 1С не выдумывается.

В browser-preview одновременно проверены `WORKING`, `NOT_RUNNING` и
`STATE_UNAVAILABLE`, `NO_SCHEDULE + MISSING`, три объяснённых action gate,
RU/EN-копия, отсутствие console errors и горизонтального переполнения.

## Гейты

Зелёные:

- полный toolbar suite: **187/187**, failed 0, skipped 0;
- canonical `npm run build`: PASS;
- `npm run test:reproducible`: PASS,
  SHA-256 `ff1477d47ccc1201508e530845b5bf15219c1388c38cff3d4b9b439abf939ffc`,
  `toolbar/build/toolbar.js` — 9 680 289 bytes;
- `check_brand_copy.py --strict`: `ИТОГ: БРЕНД СОБЛЮДЁН`
  (checker оставил только предупреждения на JavaScript `!`);
- `npm run test:account-scope`: PASS;
- `npm run test:managed-runtime`: PASS;
- syntax checks, Python compile и `git diff --check`: PASS;
- scanner source SHA-256:
  `8105169ded773e00e3ab383159d6b01d8b274a0f9a8a96e0c394379f25082d1d`.

Известные baseline-гейты:

- `npm run test:runtime-portability` остаётся красным на старых
  `toolbar.js`, `HANDOFF/toolbar.js`, `install-prompt.js` и release module
  list;
- `npm run test:catalog-contract` остаётся красным на существующих
  Capability Studio, Evolution standards bundle, managed-runtime и catalog
  contracts.

Оба результата воспроизведены отдельно на чистом архиве
`origin/main@c31c501`; B4 не изменяет перечисленные файлы и контракты.
`npm ci` также сообщил 1 moderate и 5 high dependency advisories; автоматические
dependency-изменения не применялись.

## Release и deploy

Версия сценария: `0.6.0`.

Owned Expert `_etb_evolution_registry_scan_v1` изменён. Интегратор обязан
доставить его точные bytes в signed Extella Client upgrade, обновить
classification/required-списки, подтвердить byte equality и SHA-256 выше,
затем повторить tests/build в чистом checkout после merge.

Прямой deploy из feature-ветки запрещён командным протоколом. Deploy выполняет
интегратор только из чистого актуального `origin/main` штатным signed
release/install путём с последующей Xtel-приёмкой.

## Откат

1. Revert merge-коммит B4 в `main`.
2. Вернуть предыдущие bytes `_etb_evolution_registry_scan_v1` через
   ownership-aware signed Client rollback.
3. Пересобрать и установить предыдущий чистый release.

B4 не меняет карточки автоматизаций, их службы, `agent_state`, `agent_runs`,
расписания, Agent Genome, Shared Genes или Evolution ledger.
