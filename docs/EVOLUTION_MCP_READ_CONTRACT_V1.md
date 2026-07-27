# Extella Evolution — Evolution MCP read contract v1

Статус: implementation contract для первого read-only slice
Версия схемы: `extella.evolution.mcp_read_contract.v1`

## 1. Продуктовая граница

Корневой объект — бизнес-автоматизация. Evolution Console показывает парк
автоматизаций и их состав. Agent Cabinet остаётся канонической проекцией одного
внутреннего агента. Gateway не создаёт новый Agent Cabinet, ledger или active
state.

Первый slice транспортно-нейтрален: toolbar даёт закрытый read adapter поверх
текущего Automation Registry. Отдельный `stdio` или private transport должен
подключить этот же adapter через Desktop host IPC; самостоятельный reader с
другой логикой запрещён.

## 2. Источники

1. `extella.evolution.automation_registry.v1` — существующая каноническая
   проекция установленных автоматизаций.
2. `xtl_evolution:mcp_registry:v1` — один account-global документ объявленной
   MCP-топологии, схема `extella.evolution.mcp_registry.v1`.

MCP registry — topology registry, а не журнал версий. Он не хранит активные
указатели Evolution Loop, candidate state или credential values. В этой ветке
нет writer для этого ключа.

Отсутствующий или невалидный MCP registry превращается в явный incomplete
source. Документ другого аккаунта отклоняется.

## 3. Объекты MCP registry

| Объект | Обязательные факты |
|---|---|
| MCP Connection | `connection_id`, `automation_id`, transport, endpoint, opaque `credential_ref`, health, provenance |
| Tool Contract | `tool_id`, connection, version, закрытые input/output schemas, risk, side effects, timeout, permissions, provenance |
| MCP Extension | `extension_id`, consumers `automation_ids`, version, hooks, package SHA-256, provenance |
| Tool Binding | `binding_id`, automation, `platform_agent_id`, tool, extensions, effective permission policy, enabled, provenance |
| Run Evidence | точные IDs automation/agent/tool/binding, timestamp, status, latency, cost и payload hashes |

Допустимые hooks MCP Extension v1:

- `authorize`;
- `before_call`;
- `after_call`;
- `on_error`;
- `on_timeout`.

Tool Contract связывает risk и side effects однозначно:

| `risk_class` | `side_effects` |
|---|---|
| `read` | `none` |
| `reversible_write` | `reversible` |
| `irreversible_or_external_write` | `external` |

Gateway только описывает такие Tool Contracts. Он не вызывает их.

## 4. Read allowlist

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
`rollback` или wildcard operations.

`automations.get_composition` соединяет MCP-факты только с точным
`row.components` существующего Automation Registry. Для каждого
`platform_agent_id` возвращается лишь число effective Tool Bindings и ссылка
на поверхность Agent Cabinet. Сам canonical Agent Cabinet продолжает
создаваться генератором стандартов.

## 5. Response envelope

Каждый ответ имеет схему `extella.evolution.mcp_read_response.v1` и содержит:

- exact tool и `request_id`;
- immutable account/tenant/actor context;
- `extella.evolution.mcp_read_snapshot.v1`;
- snapshot SHA-256 и timestamps обоих источников;
- `complete`;
- payload `data`;
- bilingual warnings.

Unknown и incomplete не преобразуются в пустой успех. Пагинация ограничена
100 строками, cursor обязан принадлежать текущему snapshot.

## 6. Security invariants

- контекст проверяется до чтения, после чтения и перед ответом;
- account mismatch всегда fail-closed;
- registry читает только точный global KV key;
- credentials представлены только opaque references;
- secret-like keys, tokens, private keys, authorization values и query
  secrets отклоняются во всём registry, JSON Schemas и response;
- duplicate IDs и dangling references отклоняются;
- adapter не имеет storage, cache, write dependency или external action;
- incomplete Automation Registry и MCP registry сохраняют неполноту.

## 7. Следующая совместимая итерация

После расширения генератора стандартов effective Tool Bindings могут войти в
Agent Genome и канонический `extella.agent_cabinet.v1.1+` artifact. До этого
Evolution Console показывает bindings в составе автоматизации, а Agent
Cabinet не переписывается вручную.

Candidate, Evolution Lab TestRun, activation, Evolution Receipt и rollback
будут отдельным mutation contract после durable intent, concurrency,
read-back и reconciliation.
