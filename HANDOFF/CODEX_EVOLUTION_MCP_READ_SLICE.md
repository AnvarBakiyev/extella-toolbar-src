# Evolution Console — automation-first MCP read slice

Статус: сдано интегратору
Дата: 27.07.2026

## 1. Идентификация

- Ветка: `codex/evolution-mcp-read-gateway`
- База: `origin/main@e1d367ae808d06b61927ac1a0b0f7df7c972a4bd`
- Перенос простой Evolution Console v0.7: `2442ca7`
- MCP implementation: `71b8862fc65b7ecae17cc93d5a4e6c95c9ecd504`
- Версия карточки Evolution Console: `0.8.0`
- Roadmap v0.2:
  `/Users/anvarbakiyev/Documents/Codex/EXTELLA_AGENT_CONTROL_CENTER_MCP_FIRST_ROADMAP.md`

## 2. Симптом и причина

Evolution Console уже показывала парк бизнес-автоматизаций, но не имела
канонического и проверяемого способа прочитать их MCP-состав. Connection,
Tool Contract, Extension, Binding и Run Evidence могли бы появиться как
параллельная техническая админка или новый источник правды.

Причина — отсутствие закрытого MCP topology contract, account-bound provider
и тонкого read adapter поверх существующего Automation Registry.

## 3. Что сделано

- Корневым объектом оставлена бизнес-автоматизация.
- MCP-состав загружается лениво только внутри раскрытой карточки
  автоматизации.
- Agent Cabinet не переписан: Console ведёт в существующий канонический
  артефакт, созданный генератором стандартов.
- Добавлены closed schema и validation пяти объектов:
  MCP Connection, Tool Contract, MCP Extension, Tool Binding и Run Evidence.
- Добавлен provider, который читает один точный account-global ключ
  `xtl_evolution:mcp_registry:v1`.
- Добавлен тонкий read-only Gateway и одна router-операция `mcp_read`.
- Добавлены двуязычные incomplete/warning состояния и reviewed demo slice.
- Карточка поднята с `0.7.0` до `0.8.0`; capability
  `mcp_read_inventory` объявляет `external_writes: false`.
- Новый Expert не создавался.

## 4. Контракт

Источники:

- Automation Registry:
  `extella.evolution.automation_registry.v1`, `scope=CURRENT_DEVICE`;
- MCP registry: `extella.evolution.mcp_registry.v1`;
- MCP KV key: `xtl_evolution:mcp_registry:v1`.

Схемы:

- `extella.evolution.mcp_read_contract.v1`;
- `extella.evolution.mcp_read_snapshot.v1`;
- `extella.evolution.mcp_read_response.v1`.

Точный read allowlist:

- `automations.list`;
- `automations.get`;
- `automations.get_state`;
- `automations.get_composition`;
- `mcp.connections.list`;
- `mcp.tools.list`;
- `mcp.extensions.list`;
- `mcp.bindings.list`;
- `runs.get_evidence`.

Инварианты:

- страница ограничена 100 строками, cursor принадлежит текущему snapshot;
- effective Tool Binding требует `enabled === true` и component state
  `PRESENT`;
- Run Evidence возвращает hashes, а не payload;
- dangling reference при полных источниках отклоняется;
- `UNKNOWN` при неполной привязке даёт warning, скрывает неподтверждённые
  bindings/evidence и согласованно ставит
  `snapshot/data/mcp.complete: false`;
- отсутствующий или невалидный MCP registry остаётся `complete: false`, а не
  превращается в пустой успех;
- credentials допускаются только как opaque `credential_ref`;
- secret-like поля и значения, URL userinfo и secret query parameters
  отклоняются;
- Gateway не имеет writer, cache, storage, execution primitive или второго
  ledger.

Полный контракт:
`docs/EVOLUTION_MCP_READ_CONTRACT_V1.md`.

## 5. Изменённые области

Core:

- `toolbar/src/core/evolution-mcp-contract.js`;
- `toolbar/src/core/evolution-mcp-registry-provider.js`;
- `toolbar/src/core/evolution-mcp-read-gateway.js`;
- `toolbar/src/core/router.js`;
- `toolbar/build.js`.

UI и manifest:

- `toolbar/plugins/scenarios/evolution-console.html`;
- `toolbar/plugins/scenarios/profit-growth.json`.

Проверки:

- пять новых MCP test-файлов;
- четыре обновлённых regression test-файла;
- `docs/EVOLUTION_MCP_READ_CONTRACT_V1.md`.

## 6. Проверки

- `node --check` для трёх MCP core-модулей: passed.
- Focused contract/Gateway/Console tests: `26/26` passed.
- `npm test -w @extella/toolbar`: `223/223` passed,
  `0` failed, `0` skipped.
- `npm run build:toolbar`: passed, `111` plugin definitions.
- `check_brand_copy.py --strict`: бренд соблюдён.
- `npm run test:reproducible`: passed.
- `npm run test:managed-runtime`: passed.
- `git diff --check`: passed.
- Финальный независимый adversarial audit: PASS, замечаний P0–P2 нет.
- Диагностический `toolbar/build/toolbar.js`:
  SHA-256
  `dee8c70275b0aaa147f7ef9ccdb48e2f0f303c90e4c6add4305bc404585d3e01`,
  `8,784,058` bytes.

Честные оговорки по гейтам:

- `npm run test:account-scope` останавливается на существующем, не изменённом
  этой веткой `HANDOFF/toolbar.js: agent_extella_default`.
- Dev build предупреждает, что `modules/library/dist/index.html` отсутствует.
  Его hash приведён для воспроизводимости разработки, это не release artifact.
- Указанные в командном протоколе `preflight_ui.sh` и `smoke_e2e.py` в этом
  toolbar-репозитории отсутствуют, поэтому их прохождение не заявляется.

## 7. Browser QA

Проверено в wide viewport и при `390×844`:

- MCP загружается лениво внутри карточки автоматизации;
- Travel Agency открывает существующий generated Agent Cabinet;
- после закрытия фокус возвращается на кнопку Cabinet;
- page-level horizontal overflow отсутствует;
- Cabinet использует собственный горизонтальный контейнер;
- reviewed demo IDs совпадают с canonical generated Cabinet IDs.

## 8. Что сознательно не входит

- Writer для `xtl_evolution:mcp_registry:v1`: до trusted provisioning live UI
  честно показывает incomplete/unknown.
- Реальный `stdio` или private transport: сейчас adapter доступен через
  Desktop toolbar bridge; будущий host IPC обязан переиспользовать его.
- Отдельная tenant identity: текущий host использует одно значение как
  `actor_id`, `account_id` и `tenant_id`.
- Tool Bindings в schema/generator Agent Cabinet: Console пока показывает
  counts и ссылку на канонический Cabinet.
- MCP execution, candidates, mutations, Evolution Lab TestRun, activation,
  Evolution Receipt и rollback mutation.
- Demo fixture не является доказательством production MCP topology.

Этот slice закрывает первый read-only этап, а не весь roadmap Extella
Evolution.

## 9. Интегратору

1. Брать полной единицей `2442ca7` и `71b8862`: build order, Core, router,
   UI, manifest, tests и contract. Не переносить только UI или только тесты.
2. Merge выполняет только интегратор.
3. После merge пересобрать из чистого checkout актуального `origin/main`.
4. Повторить полный suite, strict brand и release gates; проверить
   `^</script>` = 0, число плагинов и release sentinels.
5. Установить только подписанным штатным путём и провести живую приёмку в
   Xtel.
6. Trusted provisioning MCP registry и расширение генератора Agent Cabinet
   оформить отдельными задачами.

Ветка не деплоилась: командный протокол запрещает release и toolbar override
из feature-worktree.

## 10. Откат

- До merge: не сливать ветку.
- После merge: revert merge-коммита; при выборочном переносе откатить оба
  коммита `71b8862` и `2442ca7`.
- Пересобрать предыдущий подписанный release из чистого `origin/main` и
  установить штатным путём.
- Data rollback не требуется: ветка не пишет и не мигрирует registry.
