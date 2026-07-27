# Evolution Console — automation-first MCP read slice

Статус: сдано интегратору
Дата: 27.07.2026

## 1. Идентификация

- Ветка: `codex/evolution-mcp-read-gateway`
- База: `origin/main@e1d367ae808d06b61927ac1a0b0f7df7c972a4bd`
- Перенос простой Evolution Console v0.7: `2442ca7`
- MCP implementation: `71b8862fc65b7ecae17cc93d5a4e6c95c9ecd504`
- Handoff первого read slice: `f553c77`
- Live Travel facts + MCP contract v1.1 hardening:
  `7fce44d`
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
- Добавлен provider, который читает единственный operational KV-ключ
  `_mkt_xtl_evolution_mcp_registry_v1` только по закрытому trusted locator с
  точным account/profile/agent scope.
- Добавлен тонкий read-only Gateway и одна router-операция `mcp_read`.
- Добавлены двуязычные availability/access/incomplete состояния и reviewed
  Travel slice без вымышленных бизнес-инструментов, Extensions, Bindings и
  прогонов.
- Единая account-shared platform Connection моделируется один раз с
  `automation_ids[]`, а не копируется с вымышленными ID.
- Legacy registry v1 читается, но без coverage никогда не получает
  `complete: true`.
- Исторический Run Evidence не исчезает после выключения текущего Binding.
- Reserved registry key закрыт от общих iframe bridges как через прямой KV,
  так и через `_etb_kv_get` / `_etb_kv_set`.
- Карточка поднята с `0.7.0` до `0.8.0`; capability
  `mcp_read_inventory` объявляет `external_writes: false`.
- Новый Expert не создавался.

## 4. Контракт

Источники:

- Automation Registry:
  `extella.evolution.automation_registry.v1`, `scope=CURRENT_DEVICE`;
- current MCP registry: `extella.evolution.mcp_registry.v1.1`;
- strict legacy input: `extella.evolution.mcp_registry.v1`;
- MCP KV key: `_mkt_xtl_evolution_mcp_registry_v1`.

Схемы:

- `extella.evolution.mcp_read_contract.v1.1`;
- `extella.evolution.mcp_read_snapshot.v1.1`;
- `extella.evolution.mcp_read_response.v1.1`.

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
- `enabled: UNKNOWN` требует `bindings: PARTIAL`, affecting warning и
  `complete: false`;
- для каждого внутреннего агента `PRESENT` current registry обязан дать
  точный `access_posture`; ноль Bindings не считается нулём доступа;
- Run Evidence возвращает hashes, а не payload;
- выключенный current Binding скрывается из effective Bindings, но его
  проверенный исторический Run Evidence сохраняется;
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

Live source:

- `automation_id: extella_travel_agency`;
- `platform_agent_id: agent_eUSuv3enLqKkZd2lj0aeI`;
- source SHA-256:
  `0731b0290eaead8768f3d02693f5cc7897284c356b461ee2fb7ae59d77119b7e`;
- 1 shared platform Connection, 48 наблюдаемых platform tools, 0 business
  tools;
- Tool Contracts не раскрыты; MCP Extensions и automation-scoped Bindings не
  существуют; production Run Evidence отсутствует;
- exact excessive-access evidence:
  `agent_delete_mcp_extella`, `profile_delete_mcp_extella`,
  `token_generate_mcp_extella`.

Fixture
`docs/EVOLUTION_MCP_TRAVEL_REGISTRY_V1_1.example.json` намеренно содержит
`owner_account_id: account_demo`: trusted provisioner обязан materialize
authenticated owner и новое `checked_at`, затем выполнить exact read-back.

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

- `node --check` для contract, provider, Gateway, router, marketplace и
  install prompt: passed.
- `npm test -w @extella/toolbar`: `247/247` passed,
  `0` failed, `0` skipped.
- `npm run build:toolbar`: passed, `111` plugin definitions.
- `check_brand_copy.py --strict`: бренд соблюдён.
- `npm run test:reproducible`: passed,
  `cfff4d8325c519df38831ff76d029fb4cba87ffe73de59a504b14fe3046b33e0`.
- `npm run test:managed-runtime`: passed.
- `git diff --check`: passed.
- Финальный независимый adversarial audit: PASS, замечаний P0–P2 нет.
- Диагностический `toolbar/build/toolbar.js`:
  SHA-256
  `cfff4d8325c519df38831ff76d029fb4cba87ffe73de59a504b14fe3046b33e0`,
  `8,853,738` bytes.

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

- Writer для `_mkt_xtl_evolution_mcp_registry_v1`: до trusted provisioning
  live UI
  честно показывает incomplete/unknown.
- Trusted `evolutionAdapter.getMcpRegistryLocator`: без него provider делает
  ноль KV-чтений и возвращает `MCP_REGISTRY_SCOPE_UNAVAILABLE`.
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

1. Брать ветку полной единицей до `7fce44d`: `2442ca7`, `71b8862`,
   `f553c77`, `7fce44d` плюс следующий handoff-коммит. Не переносить только UI,
   fixture или тесты.
2. Merge выполняет только интегратор.
3. После merge пересобрать из чистого checkout актуального `origin/main`.
4. Повторить полный suite, strict brand и release gates; проверить
   `^</script>` = 0, число плагинов и release sentinels.
5. Установить только подписанным штатным путём и провести живую приёмку в
   Xtel.
6. Отдельно реализовать trusted locator adapter и provisioner с exact
   read-back; затем провести живую проверку Travel registry в Xtel.
7. Расширение генератора Agent Cabinet для access posture/Bindings оформить
   отдельной задачей стандартов.

Ветка не деплоилась: командный протокол запрещает release и toolbar override
из feature-worktree.

## 10. Откат

- До merge: не сливать ветку.
- После merge: revert merge-коммита; при выборочном переносе откатить
  `7fce44d`, `71b8862` и `2442ca7` вместе с их handoff-коммитами.
- Пересобрать предыдущий подписанный release из чистого `origin/main` и
  установить штатным путём.
- Data rollback не требуется: ветка не пишет и не мигрирует registry.
