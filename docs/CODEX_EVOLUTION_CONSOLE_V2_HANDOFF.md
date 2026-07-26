# Extella Evolution — Evolution Console v2 handoff

Дата: 2026-07-26
Toolbar branch: `codex/evolution-console-v2`
Standards branch: `codex/evolution-console-v2-standards`
Pinned standards commit: `6f3222f794d565066d72652fd3ba234f66114a3d`

## Результат

Evolution Console реализована как отдельная поверхность управления парком.
Agent Cabinet остаётся поверхностью одного агента и загружается только как
канонический артефакт `extella.agent_cabinet.v1.1`, сгенерированный из Agent
Passport. Собственного кабинета в toolbar нет.

Порядок работы соответствует ТЗ:

1. полный account-bound инвентарь парка по стабильным platform agent ID;
2. единый результат canonical `check_agent_passport.py`;
3. двунаправленная карта Shared Genes;
4. приём class-эскалации из Agent Cabinet;
5. массовые операции только с exact-target preview, confirmation, staged
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

Live Agent Passport registry не встраивается в статический toolbar. Хост должен
предоставить:

```js
ETB.evolutionStandardsProvider.loadForActor({ actorId, epoch })
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
вне статического `toolbar/`.

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

- Read-only live sanity check 2026-07-26: текущий profile вернул 15 стабильных
  agent ID; два точечных `agent/get` подтвердили доступность provider, model,
  version и полного instructions. Live writes не выполнялись.
- В репозитории нет production реализации
  `ETB.evolutionStandardsProvider`; без неё live standards/risk/Shared Genes
  fail closed как `UNKNOWN`, а мутации заблокированы.
- В репозитории нет production `ETB.evolutionAdapter`; Evolution Lab,
  activation, schedule mutations, observation и rollback заблокированы.
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

- strict pinned `npm test -w @extella/toolbar`: 103/103, без `SKIP`;
- focused Evolution core/router/surface: 34/34;
- pinned standards integration: 10/10, без `SKIP`;
- `npm run build -w @extella/toolbar`: успешно, 111 plugin definitions,
  inline-script и naming checks пройдены;
- `git diff --check` и ES5 syntax checks: успешно.

Cross-repository standards tests локально дают явный `SKIP`, если pinned
checkout недоступен. В release/CI это аварийный гейт:

```bash
EXTELLA_REQUIRE_STANDARDS=1 \
EXTELLA_STANDARDS_DIR=/clean/path/to/extella-agent-standards \
  npm test -w @extella/toolbar
```

`CI=true`, неверный `EXTELLA_STANDARDS_DIR`, несовпавший commit или SHA любого
canonical artifact завершают suite ошибкой `PINNED_STANDARDS_UNAVAILABLE`.

Полный Library build в этом worktree не запускался: зависимости TypeScript/Vite
не установлены (`tsc: command not found`). Toolbar build поэтому честно сообщает,
что Library tab будет пуст до clean dependency install/build.

Перед merge интегратор должен:

1. merge/publish standards draft PR #1, чтобы pinned commit был доступен clean CI;
2. merge toolbar branch;
3. подключить account-scoped production provider; реализовать durable native
   intent + ledger CAS, затем подключить write adapters;
4. повторить полный toolbar test/build в чистом checkout `origin/main`;
5. выполнить release sentinels из `docs/TEAM_PROTOCOL.md`;
6. deploy только из чистого интеграторского checkout.

Прямой deploy артефакта из feature worktree запрещён §§10–11
`docs/TEAM_PROTOCOL.md`.

Rollback toolbar выполняется revert этого feature commit. Standards branch
независима; до подключения provider/adapters live мутации отсутствуют.
