# Handoff: Центр управления агентами — первый вертикальный срез

Дата: 25.07.2026
Сессия: Codex
Репозиторий: `extella-toolbar-src`
Ветка: `codex/agent-control-center-vertical-slice`
База: `origin/main` @ `e6946247654f3568a95a1824e663843a9822eccf`
Статус: готово к ревью и интеграции; deploy/release не выполнялся

## Симптом и причина

Существующая «Студия способностей» была полезным каталогом 30 подтверждённых
возможностей и двух экспериментов, но не имела рабочего control-plane:

- не фиксировала действующую конфигурацию агентов как версию;
- не связывала draft, TestRun, publish, run receipt и rollback точными SHA-256;
- не обеспечивала account-bound хранение и неизменяемость evidence;
- не отделяла managed-гарантии от отсутствующих native-гарантий платформы.

Вертикальный срез добавляет управляемый ledger поверх штатных read-only Agent,
Concepts, Rules, Experts и scoped KV API. Он не выдаёт этот adapter за native
versioning Extella.

## Что действительно реализовано

### Пользовательский путь

1. Реестр показывает только строго подтверждённых `provider=Alibaba` +
   `model=Qwen` агентов; Claude/Anthropic исключаются.
2. Для выбранных двух агентов host повторно проверяет точный ID,
   provider и model через `/api/agent/get`.
3. Baseline V1 включает Agent snapshot, agent-local и account-global Concepts
   и Rules, видимые Experts, counts, bounded redacted previews и полные hashes.
4. Общее правило о марже `< 20%` сначала сохраняется как draft.
5. Scope поддерживает одного агента и выбранную группу. Organization scope
   виден, но заблокирован до появления native registry/RBAC.
6. Impact выводится из scope и managed dependency graph, а не из mutable UI:
   два Agent ID, процессы, capability и все declared consumers.
7. Полигон выполняет кейсы 18%, 20% и 30% без Agent/Expert-вызова и без внешних
   записей. Для каждого кейса проверяются exact firing, diff, запрещённое
   действие, candidate/base version binding и `writeAttempts=0`.
8. Publish требует точный неизменившийся draft и `PASSED` TestRun с
   семантическими assertions и проверенным receipt hash.
9. Один root pointer commit переключает управляемую конфигурацию обоих агентов.
10. Managed policy evaluations создают отдельные receipts с actor/time,
    version ID/hash, fired Rules, used/available Knowledge, planned actions и
    нулевыми writes.
11. Rollback возвращает точный immutable V1 ID/hash без создания копии.
12. После rollback повторная публикация идентичного V2 переиспользует исходный
    V2 byte-for-byte и не меняет его metadata.

### Надёжность и безопасность

- Новый pure core: canonical JSON, WebCrypto SHA-256, immutable versions,
  derived impact, TestRun receipts, publish, active evaluations и rollback.
- Tokenless iframe остаётся sandboxed как `allow-scripts` без
  `allow-same-origin`; CSP запрещает сеть. Extella API token не передаётся.
- Все Extella вызовы выполняет ограниченный host bridge
  `etb_agent_control`.
- Ledger привязан одновременно к authenticated account ID и owner Agent ID.
- Session epoch и host deadline останавливают поздние операции при смене
  аккаунта. UI очищает ledger/previews по `ledger:null`,
  `etb_account_reset` и каждому новому `etb_init`.
- После timeout UI показывает `OUTCOME UNKNOWN` и блокирует повторную мутацию
  до явной перезагрузки ledger.
- Versions, drafts, TestRuns, managed-run receipts и полный ledger state
  записываются в content-bound immutable KV shards с read-before-write,
  canonical read-back и SHA-256.
- Маленький root index содержит только account/owner, active pointers и
  verified ledger-state ref. После 20 receipts он остаётся меньше 13 KB.
- Сбой последней root-записи оставляет прежний ledger читаемым; новые shards
  остаются неактивными и не повреждают старый head.
- KV `HTTP 500 + Key not found` распознаётся как отсутствие только по полям
  ошибки, но не по пользовательскому `value`. Пустой successful value считается
  повреждением, а не отсутствием.
- Preview-данные проходят bounded redaction очевидных секретов, email и
  телефонов; полный content сохраняется только как SHA-256.

### Сохранённое из старой Студии

- Каталог ровно 30 подтверждённых capabilities.
- Детерминированный Expert расчёта прибыльности.
- Полигон «Прибыльный рост».
- Эксперимент «Командная память» с временными global Concept/Rule и
  подтверждённым cleanup.

Они перенесены в разделы «Способности» и «Расширенные доказательства», а не
удалены.

## Что является экспериментальным

- `?preview=1` — явно маркированный `DEMO · IN-MEMORY`; он ничего не читает и
  не пишет в Extella.
- Публикация и version binding действуют только для managed policy evaluator
  этого Control Center.
- `profitability_gate` — deterministic managed policy, получающая
  caller-supplied `marginBps`. Она не является Expert и не запускает Agent.
- Старые governance-лаборатории остаются экспериментами и отделены от
  production-контура.

## Платформенные блокеры и требования технической команде Extella

1. **Native bundle versioning отсутствует.** Нужен платформенный объект
   AgentConfigurationVersion и обязательный version/hash во всех обычных
   `agent/run`.
2. **Native atomic publish/CAS отсутствует.** Текущий managed root commit имеет
   verified read-back, но не защищён от гонки двух устройств.
3. **Native Rules conflict evaluator отсутствует.** Local/global Rules
   инвентаризируются и хешируются, но evaluator исполняет только isolated
   managed policy. UI показывает
   `MANAGED_POLICY_ONLY_NATIVE_RULES_NOT_EVALUATED`.
4. **Organization registry и RBAC отсутствуют.** Organization scope намеренно
   disabled; нельзя честно доказать полный состав или право публикации.
5. **Audit не tamper-evident.** KV read-back и content hashes ловят
   несогласованность, но нужен подписанный append-only audit/WORM.
6. **Только default profile.** Нужны явные profile IDs и API completeness
   contract для effective local + account-global конфигурации.
7. **Dependency graph пока managed-declared.** Нужен native graph
   Expert/handler → реальные consumers. UI не утверждает, что Expert был
   вызван.
8. **Privacy redaction эвристическая.** Для enterprise нужны штатный Privacy
   Gateway/classifier и policy для разрешённых metadata.
9. **Нужен KV transaction/idempotency contract.** Operation ID и deadline
   уже передаются внутри adapter, но платформа должна поддержать server-side
   idempotency и reconcile API.
10. **Overview telemetry не подключена.** Costs, native run errors и health
    должны поступать из платформенного run registry; сейчас UI не выдумывает
    эти показатели.

## Доказательство acceptance-сценария

| Критерий | Доказательство |
|---|---|
| Два агента до изменения | Live read-only registry: 15 агентов, 10 strict Alibaba/Qwen; два `/agent/get` вернули точные requested IDs |
| Исходная конфигурация | Immutable V1 + SHA-256 + per-agent active pointers |
| Общее правило | Draft содержит exact `< 2000 bps` Rule и `profitability_gate` |
| До publish агенты не изменены | Draft/TestRun не меняют `activeVersionByAgent`; UI показывает ACTIVE V1 |
| Impact = два агента | Derived impact test и browser proof показывают ровно два Agent ID |
| Без внешних записей | 18/20/30 TestRun: `externalWrites=[]`, `writeAttempts=0`, Expert/Agent not invoked |
| Видна V1/V2 разница | При 18% actions меняются у обоих; при 20% и 30% не меняются |
| После publish активна V2 | Оба managed pointers указывают на один exact V2 ID/hash |
| Версия в каждом запуске | Два managed receipts содержат `configurationVersionId` и SHA-256 |
| Точный rollback | `VERIFIED EXACT`, исходный V1 ID/hash, `copyCreated=false` |
| Локальная изоляция | Per-agent local Rule/Knowledge IDs остаются в своих inventories и available lists |
| Shared consumers | `profitability_gate` показывает оба declared consumer Agent ID |
| Нет токена в UI | Tokenless sandbox/CSP/bridge tests |
| Ошибки не маскируются | Deadline/account fences, explicit `OUTCOME UNKNOWN`, fail-closed hashes/read-back |
| Старая Studio сохранена | 30/30 catalog contract + два старых эксперимента |

## Изменённые файлы

- `toolbar/src/core/agent-control.js` — новый deterministic control-plane core.
- `toolbar/src/core/router.js` — tokenless bridge, real inventory reads,
  account fencing, sharded verified ledger, managed actions.
- `toolbar/src/core/api.js` — scoped Agent/Experts reads и owner-Agent KV headers.
- `toolbar/build.js` — загрузка core сразу после API.
- `toolbar/plugins/scenarios/profit-growth.html` — новый Agent Control Center UI,
  preview Полигон и сохранённые evidence-поверхности.
- `toolbar/plugins/scenarios/profit-growth.json` — новое продуктовое описание и
  managed capabilities при стабильном plugin ID.
- `toolbar/public/plugins_manager.html` — новое имя/описание карточки.
- `toolbar/tests/agent-control-center.test.js` — core acceptance и adversarial
  tests.
- `toolbar/tests/agent-control-bridge.test.js` — bridge/storage/account/identity
  tests.
- `toolbar/tests/profit-growth-scenario.test.js` — UI/manifest/legacy evidence
  contract.
- `docs/CODEX_AGENT_CONTROL_CENTER_HANDOFF.md` — этот отчёт.

## Проверки

Успешно:

- `cd toolbar && npm test` — 57/57, полный toolbar suite зелёный.
- `npm run build` — Library + Toolbar production build зелёный.
- `npm run test:reproducible` — passed; SHA-256
  `1b3fe4c0f1afb01c46ab5934b85c650338138737b2f1cfc7697e7653b8c81cd8`.
- `node --check toolbar/src/core/agent-control.js`.
- `node --check toolbar/src/core/router.js`.
- Inline HTML script syntax, 117 unique DOM IDs, exactly 30 legacy
  capabilities.
- Browser preview: V1 → draft → impact → GREEN 18/20/30 → publish V2 →
  two version-bound receipts → exact rollback V1 → новый draft снова доступен.
- Build artifact sentinels: `hasSnapshot=2`, `onlyKnown=3`,
  root `^</script>=0`.
- Read-only live registry: 15 агентов, 10 strict Alibaba/Qwen; два
  `/agent/get` ответа `200`, returned ID совпал с requested ID.
- Secret-pattern scan по изменённым source/UI/test/handoff файлам — совпадений
  не найдено.
- `git diff --check`.

Repo-wide legacy gates, не относящиеся к этой feature-ветке, остаются красными
на исходной базе `e694624`:

- `test:account-scope` — семь существующих hardcoded default-agent findings.
- `test:runtime-portability` — существующие installer/runtime findings в
  generated/legacy toolbar.
- `test:catalog-contract` — девять существующих managed-runtime/catalog
  findings.
- `test:managed-runtime` — отсутствует legacy
  `toolbar/plugins/extella_adoption_wizard.json`.

`preflight_ui.sh` и `smoke_e2e.py` отсутствуют в этом toolbar-репозитории;
их копии из другого Wizard worktree не запускались против несвязанного проекта.

## Инструкция интегратору

1. Просмотреть branch diff и этот handoff; не брать локальный build artifact как
   release source.
2. Влить ветку в свежий `origin/main` через обычный review/merge.
3. В чистом clone нового `origin/main` повторить:
   `cd toolbar && npm test`, `npm run build`, `npm run test:reproducible`.
4. На тестовом аккаунте открыть Control Center, выбрать два strict
   Alibaba/Qwen агента и повторить основной путь. Live mutation acceptance
   отдельно подтвердить до релиза.
5. Release artifact собирать только из чистого clone `origin/main` командой
   `node toolbar/build.js --release-artifacts`.
6. Перед deploy проверить sentinels `hasSnapshot`, `onlyKnown`,
   `grep -c '^</script>' == 0` и secret scan.
7. Только после этого интегратор обновляет signed package/install-all/runtime.

## Откат

- До интеграции: удалить worktree/ветку или не сливать её.
- После merge: `git revert` merge/feature commit и пересобрать signed artifact
  из чистого `origin/main`.
- Managed KV использует namespace
  `xtl_agent_control:profitability_governance_v1` внутри owner Agent scope.
  Старый toolbar его игнорирует; данные не требуют разрушительной очистки для
  отката интерфейса.
