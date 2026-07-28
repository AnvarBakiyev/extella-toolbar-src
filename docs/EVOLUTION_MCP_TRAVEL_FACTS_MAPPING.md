# Evolution MCP — mapping живых фактов Турагентства

Дата фиксации: 27.07.2026

## Источник

- Файл интегратора:
  `/Users/anvarbakiyev/Documents/Extella/extella-core-portal/docs/handoffs/MCP_REGISTRY_FACTS_travel.md`
- SHA-256:
  `0731b0290eaead8768f3d02693f5cc7897284c356b461ee2fb7ae59d77119b7e`
- Получение: живые read-only запросы аккаунта и чтение кода, выполненные
  интегратором.

Валидируемый результат:
`docs/EVOLUTION_MCP_TRAVEL_REGISTRY_V1_1.example.json`.

Это проверяемый пример, а не готовый payload для прямой публикации:
`owner_account_id: account_demo` — fixture. Trusted provisioner обязан
materialize точный authenticated owner account и новое `checked_at`, затем
валидировать документ и сделать exact read-back. Публиковать файл без этой
подстановки запрещено.

## Что перенесено в registry

| Живой факт | Поле v1.1 |
|---|---|
| `extella_travel_agency` | `availability[].automation_id` и `connections[].automation_ids[]` |
| `agent_eUSuv3enLqKkZd2lj0aeI` | `access_posture[].platform_agent_id` |
| `sys__all__sys_mcp_extella` | одна shared Connection с `platform_managed: true` |
| 48 платформенных инструментов | `observed_tool_count: 48` |
| 0 бизнес-инструментов | `business_tool_count: 0` |
| контракты и версии не раскрыты | `tool_contracts: NOT_EXPOSED` |
| отдельной MCP Extension нет | `extensions: NOT_APPLICABLE` |
| automation-scoped bindings нет | `bindings: NOT_APPLICABLE` |
| боевых прогонов не было | `run_evidence: OBSERVED_EMPTY` |
| общий набор прав аккаунта | `scope: ACCOUNT_WIDE`, `policy: UNSCOPED` |
| подтверждённые широкие права | `risk: EXCESSIVE` и три точных tool IDs |

`complete` остаётся `false`, потому что Tool Contracts платформа наружу не
отдаёт.

Список `automation_ids[]` содержит только проверенных consumers этого
fixture. Он не утверждает, что перечисляет все 19 агентов аккаунта. При
добавлении следующей проверенной автоматизации trusted provisioner расширяет
тот же shared Connection и добавляет отдельную availability-строку, не
создавая второй `connection_id`.

## Что намеренно не перенесено

- WhatsApp и Tourvisor не объявлены MCP Connections: это integrations
  паспорта автоматизации.
- 14 экспертов `ta_*` не объявлены Tool Contracts: они вызываются через общий
  платформенный `run_expert`.
- CSPL `$extens(...)` не объявлен MCP Extension: отдельной versioned
  Extension-сущности нет.
- Сокращённые до 32 символов expert hash-prefixes не объявлены SHA-256.
- Run Evidence не синтезирован: живых прогонов нет.
- Удалённое тестовое расписание не превращено в MCP Run Evidence; его
  reference integrity остаётся фактом Automation Registry.

## Preview и production identity

Валидируемый JSON использует точный живой `platform_agent_id`.

Standalone preview Evolution Console использует
`agent_demo_fixture_valid_beta`, потому что только для этого ID в bundled
standards существует сгенерированный Agent Cabinet. Preview повторяет
семантику живых фактов (1 platform connection, 48/0 access, отсутствие
contracts/extensions/bindings/runs), но не выдаётся за production registry.

## Условие живого чтения

Reader использует только `_mkt_xtl_evolution_mcp_registry_v1` и требует
trusted locator со стабильным `scope_agent_id`. Пока host adapter не вернул
locator, provider не выполняет KV-чтение и показывает
`MCP_REGISTRY_SCOPE_UNAVAILABLE`.

Writer в этой ветке отсутствует. Публикация примера должна выполняться
отдельным trusted provisioner с exact read-back тем же account/profile/agent
scope. Root source использует `version: null`: `1.0.0` из handoff относится к
автоматизации, а не к файлу живых фактов или registry producer.
