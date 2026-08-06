# Ответ интегратору: Evolution Console, scanner contract

## Находка №57 закрыта на стороне Console

Evolution Console больше не принимает успешный ответ старой затеняющей копии
`_etb_evolution_registry_scan_v1` за актуальный пустой или неполный снимок.

Новый scanner возвращает:

```json
{
  "contract_version": "extella.evolution.registry_scan.v2",
  "capabilities": [
    "device_refs_v1",
    "runtime_probe_v1",
    "strict_cards_v1"
  ]
}
```

Console принимает снимок только при точном `contract_version` и наличии
`device_refs_v1`. Длина кода, дата Expert и HTTP `success` доказательствами версии
не считаются.

## Три состояния теперь различаются

| Ответ scanner | Результат Console |
|---|---|
| Актуальный маркер + `entries: []` | честный пустой реестр |
| Нет маркера / нет `device_refs_v1` | `DEVICE_SCANNER_CONTRACT_STALE` |
| Вызов не удался | `DEVICE_CARDS_UNAVAILABLE` |

При `DEVICE_SCANNER_CONTRACT_STALE`:

- источник карточек устройства недоступен и снимок неполон;
- записи старого scanner не доказывают установку;
- состояние и зависимые действия не открываются;
- интерфейс показывает отдельное двуязычное сообщение «Нужно обновить компонент
  проверки», а не ноль автоматизаций.

Console ничего не пишет, не обновляет Expert и не чистит скоупы.

## Версия и проверка

- Evolution Console: `0.16.2`;
- полный прогон с обязательным pinned checkout стандартов: **343/343**, skipped 0;
- Library и release artifacts собраны, 111 манифестов;
- catalog contract, runtime portability, account scope и UI text: passed;
- reproducibility:
  `53a3f978ac8e2072fc134dbef6b2430ed1fbbf3d98f1499df81c14ddf30b25d7`;
- scanner source SHA-256:
  `43520cb88233a25bf9ed2cbbf48ee2edb7371aaee29564bf5b13b8d64909b7a9`;
- маркер и отдельный код ошибки присутствуют во всех трёх release artifacts;
- известные device ID отсутствуют.

## Порядок приёмки

1. Проверить ветку относительно свежего `origin/main`.
2. Запустить 343 теста с `EXTELLA_REQUIRE_STANDARDS=1`, убедиться в `skipped 0`.
3. Слить PR и собрать Library/release только из чистого `main`.
4. Обновить общую копию scanner Expert новым source и **перечитать её из того же
   фактического скоупа**, проверив наличие строки
   `extella.evolution.registry_scan.v2`; одного ответа `success` недостаточно.
5. Выложить пакет и сверить RAW-артефакт.
6. На обычном агенте проверить актуальный снимок. На Агенте 1С со старой
   затеняющей копией проверить именно `DEVICE_SCANNER_CONTRACT_STALE` и сообщение
   обновления — не пустой реестр.

Скоуп Агента 1С и лишний дубль Юриста эта ветка намеренно не изменяет. Их очистка
остаётся отдельной работой интегратора после разморозки 1С.

Rollback: откатить merge-коммит PR и пересобрать пакет из `main`; scanner Expert
не удалять вслепую.
