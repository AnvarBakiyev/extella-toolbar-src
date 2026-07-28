# Extella Evolution — masking posture в Evolution Console

Статус: handoff интегратору
Дата: 28.07.2026
Поверхность этого среза: **Evolution Console, только чтение**

## 1. Решение в одной строке

Evolution Console показывает в сводке парка честный агрегат
**N/M агентов с подтверждёнными PRE + POST**, а в раскрытом составе
автоматизации — posture каждого её агента. Console не редактирует политику:
настройка принадлежит каноническому **Agent Cabinet** конкретного агента,
а PRE/POST/REVEAL исполняются только локальным runtime.

Тумблер в интерфейсе без подтверждённых runtime-хуков не считается
защитой.

## 2. Граница поверхностей

### Evolution Console

Evolution Console:

- читает состав бизнес-автоматизации из authoritative Automation Registry;
- получает только санитизированный per-agent masking snapshot через trusted
  read adapter;
- вычисляет `N/M`, где:
  - `M` — число уникальных exact `platform_agent_id`, входящих в состав
    установленных бизнес-автоматизаций текущего снимка;
  - `N` — число этих агентов, у которых локальный runtime подтвердил
    effective PRE + POST, а не только желаемый masking state;
- показывает итоговый posture и причины неполноты;
- ведёт в канонический Agent Cabinet выбранного агента;
- не имеет writer, криптографии, прямого KV-доступа, доступа к
  `vault.key`, таблице соответствий, PIN, исходным ПДн или раскрытому
  результату.

Если состав, конфигурация или runtime evidence неполны, Console показывает
«неизвестно» / `UNKNOWN`, а не `0/M`, `OFF` или благополучное значение.
`0/0` не является допустимым доказательством.

### Agent Cabinet

Editable per-agent policy принадлежит существующему каноническому Agent
Cabinet, который генерируется из валидированного паспорта. Evolution Console
не создаёт собственный кабинет и не дублирует его форму.

Причины:

- конфигурация привязана к точному `platform_agent_id`, а не к карточке
  автоматизации;
- одна автоматизация может состоять из нескольких агентов с разными
  политиками;
- один агент может участвовать в нескольких автоматизациях;
- Agent Cabinet уже является канонической поверхностью одного агента и его
  **Agent Genome**;
- CAS, локальное подтверждение REVEAL и журнал изменения политики должны
  иметь одного владельца;
- второй editor в Console создал бы второй источник правды и возможность
  потерянного обновления.

Inherited **Shared Genes** не должны молча включать, выключать или ослаблять
per-agent masking policy. Если будущая общая политика станет Shared Gene,
изменение всё равно проходит через точный список потребителей, проверку в
**Evolution Lab**, staged activation и наблюдение в **Evolution Loop**.

## 3. Masking posture и N/M

Console вычисляет posture только из закрытого read snapshot. Точные
per-agent состояния контракта:

- `ACTIVE` — PRE и POST подтверждены как `ENFORCED`;
- `OFF` — PRE и POST подтверждены как `DISABLED`;
- `PARTIAL` — известна неполная или прототипная комбинация PRE/POST;
- `UNKNOWN` — источник или хотя бы один обязательный факт недоступен.

REVEAL, роли, аудит, версия политики и остальные ограничения передаются
отдельными безопасными posture-полями и `risk_codes`; `ACTIVE` не следует
трактовать шире подписи «PRE + POST подтверждены».

Snapshot обязан быть свежим: текущий Console-контракт принимает
`captured_at` не старше 5 минут и допускает не более 60 секунд clock skew в
будущее. Нарушение окна превращается в `SOURCE_UNAVAILABLE`/`UNKNOWN`.

`enabled: true` в сохранённом конфиге само по себе не увеличивает `N`.
Агент входит в `N` только при exact account + exact `platform_agent_id` и
подтверждённых `PRE=ENFORCED`, `POST=ENFORCED`. Готовность vault, audit,
`field_hints`, `policy_version`, REVEAL, ролей и cross-device передаётся
отдельно и не скрывается: Console показывает её как posture/risk, а Agent
Cabinet использует весь набор ниже как гейт записи `enabled=true`.

Если policy сохранена, но PRE или POST не подтверждены, Console показывает
`PARTIAL`/`UNKNOWN`, а не «PRE + POST подтверждены».

## 4. Канонический per-agent config contract

Форма из ТЗ сохраняется без расширения toolbar-полями:

```json
{
  "agent_id": "agent_...",
  "masking": {
    "enabled": true,
    "hooks": ["pre", "post"],
    "names_mode": "aggressive",
    "field_hints": {
      "иин": "iin",
      "телефон": "phone",
      "счет": "account"
    },
    "reveal_policy": "owner_only",
    "share_key_cross_device": false,
    "policy_version": "kz-v1"
  }
}
```

Обязательная validation:

- root и `masking` — closed objects, неизвестные поля отклоняются;
- `agent_id` обязателен, соответствует формату `agent_...` и exact
  существующему агенту текущего аккаунта;
- `enabled` — boolean, default для нового агента `false`;
- `hooks` — unique array с точным множеством `pre + post`; REVEAL является
  отдельным локальным действием, а не постоянным третьим hook;
- `names_mode` — только `aggressive` или `context`;
  пользовательская подпись «Строго» маппится в `context`, значение
  `strict` в runtime не передаётся;
- `field_hints` — closed map нормализованных lowercase/NFC имён полей;
  допустимые типы должны совпадать с поддержанными типами движка;
- минимальный MVP allowlist:
  `iin`, `bin`, `phone`, `email`, `iban`, `bic`, `card`, `account`,
  `name`, `address`, `org`, `number`;
- коллизия ключей после нормализации отклоняется;
- явная подсказка поля сильнее эвристики: значение из колонки «ИИН»
  маскируется как `iin`, даже если не прошло контрольную цифру;
- `reveal_policy` до появления платформенных ролей допускает только
  `owner_only`;
- `share_key_cross_device` до отдельной безопасной приёмки обязан быть
  `false`;
- `policy_version` для первого выпуска — зарегистрированное точное
  значение `kz-v1`; неизвестная версия блокирует активацию;
- runtime обязан вернуть effective config и evidence той же версии после
  записи; успешный HTTP-ответ без exact read-back не считается применением.

Ревизия/ETag для CAS является частью transport envelope, а не приведённого
domain object. Agent Cabinet отправляет ожидаемую ревизию; конфликт
возвращается как conflict и не перезаписывает более свежую policy.

## 5. Обязательные runtime-гейты

### PRE

- Исполняется локально до отправки текста, файла или извлечённого содержимого
  в модель.
- Покрывает ручной ввод и вход автоматизации.
- Не зависит от того, выбрала ли модель нужный инструмент.
- При `enabled: true` отсутствие PRE блокирует effective activation.

### POST

- Исполняется локально на общем пути результата инструмента до попадания
  результата в контекст модели.
- Прямой raw `run_expert` не может обойти POST.
- Облачная обёртка, которая сначала получает сырой результат через
  `api.extella.ai`, не удовлетворяет этому гейту.
- Служебные поля исключаются из маскирования только по закрытому allowlist;
  пути и имена файлов не считаются заведомо безопасными.
- Mapping одного Evolution Loop объединяется атомарно, а не
  перезаписывается каждым вызовом.

### Vault и persistence

- `vault.key` остаётся только в локальном runtime с минимальными правами.
- Mapping шифруется до записи, имеет integrity и атомарную замену.
- Потеря или несовместимость vault не превращается в «защищено».
- Toolbar никогда не получает ключ, PIN, соль, mapping или decrypted value.

### Audit

- Value-free journal: без ПДн, ключей, mapping и raw payload.
- Каждое событие содержит exact `account_id`, `agent_id`,
  `policy_version`, hook/action, device, timestamp, outcome и безопасные
  счётчики.
- Audit health является отдельным runtime-фактом. Ошибка записи не
  скрывается как успешный posture.
- Evolution Console читает только санитизированную агрегированную проекцию,
  не сам локальный журнал.

### Field hints

- Hints применяются в PRE и POST до общей эвристики.
- Для structured JSON используется имя поля.
- Для таблиц используется подтверждённая строка заголовков и привязка
  колонка → тип.
- Неизвестный тип, неоднозначный заголовок или невалидный config блокируют
  активацию, а не молча переключают режим.

### Policy version

- Версия конфигурации совпадает с версией реально загруженного rule pack.
- Она штампуется во все PRE/POST/REVEAL audit events.
- Console показывает несовпадение как `UNKNOWN`/attention, не как старую
  зелёную защиту.

### REVEAL

- По умолчанию возвращает локальный путь и безопасные счётчики, не raw
  текст.
- Raw раскрытие невозможно только через параметр, сформированный агентом.
- Нужны локальное одноразовое подтверждение человеком, ограниченная цель,
  короткий TTL и single use.
- Отказ, попытка и успех журналируются.
- Агент, модель и toolbar не получают `vault.key` или таблицу соответствий.

### CAS и изоляция

- Все writes из Agent Cabinet используют compare-and-swap.
- Scope содержит authenticated account и exact agent; значения из payload
  не заменяют authenticated context.
- Запрещены fallback на `agent_extella_default`, соседний агент, прошлый
  account epoch или общий безымянный KV scope.
- Смена аккаунта очищает pending reads и masking snapshot.
- Config, mapping, audit и runtime evidence изолированы как минимум по
  account + agent; job/session ID не является достаточной границей.

## 6. Запреты для toolbar и Evolution Console

В toolbar запрещено добавлять:

- криптографические примитивы или derivation ключей;
- хранение `vault.key`, PIN, соли или mapping;
- чтение/запись masking config через общий KV bridge;
- секреты, credentials или raw ПДн в iframe messages, localStorage,
  diagnostics, export JSON/CSV либо error text;
- writer masking policy;
- прямой REVEAL;
- имитацию успешной активации по одному `enabled: true`.

Разрешён только trusted read adapter с закрытой схемой, account binding,
bounded response и secret-like validation.

## 7. Роли и cross-device

Платформенных ролей «владелец / уполномоченный / аудитор / администратор»
пока нет. В Agent Cabinet следует писать **«роли на подходе»**, а
не показывать фиктивное разграничение.

Текущее `owner_only` — локальный суррогат: устройство плюс явное
подтверждение человеком. Оно не доказывает платформенную личность.

Cross-device раскрытие для MVP — `BLOCKED`:

- `share_key_cross_device` остаётся `false`;
- существующий прототип публикует зашифрованный mapping, а не безопасно
  переносит ключ;
- другое устройство всё равно должно иметь совместимый `vault.key`;
- стойкость текущей схемы зависит от жизненного цикла ключа/PIN;
- до отдельного threat model, provisioning, revoke, recovery и e2e Console
  не показывает cross-device как доступную возможность.

## 8. Текущие честные пробелы

- Автоматический PRE на общем входе агента не реализован.
- Production POST в локальном listener/tool-dispatch не реализован;
  существующие обёртки являются прототипами и допускают облачную границу.
- Per-agent config store, trusted config API и exact read-back отсутствуют.
- `field_hints` не подключены к движку.
- `policy_version` не штампуется в текущий audit.
- Текущий audit не даёт надёжной per-agent/account атрибуции и может
  fail-open.
- `reveal_policy=owner_only` не обеспечен: agent-callable
  `return_text=true` не является подтверждением владельца.
- Роли отсутствуют.
- Cross-device заблокирован.
- Существующая файловая «Псевдоанонимизация» — отдельный ручной workflow,
  а не доказательство PRE/POST на агенте.
- Наличие `vault.key` и зашифрованного mapping само по себе не доказывает
  effective protection.

Поэтому первая версия Evolution Console может честно показать много
`UNKNOWN`; это ожидаемый результат, пока runtime contract не внедрён.

## 9. Acceptance

### Contract и read-only Console

1. Closed-schema tests отклоняют неизвестные поля, неверные enum,
   дубликаты normalized hints и чужой `agent_id`.
2. В toolbar отсутствуют masking writer, direct KV и crypto/secrets.
3. `N/M` считается только по exact подтверждённому составу.
4. `M` неизвестно → `UNKNOWN`, а не `0/0`.
5. Один неизвестный агент не исчезает из знаменателя и делает агрегат
   неполным.
6. `enabled:true` без runtime evidence не входит в `N`.
7. Смена аккаунта отбрасывает запоздалый ответ прошлого epoch.
8. Export не содержит config internals, hints, audit records, paths,
   secrets или ПДн.
9. CTA ведёт в канонический Agent Cabinet, а не в копию формы.

### Runtime

10. PRE canary доказывает, что raw input не покинул локальную границу.
11. POST canary на живом инструменте доказывает, что raw output не попал в
    модель и не прошёл облачный round-trip до маскирования.
12. Попытка прямого raw `run_expert` при enabled policy блокируется или
    неизбежно проходит общий POST middleware.
13. Два POST-вызова одного job/session сохраняют оба набора токенов; старые
    токены раскрываются.
14. Одинаковый job ID у разных агентов не смешивает mapping или audit.
15. Invalid-checksum ИИН в колонке с hint `иин → iin` маскируется как ИИН в
    текстовом, JSON и табличном пути.
16. Несовпадение `policy_version` блокирует effective activation.
17. Audit-события содержат account + agent + policy version и не содержат
    canary value.
18. Неработающий audit writer даёт неуспешный runtime gate.
19. Prompt injection с `return_text=true` не раскрывает ПДн без свежего
    локального подтверждения.
20. Подтверждение имеет TTL, single use и exact job/output scope.
21. CAS с устаревшей ревизией возвращает conflict и сохраняет новую policy.
22. Cross-account и cross-agent reads/writes/reveal отклоняются.
23. `share_key_cross_device=true` отклоняется до снятия block.
24. Тесты используют временный audit/vault root и не пишут в живой
    `~/extella_wizard/anon`.

### Evolution Lab и Evolution Loop

25. Изменение policy сначала создаёт candidate и проверяется в Evolution
    Lab на синтетических canary без реальных ПДн.
26. Evolution Loop не активирует candidate без зелёных PRE/POST/vault/
    audit/reveal gates.
27. Observation показывает masking counts и residual risk без raw values.
28. Regression или потеря гейта запускают fail-closed posture и доступный
    rollback.

## 10. Rollback

### Evolution Console

- Console-срез read-only, поэтому его rollback не меняет сохранённые
  per-agent policies, mapping, vault или audit.
- Откатить toolbar на предыдущий подписанный release из чистого
  `origin/main`, повторить canonical build/install и живой smoke.
- Не удалять локальный vault, mapping, audit или runtime config при
  rollback интерфейса.
- Если trusted read adapter недоступен, оставить `UNKNOWN`; не включать
  fallback на KV или demo fixture.

### Agent Cabinet и runtime

- Policy rollback выполняется только Agent Cabinet по предыдущей
  валидированной ревизии с CAS.
- Перед rollback candidate проходит Evolution Lab.
- Evolution Loop фиксирует actor/device, from/to revision,
  `policy_version`, evidence и outcome в value-free receipt.
- Runtime возвращает previous effective state только после exact read-back
  всех обязательных гейтов.
- Rollback policy не вращает и не удаляет `vault.key` автоматически.
- Cross-device provisioning/revoke и криптомиграция являются отдельными
  операциями и не входят в UI rollback.

## 11. Интегратору

1. Сохранять этот slice read-only: N/M, posture, причины неполноты и переход
   в канонический Agent Cabinet.
2. Не добавлять тумблер или config writer в Evolution Console.
3. Сначала закрыть локальный runtime contract и trusted read adapter.
4. Затем расширить генератор Agent Cabinet точной формой конфига и CAS.
5. Проверить runtime-кандидат в Evolution Lab.
6. Провести staged Evolution Loop с observation и rollback evidence.
7. Cross-device и платформенные роли выпускать отдельными срезами после
   снятия соответствующих блокеров.
