# Ответ интегратору — Evolution Console, круг 2 (06.08.2026)

Принял `ANSWER_EVOLUTION_CONSOLE_06-08_ROUND2.md`. Поправка `state_reader.params`
интегрирована без исключений по продуктам.

## 1. Expert-based state reader — реализован

- Все шесть Automation Passports закреплены по новым commit и SHA-256.
- Травел теперь читает `trv_call` с `route: /x/status` и `body_json: "{}"`.
- Вызов строится **только** из `state_reader.expert` и точного объекта
  `state_reader.params`; `method` остаётся подписью для человека.
- Исполнение закрепляется `targets: [execution_device]`. Одиночный `target` передаётся
  только для совместимости старого Desktop и не считается доказательством.
- Ответы Expert разворачиваются только через известные конверты `res`, `result`,
  `output`. Произвольный поиск по вложенным полям запрещён.
- В Console передаётся только безопасный факт чтения: automation id, объявленная схема,
  точное устройство, data device и форма ответа. Значения продуктового состояния наружу
  не проходят.
- Шесть продуктовых схем не превращаются в `WORKING`: пока нет
  `extella.automation_state.v1`, операционное состояние остаётся `UNKNOWN` и действия
  остаются закрыты.

Контракт источников поднят до
`extella.evolution.automation-registry-sources.v4`, версия поверхности — `0.15.0`.

## 2. Trusted publish: аксессор доказательств — готов

Точное имя:

```js
ETB.agentControl.resolveTrustedPublishEvidence(ledger, request)
```

Аксессор читает уже гидратированный канонический ledger и проверяет одновременно:

- SHA-256 всего ledger равен `request.ledger_sha256`;
- черновик существует, остаётся `DRAFT` и затрагивает точного `agent_id`;
- активная версия агента равна `expected_version`;
- `IMPACT_ANALYZED` имеет детерминированный вид
  `impact:<draft_id>:<draft_sha256>`;
- `PLAYGROUND_GREEN` — точный `testRun.id`, статус `PASSED`, все assertions зелёные,
  draft/candidate/hash совпадают;
- `ROLLBACK_AVAILABLE` — точный immutable published version id, он активен и содержит
  снимок этого агента.

Форма успешного ответа аксессора:

```json
{
  "draftId": "draft_…",
  "draftSha256": "<hex64>",
  "agentId": "agent_…",
  "impactId": "impact:draft_…:<hex64>",
  "runId": "testrun_…",
  "rollbackRef": "cfg_…",
  "versionBefore": "cfg_…",
  "candidateVersionId": "cfg_…",
  "candidateBundleSha256": "<hex64>"
}
```

Любое расхождение даёт `TRUSTED_PUBLISH_EVIDENCE_INVALID`; булевы гейты не
принимаются.

## 3. Два оставшихся входа нельзя заполнять догадкой

### Payload платформенной записи

В текущем коде нет общего безопасного `agent/update` контракта. Единственный узкий
writer — `ETB.api.agentToolsUpdateScoped(agentId, tools)`. Текущий draft меняет
версионированный business rule внутри Agent Control bundle; он не содержит полного
текста инструкций и не является patch для модели, tools или других полей агента.

Поэтому корректный payload сейчас — **не определён**. Нельзя превращать preview/hash
из inventory в инструкции или молча публиковать только `tools`: это изменит смысл
черновика. Нужен отдельный закрытый `extella.agent_patch.v1` от платформы с:

1. allowlist реально writable полей;
2. точной схемой `agent/get` до/после;
3. правилом вычисления `version_before` и `version_after` из перечитанного объекта.

До этого `publishTrustedDraft` должен оставаться отсутствующим, а кнопка — скрытой.

### Идемпотентность на 24 часа

Текущий sharded Agent Control KV переживает перезапуск, но платформа не даёт
compare-and-swap для двух устройств. Browser queue защищает только от двойного клика в
одном toolbar и не является durable boundary. Запись обычного KV-ключа даст гонку
`read → оба не нашли → две записи`.

Значит production-контракт идемпотентности должен находиться **в host action**, где
атомарно резервируется `(owner_account_id, idempotency_key)` и хранится request hash,
состояние intent/outcome и прежняя квитанция не меньше 24 часов. Если атомарной
резервации у host нет, адаптер нельзя объявлять готовым.

## 4. Проверка

- полный `npm test`: 336/336 после добавления evidence accessor;
- reader проверен на точных params, `targets[]`, трёх конвертах ответа и отсутствии
  продвижения продуктовой схемы в canonical state;
- `READ_BACK_CONFIRMED` остаётся только результатом host после `agent/get`.

Итого: вход №1 для host-адаптера закрыт точным аксессором. Для входов №2 и №3 нужен
реальный платформенный контракт; Console не будет изображать их готовыми.
