# Extella Evolution — Evolution Console v2 handoff

Дата: 2026-07-26
Toolbar branch: `codex/evolution-console-v2`
Standards branch: `codex/evolution-console-v2-standards`
Pinned standards commit: `4d8d759feeac8e27ca6fe94fb1925220406984d0`

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

- strict pinned `npm test -w @extella/toolbar`: 115/115, failed 0,
  skipped 0;
- pinned standards adapter: 11/11, failed 0, skipped 0;
- provider/router: 8/8, включая 15 live-shaped IDs, failed 0, skipped 0;
- provisioner selftest: PASS, включая wrong-account/target до первой записи,
  конфликт, post-root tamper, неполный runtime contract и pin mismatch;
- `check_brand_copy.py --strict`: PASS (предупреждения только на операторы `!`
  внутри JavaScript);
- полная сборка и `test:reproducible`: PASS, 111 plugin definitions,
  Library встроена, три проверенных артефакта совпали:
  SHA-256 `5756c7a30dcd4e510c30799d59434a42928cdd2fac237f0fd5e629b637ee0716`,
  размер `9 078 218` байт;
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

1. merge/publish standards draft PR #1, чтобы pinned commit был доступен clean CI;
2. merge toolbar PR #2;
3. подготовить production registry реальных паспортов аккаунта, собрать пакет,
   выполнить dry-run provisioner, затем отдельным подтверждённым release-шагом
   записать и перечитать managed KV;
4. повторить live UI-приёмку: ≥15 агентов и точное равенство risk count прямому
   canonical checker по тем же паспортам;
5. реализовать durable native intent + ledger CAS, затем отдельно подключить
   write adapters;
6. повторить полный toolbar test/build в чистом checkout `origin/main`;
7. выполнить release sentinels из `docs/TEAM_PROTOCOL.md`;
8. deploy только из чистого интеграторского checkout.

Прямой deploy артефакта из feature worktree запрещён §§10–11
`docs/TEAM_PROTOCOL.md`.

Rollback toolbar выполняется revert этого feature commit. Standards branch
независима; до подключения provider/adapters live мутации отсутствуют.
