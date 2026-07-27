# Extella Evolution — Evolution MCP read contract v1.1

Статус: implementation contract для read-only slice
Текущая схема: `extella.evolution.mcp_read_contract.v1.1`
Legacy reader: `extella.evolution.mcp_registry.v1`

## 1. Продуктовая граница

Корневой объект — бизнес-автоматизация. Evolution Console показывает парк
автоматизаций и их состав. Agent Cabinet остаётся канонической проекцией одного
внутреннего агента. Gateway не создаёт новый Agent Cabinet, ledger или active
state.

Slice транспортно-нейтрален: toolbar даёт закрытый read adapter поверх
Automation Registry. Будущий `stdio` или private transport обязан подключить
тот же adapter через Desktop host IPC; самостоятельный reader с другой логикой
запрещён.

## 2. Источники и точный KV-скоуп

1. `extella.evolution.automation_registry.v1` — каноническая проекция
   установленных автоматизаций.
2. `_mkt_xtl_evolution_mcp_registry_v1` — единственный допустимый KV-ключ
   объявленной MCP-топологии.

Reader принимает от доверенного host adapter только закрытый locator:

```json
{
  "account_id": "account_demo",
  "profile_id": "default",
  "scope_agent_id": "agent_registry_owner",
  "key": "_mkt_xtl_evolution_mcp_registry_v1",
  "global": true
}
```

`scope_agent_id` становится стабильным заголовком `X-Agent-Id` при одном
`kvGet`. Текущий агент чата и параметры iframe не могут изменить этот скоуп.

Если locator отсутствует или не совпадает с текущим аккаунтом, provider делает
ноль KV-чтений и возвращает явный incomplete source с кодом
`MCP_REGISTRY_SCOPE_UNAVAILABLE`. Старый ключ
`xtl_evolution:mcp_registry:v1` не читается и fallback на него отсутствует.

MCP registry — topology registry, а не журнал версий. Он не хранит active
pointer Evolution Loop, candidate state или credential values. Writer и
provisioning в этот slice не входят.

## 3. Текущая схема registry v1.1

Схема `extella.evolution.mcp_registry.v1.1` расширяет строгую legacy-схему v1
двумя обязательными массивами.

### 3.1 MCP-объекты

| Объект | Обязательные факты |
|---|---|
| MCP Connection | `connection_id`, один consumer-form (`automation_id` или `automation_ids[]`), transport, platform ownership, scope boundary, endpoint, opaque `credential_ref`, health, provenance |
| Tool Contract | `tool_id`, connection, version, закрытые input/output schemas, risk, side effects, timeout, permissions, provenance |
| MCP Extension | `extension_id`, consumers `automation_ids`, version, hooks, package SHA-256, provenance |
| Tool Binding | `binding_id`, automation, `platform_agent_id`, tool, extensions, effective permission policy, enabled, provenance |
| Run Evidence | точные IDs automation/agent/tool/binding, timestamp, status, latency, cost и payload hashes |

Обычное подключение одной автоматизации использует только `automation_id`,
`platform_managed: false` и известный transport.

Единое платформенное подключение нескольких автоматизаций выражается только
так:

- непустой уникальный список `automation_ids[]` вместо `automation_id`;
- `platform_managed: true`;
- `scope_boundary: ACCOUNT_SHARED_PLATFORM`;
- `transport: null`, потому что транспорт платформа не раскрывает;
- `endpoint: null`;
- `credential_ref: null`;
- provenance `kind: platform_observed` без вымышленной версии и hash.

Один `connection_id` поэтому не дублируется с вымышленными суффиксами.
Gateway проецирует shared Connection в каждую явно перечисленную
автоматизацию; каждый consumer обязан иметь собственную строку
`availability`.

### 3.2 Явная доступность фактов

Каждая упомянутая автоматизация имеет ровно одну строку `availability`:

- `connections`;
- `tool_contracts`;
- `extensions`;
- `bindings`;
- `run_evidence`.

Допустимые значения:

- `OBSERVED`;
- `OBSERVED_EMPTY`;
- `PARTIAL`;
- `NOT_EXPOSED`;
- `NOT_APPLICABLE`;
- `UNAVAILABLE`;
- `UNKNOWN`.

`OBSERVED_EMPTY` — подтверждённое отсутствие записей. `NOT_APPLICABLE` —
подтверждённое отсутствие самой сущности. `PARTIAL`, `NOT_EXPOSED`,
`UNAVAILABLE` и `UNKNOWN` всегда требуют `complete: false`.
Binding с `enabled: UNKNOWN` допустим только при `bindings: PARTIAL`,
`complete: false` и affecting warning; Gateway не превращает его в
эффективный ноль.

### 3.3 Фактический доступ

`access_posture` не подменяется списком Tool Bindings. Для каждого
подтверждённого внутреннего агента он хранит:

- `scope`: `AUTOMATION_SCOPED`, `ACCOUNT_WIDE` или `UNKNOWN`;
- `policy`: `SCOPED`, `UNSCOPED` или `UNKNOWN`;
- `risk`: `LEAST_PRIVILEGE`, `EXCESSIVE` или `UNKNOWN`;
- число наблюдаемых платформенных и бизнес-инструментов;
- точные tool IDs, доказывающие `EXCESSIVE`.

Поэтому ноль Tool Bindings не означает нулевой доступ.
Для каждого внутреннего агента со state `PRESENT` current registry обязан
дать совпадающий `access_posture`. При полном Automation Registry отсутствие
такой строки в якобы полном MCP registry отклоняется; при неполном источнике
выдаётся affecting warning и `complete: false`.

## 4. Проверенный первый объект — Турагентство

Source:
`docs/EVOLUTION_MCP_TRAVEL_REGISTRY_V1_1.example.json`.

Файл является валидируемым fixture: перед provisioning
`owner_account_id: account_demo` должен быть заменён точным authenticated
account ID, а `checked_at` — временем materialization. Source live facts имеет
`version: null`, потому что `1.0.0` в исходном handoff — версия автоматизации,
а не версия набора фактов.

Проверенная проекция содержит:

- `automation_id: extella_travel_agency`;
- `platform_agent_id: agent_eUSuv3enLqKkZd2lj0aeI`;
- одну Connection `sys__all__sys_mcp_extella`;
- 48 наблюдаемых платформенных инструментов и 0 бизнес-инструментов;
- `tool_contracts: NOT_EXPOSED`;
- `extensions: NOT_APPLICABLE`;
- `bindings: NOT_APPLICABLE`;
- `run_evidence: OBSERVED_EMPTY`;
- account-wide, unscoped access с точными risk-evidence IDs.

Хеши 14 экспертов не превращены в MCP Extensions: отдельной сущности
Extension в живой системе нет, а переданный список содержит только сокращённые
hash-prefixes. Интеграции WhatsApp и Tourvisor также не превращены в MCP
Connections — их источник находится в паспорте автоматизации, а не в MCP.

## 5. Read allowlist

- `automations.list`
- `automations.get`
- `automations.get_state`
- `automations.get_composition`
- `mcp.connections.list`
- `mcp.tools.list`
- `mcp.extensions.list`
- `mcp.bindings.list`
- `runs.get_evidence`

Нет generic request, HTTP proxy, `run`, `save`, `publish`, `activate`,
`rollback` или wildcard operations. Gateway описывает Tool Contracts, но не
вызывает их.

`automations.get_composition` соединяет MCP-факты только с точным
`row.components` Automation Registry. Для `platform_agent_id` возвращаются
число effective Tool Bindings и отдельный `access_posture`; канонический Agent
Cabinet продолжает создаваться генератором стандартов.

## 6. Response envelope

Каждый ответ имеет схему `extella.evolution.mcp_read_response.v1.1` и
содержит:

- exact tool и `request_id`;
- immutable account/tenant/actor context;
- `extella.evolution.mcp_read_snapshot.v1.1`;
- snapshot SHA-256 и timestamps обоих источников;
- `complete`;
- payload `data`;
- bilingual warnings с `severity` и `affects_completeness`.

Risk-warning с `affects_completeness: false` не делает известные факты
неизвестными. Warning с `affects_completeness: true` сохраняет неполноту.
При чтении legacy registry v1 Gateway нормализует старые warning-строки
значениями `severity: warning` и `affects_completeness: true`, поэтому
response v1.1 не содержит смешанных форм.
Legacy topology остаётся видимой для совместимости, но отсутствие
`availability` и `access_posture` всегда даёт
`MCP_LEGACY_COVERAGE_UNAVAILABLE`, синтетическую coverage `UNKNOWN` и
`complete: false`; старый документ не может обойти новые инварианты
полноты.
Пагинация ограничена 100 строками, cursor обязан принадлежать текущему
snapshot.

## 7. Инварианты

- контекст проверяется до чтения, после чтения и перед ответом;
- account mismatch всегда fail-closed;
- provider делает не более одного чтения точного ключа в pinned agent scope;
- общий iframe KV bridge не может читать или записывать reserved registry key
  ни напрямую, ни через `_etb_kv_get` / `_etb_kv_set`;
- credentials представлены только opaque references;
- secret-like keys, tokens, private keys, authorization values и query
  secrets отклоняются во всём registry, JSON Schemas и response;
- duplicate IDs и dangling automation/agent references отклоняются;
- Run Evidence остаётся историческим фактом после выключения текущего
  Binding; composition скрывает выключенный Binding, но не стирает
  подтверждённый прошлый прогон;
- adapter не имеет storage, cache, write dependency или external action;
- incomplete Automation Registry и MCP registry сохраняют неполноту;
- legacy v1 остаётся строго валидируемым, но v1.1-поля в legacy запрещены.

## 8. Provisioning и следующая итерация

Trusted host должен сначала реализовать
`evolutionAdapter.getMcpRegistryLocator`, а отдельный trusted provisioner —
запись и обязательный read-back тем же locator с проверкой owner, schema и
канонического SHA-256. Успех записи без точного read-back не является
публикацией.

После расширения генератора стандартов effective Tool Bindings и фактический
access posture могут войти в Agent Genome и канонический
`extella.agent_cabinet.v1.1+` artifact. До этого Evolution Console показывает
их в составе автоматизации, не переписывая Agent Cabinet вручную.

Candidate, Evolution Lab TestRun, activation, Evolution Receipt и rollback
останутся отдельным mutation contract после durable intent, concurrency,
read-back и reconciliation.
