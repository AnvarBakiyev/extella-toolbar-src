# Evolution Console — внутренний экран управления изменениями агентов

Статус: готово в ветке `codex/agent-control-center-screen`, только чтение.

Основание: `docs/handoffs/HANDOFF_EVOLUTION_CONSOLE_AGENT_CONTROL.md`
от 29.07.2026. Старое `TZ_AGENT_CONTROL_CENTER_SCREEN.md` не применяется.

## Что сделано

- В **Evolution Console** добавлен один расширенный внутренний раздел
  «Управление изменениями» / “Change management”. Это не отдельный продукт и
  не новая системная карточка.
- Старый `etb_agent_control` не возрождён. Экран использует только
  tokenless bridge `etb_evolution_console` и единственное действие
  `agent_control_load`.
- В bridge нет writer-а, KV-вызовов, публикации, создания агентов, отдельного
  журнала или редактора защиты данных. Поле `mutations_allowed` всегда
  `false`.
- Добавлен строгий нормализатор `cabinet.agent_control` из канонического
  сгенерированного **Agent Cabinet**:
  закрытые поля, шесть операций в порядке движка, четыре publication gate и
  четыре границы; RU/EN-текст без HTML и управляющих символов.
- Экран ничего не придумывает: шаги, зависимости, publication gate и
  границы рендерятся из нормализованного Agent Passport. Зависимости показаны
  локализованными названиями операций, а не техническими кодами.

## Контракт read-only проекции

`agent_control_load` принимает только текущий account-bound fleet snapshot.
Источник — лишь уже проверенный и аттестованный
`session.standardsBundle`, полученный при `fleet_load`; iframe не может
подложить bundle, Passport или Cabinet.

```json
{
  "schema": "extella.evolution.agent_control_surface.v1",
  "owner_account_id": "<current account>",
  "fleet_snapshot_id": "<current snapshot>",
  "captured_at": "<ISO-8601>",
  "status": "AVAILABLE | STANDARDS_UNAVAILABLE | NO_AGENT_PASSPORTS | CONTRACT_UNAVAILABLE | CONTRACT_MISMATCH | UNKNOWN",
  "agent_passport_count": "integer | null",
  "contract": "cabinet.agent_control | null",
  "mutations_allowed": false,
  "error_code": "UPPER_SNAKE_CASE | null"
}
```

Честные состояния:

| Состояние | `agent_passport_count` | Смысл |
| --- | --- | --- |
| `STANDARDS_UNAVAILABLE` | `null` | bundle отсутствует, не прошёл аттестацию или недоступен; это не ноль паспортов |
| `NO_AGENT_PASSPORTS` | `0` | только подтверждённый `sources.passports: []` |
| `CONTRACT_UNAVAILABLE` | `> 0` | есть source Passport, но нет live-ready Cabinet либо его контракт невалиден |
| `CONTRACT_MISMATCH` | `> 0` | live-ready Agent Cabinets содержат разные допустимые контракты |
| `UNKNOWN` | `null` | источники не позволяют утверждать даже число паспортов |
| `AVAILABLE` | `> 0` | все candidate Cabinet-контракты совпали и прошли строгую нормализацию |

Во всех состояниях, кроме `AVAILABLE`, `contract` равен `null`. Во всех
состояниях действия закрыты.

## Что нужно от интегратора

1. Выдать account-scoped attested standards bundle по согласованному
   manifest-контракту и owner из `/api/token/validate`.
2. Первым допустимым результатом будет честный bundle с
   `sources.passports: []`: экран автоматически покажет «Agent Passports ещё
   не заполнены», а не ошибку.
3. По мере заполнения Agent Passports включать в каждый valid generated
   `extella.agent_cabinet.v1.1` блок `cabinet.agent_control`. После следующего
   `fleet_load` экран сам начнёт показывать канонический путь — новый UI или
   миграция в toolbar не нужны.
4. Отдельно согласовать один trusted publication action. Его в этом срезе нет
   намеренно: он должен применить те же четыре gate и read-back, что показывает
   canonical Cabinet contract.

## Не входит в этот срез

- добавление Evolution Console в системные карточки / на рабочий стол;
- возвращение или расширение `etb_agent_control`;
- создание паспорта, Agent Cabinet, агента или masking-конфига;
- отдельный ledger или кнопка публикации.

Решение о системной карточке остаётся за Анваром, как указано в исходном
handoff.

## Проверки

- `npm test` в `toolbar`: **274/274** passed;
- `npm run build`: PASS;
- `git diff --check`: PASS.

Сборка выводит ожидаемое dev-предупреждение о недоступной Library-сборке.
Это не относится к Evolution Console и не является release/deploy артефактом.
