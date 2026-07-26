# Extella Evolution — Evolution Console v2 handoff

Дата: 2026-07-26
Toolbar branch: `codex/evolution-console-automation-mvp`
Standards branch: `codex/evolution-console-v2-standards`
Pinned standards commit: `4d8d759feeac8e27ca6fe94fb1925220406984d0`

## Решение для MVP 0.5

Анвар отменил отдельные прототипы: следующий результат должен собираться как
реальный toolbar-плагин и проверяться внутри Xtel.

Главный объект первого экрана изменён:

- было: внутренний парк platform agents текущего аккаунта;
- стало: установленные прикладные агенты на текущем устройстве — Агент 1С,
  Kazakh Lawyer, агент турагентства и следующие продукты того же класса;
- platform agents, Experts, службы, расписания и интеграции показываются как
  технический состав, а не как равноправные пользовательские карточки.

Источник установки и состава — device manifests через существующий
`ETB.registry.syncFromDevice()`. Источник runtime/lifecycle — Activity Center
`/api/services`. `_mkt_automations` не является inventory: он смешивает каталог,
неустановленные предложения и неполные записи.

До появления общего account-wide registry интерфейс обязан показывать точный
охват `Текущее устройство`. Отсутствующие last run, result, error и health
остаются `UNKNOWN`; состояние `running` само по себе не доказывает health.

MVP lifecycle управляет только одним точным ID установленного прикладного агента:

- `Запустить`/`Остановить` видны прямо в строке, но только при полном свежем
  `CURRENT_DEVICE` inventory;
- первое нажатие лишь подготавливает действие, второе создаёт точное
  `CONFIRM_START:<id>` или `CONFIRM_STOP:<id>`;
- host повторно авторизует ID через device registry + canonical normalizer,
  перечитывает `canStart`/`canStop`, выполняет ровно один POST и подтверждает
  новое состояние свежим read-back;
- control token остаётся внутри host;
- duplicate manifest ID, параллельная команда, Preview, неполный inventory и
  произвольный Activity Center service блокируются fail-closed;
- любая ошибка после начала POST — `OPERATION_OUTCOME_UNKNOWN`: UI инвалидирует
  старый снимок, обязательно перечитывает состояние и не повторяет команду
  вслепую.

Agent Cabinet остаётся канонически сгенерированной поверхностью, а не кодом
toolbar. Точный запрос интегратору на общий состав и расширение v1.1 зафиксирован
в core portal:

`extella-core-portal/docs/CODEX_AGENT_CABINET_COMMON_CONTRACT.md`

Evolution Lab принадлежит общей поверхности: Agent Cabinet инициирует изменение,
Evolution Lab изолированно сравнивает baseline/candidate, Evolution Console
принимает evidence, публикует, наблюдает и откатывает.

## Результат

Evolution Console реализована как отдельная поверхность управления парком.
Agent Cabinet остаётся поверхностью одного агента и загружается только как
канонический артефакт `extella.agent_cabinet.v1.1`, сгенерированный из Agent
Passport. Собственного кабинета в toolbar нет.

Основной и углублённый порядок работы соответствует ТЗ:

1. `CURRENT_DEVICE` inventory установленных прикладных агентов;
2. технический account-bound парк platform agents только как углублённая
   проекция состава;
3. единый результат canonical `check_agent_passport.py`;
4. двунаправленная карта Shared Genes;
5. приём class-эскалации из Agent Cabinet;
6. массовые операции только с exact-target preview, confirmation, staged
   activation, observation, Evolution Receipt и rollback.

Legacy-поверхность разделена без потери установленной Capability Studio:
одноразовая ownership-миграция сохраняет доступ к прежнему Expert, а Evolution
Console получает отдельный стабильный plugin id.

## Канонические зависимости

- Риск не пересчитывается в toolbar: production bundle обязан содержать точный
  `checker_report` от canonical `check_agent_passport.py`.
- Agent Cabinet и help widget берутся из canonical standards generator.
- Один ledger содержит immutable managed versions, class-эскалации, bulk
  operations и Evolution Receipts.
- Shared Genes строятся по полному точному списку потребителей; subset и wildcard
  запрещены.
- Agent Cabinet передаёт закрытый class-request
  `managed-agent-class-candidate.v1`. Хост повторно проверяет actor, map SHA,
  каждого агента, текущую и целевую версию Shared Gene, затем сам выводит полный
  immutable `agent-configuration-bundle.v1` по всем активным версиям ledger.
- Любая мутация перечитывает platform fleet, каждый `agent/get`, production
  standards provider, Shared Genes и ledger внутри account-bound serial section;
  несовпавший snapshot блокирует adapter и запись.
- Ledger owner запоминается для account; недоступный remembered owner блокирует
  создание второго ledger. Удаление owner как dead reference запрещено до
  проверенной миграции.
- Evolution Lab и все platform writes разрешены только через явно подключённые
  host adapters с exact read-back evidence. Toolbar не синтезирует `SUCCESS`.

Pinned DEMO_FIXTURE bundle:

`02b0c40c9fa2634ab027909cd4ef07c799ac4e79256aa4ed9596236ccf47694b`

Он используется только для Preview и не допускается в live projection.

## Production provider contract

Live Agent Passport registry не встраивается в статический toolbar. Хост
использует реализованный read-only provider:

```js
ETB.evolutionStandardsProvider.loadForActor({
  actorId,
  epoch,
  platformAgentIds
})
```

Возвращаемый bundle обязан быть:

- `data_mode=PRODUCTION`;
- `delivery_mode=ACCOUNT_SCOPED_HOST_PROVIDER`;
- связан с точным `owner_account_id`;
- построен из clean pinned standards checkout;
- content-hash attested и байт-в-байт привязан к pinned checker, builder,
  Agent Passport template, Agent Cabinet widget и help widget.

Production bundle создаётся `toolbar/tools/build_evolution_standards_bundle.py`
в режиме `PRODUCTION` с отдельными production registry/platform inputs и output
вне статического `toolbar/`. Опция `--kv-package-output` создаёт
воспроизводимый пакет из content-addressed chunks и корневого manifest.

`toolbar/tools/provision_evolution_standards.py` по умолчанию только проверяет
пакет и точный toolbar pin без сетевых записей. Режим записи требует одновременно
`--apply --confirm APPLY`, точный `--owner-account-id`, один live `--agent-id`
из предварительного `agent/list` и `--token-file`. Chunks записываются и
перечитываются до root; после root весь опубликованный bundle повторно
гидратируется, проверяется по byte length, canonical JSON, SHA-256 и owner, затем
root читается ещё раз. Неопределённый исход записи не повторяется вслепую.

Runtime provider получает точные live IDs только после `agent/list` +
`agent/get`, читает managed KV в scope этих агентов, проверяет account owner,
manifest/chunks, pinned artifacts и attestation. При отсутствии или конфликте
данных Console показывает `UNKNOWN`/`UNAVAILABLE`; DEMO_FIXTURE не подставляется.

## Host adapters и native write gate

Read-only evidence может подключаться точными методами:

- `runClassTest`;
- `observeClassChange`;
- `prepareScheduleBulkSpec`;
- `observeBulkOperation`;

Native write methods зарезервированы контрактом:

- `activateClassStage`;
- `rollbackClassChange`;
- `activateBulkStage`;
- `rollbackBulkOperation`.

Они намеренно остаются `PLATFORM_UNAVAILABLE`, даже если функция случайно
появилась в `ETB.evolutionAdapter`: до их включения платформа обязана дать
durable intent recovery и multi-device compare-and-swap для общего ledger.
Иначе native effect может завершиться раньше Evolution Receipt. Exact target
IDs и hashes/read-back всё равно проверяются в core.

## Честные границы текущей ветки

- Read-only live sanity check текущего устройства 2026-07-26 подтвердил три
  установленных прикладных агента: Агент 1С, Kazakh Lawyer и агент
  турагентства. Device registry и Activity Center читаются раздельно; live
  `start`/`stop` во время проверки не выполнялись.
- Общий health contract у трёх продуктов пока не унифицирован. Поэтому runtime
  `RUNNING` показывается отдельно, а health без собственного подтверждения
  остаётся `UNKNOWN`.
- Read-only live sanity check 2026-07-26: текущий profile вернул 15 стабильных
  agent ID; два точечных `agent/get` подтвердили доступность provider, model,
  version и полного instructions. Live writes не выполнялись.
- Production provider и безопасный provisioner реализованы, но production
  registry/package в managed KV аккаунта в рамках этой feature-ветки не
  записывались. Поэтому повторная UI-приёмка «15 live агентов + точное число
  рисков по реальным паспортам» остаётся внешним release-гейтом, а не заявляется
  выполненной по тестовым данным.
- Тест provider использует 15 точных live-shaped ID и доказывает отсутствие
  DEMO fallback; это не выдаётся за живую UI-приёмку аккаунта.
- Живая проверка паспорта 1С локально завершена; публикация результата ожидает
  отдельного privacy-reviewed cross-repository release шага. Account linkage и
  идентификатор в toolbar PR не раскрываются.
- В репозитории нет production `ETB.evolutionAdapter`; Evolution Lab,
  activation, schedule mutations, observation и rollback заблокированы.
- Lifecycle текущего устройства пока имеет только authenticated-account fence,
  но не platform RBAC. MVP допускается как single-operator deployment; для
  shared-device/multi-user Xtel отсутствие роли оператора является release
  blocker.
- Durable native intent и multi-device ledger CAS отсутствуют; native
  activation/rollback дополнительно hard-gated кодом, а не только отсутствием
  adapter.
- Ledger owner locator хранится account-bound в локальном профиле. Очистка
  профиля теряет locator; account-global locator и проверенная owner migration
  остаются обязательным platform/release gate.
- Platform RBAC, tamper-evident внешний audit store, native atomic transaction,
  стоимость фактических запусков и видимость прямых чатов не заявляются.
- Cross-account данные запрещены account binding.
- Протокольные `preflight_ui.sh` и `smoke_e2e.py` отсутствуют в этом
  репозитории; найденные копии относятся к другому продукту и не использовались.

## Проверка и выпуск

Проверено в feature worktree:

- strict pinned `npm test -w @extella/toolbar`: 150/150, failed 0,
  skipped 0;
- current-device inventory/provider/router: 24/24, включая оба lifecycle
  направления, exact target authorization, duplicate rejection, parallel lock,
  post-send outcome-unknown и fresh read-back;
- desktop и responsive 390×844 visual QA: горизонтального overflow и console
  errors нет; lifecycle в Preview и при неполном inventory явно заблокирован;
- provisioner selftest: PASS, включая wrong-account/target до первой записи,
  конфликт, post-root tamper, неполный runtime contract и pin mismatch;
- `check_brand_copy.py --strict`: PASS (предупреждения только на операторы `!`
  внутри JavaScript);
- полная сборка и `test:reproducible`: PASS, 111 plugin definitions,
  Library встроена, две последовательные feature-сборки совпали:
  SHA-256 `80acf5292d68fa81ed56797537ed4748395d03568c8f95ae8a327b6f715e0d37`,
  размер `9 434 572` байта;
- `^</script>` в `toolbar/build/toolbar.js`: 0;
- inline-script, naming, ES5 и `git diff --check`: успешно;

Cross-repository standards tests локально дают явный `SKIP`, если pinned
checkout недоступен. В release/CI это аварийный гейт:

```bash
EXTELLA_REQUIRE_STANDARDS=1 \
EXTELLA_STANDARDS_DIR=/clean/path/to/extella-agent-standards \
  npm test -w @extella/toolbar
```

`CI=true`, неверный `EXTELLA_STANDARDS_DIR`, несовпавший commit или SHA любого
canonical artifact завершают suite ошибкой `PINNED_STANDARDS_UNAVAILABLE`.

`npm ci` для проверки release-сборки сообщил 1 moderate и 5 high advisories;
автоматические dependency-изменения не применялись. Сгенерированные release-копии
не являются разрешением на deploy из feature worktree.

Перед merge интегратор должен:

1. принять общий контракт Agent Cabinet из
   `extella-core-portal/docs/CODEX_AGENT_CABINET_COMMON_CONTRACT.md` и закрепить
   следующую версию identity/components в standards;
2. проверить манифесты трёх прикладных агентов и единый runtime/health contract;
3. merge ветки `codex/evolution-console-automation-mvp` в toolbar;
4. подготовить production registry реальных паспортов аккаунта, собрать пакет,
   выполнить dry-run provisioner, затем отдельным подтверждённым release-шагом
   записать и перечитать managed KV;
5. повторить live UI-приёмку: три прикладных агента текущего устройства,
   lifecycle read-back, ≥15 внутренних platform agents в углублённой проекции и
   точное равенство risk count прямому
   canonical checker по тем же паспортам;
6. для исполняемого Evolution Lab подключить production
   `ETB.evolutionAdapter`, canonical test suites и evidence read-back; затем
   отдельно реализовать durable native intent + ledger CAS и write adapters;
7. повторить полный toolbar test/build в чистом checkout `origin/main`;
8. выполнить release sentinels из `docs/TEAM_PROTOCOL.md`;
9. deploy только из чистого интеграторского checkout.

Прямой deploy артефакта из feature worktree запрещён §§10–11
`docs/TEAM_PROTOCOL.md`.

Rollback toolbar выполняется revert этого feature commit. Standards branch
независима; до подключения provider/adapters live мутации отсутствуют.
