# Evolution Console — единый реестр автоматизаций

Дата: 2026-07-26
Ветка: `codex/automations-registry`
База: `origin/main@38c868f1fc68f23b9496b2e178624c5b04b24732`
Задание: `extella-core-portal/docs/handoffs/A_CONSOLE_REGISTRY.md`

## Результат

Evolution Console теперь открывается с единым read-only реестром
автоматизаций текущего устройства. Платформенные агенты показаны только внутри
раскрываемого состава автоматизации; Agent Cabinet остаётся взглядом на одного
агента.

Проекция сводит:

- глобальный каталог `_mkt_automations`;
- глобальный реестр Композитора `_mkt_installed`;
- локальный список `etb_plugins_installed_v1`;
- строгие карточки текущего устройства `<automation_id>.json`;
- `agent/list`, глобальный список Experts и явно объявленные KV расписаний.

Поле `installed` каталога учитывается как отдельное свидетельство и не
переопределяет факт установки: установленной считается только валидная карточка
текущего устройства. Доступность в каталоге и установка показаны раздельно.

`installed_stale` вычисляется только по двум валидным SemVer 2.0. Для Агента 1С
это `0.3.0-dev.6 < 0.3.0-dev.16`. `dead_reference` вычисляется по обязательному
объявленному компоненту, которого нет в доступном снимке. Необязательный Expert
`one_c` остаётся видимым, но его отсутствие не создаёт ложный риск.

Три проверенные автоматизации присутствуют в проекции независимо от качества
старого каталога:

- `extella_1c_agent`;
- `extella_contract_agent` — Kazakh Lawyer;
- `extella_travel_agency` — Агент турагентства.

Существующие 12 каталоговых записей не переписываются: все остаются видимыми,
дубли, сироты и неполные записи не удаляются. Отсутствующие версия и статус
отображаются как `UNKNOWN`, запись помечается `CATALOG_RECORD_INVALID`, а весь
снимок становится неполным.

## Инварианты честности

- Проекция и основной UI-путь не вызывают `kvSet`, `saveExpert`, удаление,
  provisioning или изменение localStorage.
- Недоступный каталог или сканер даёт трёхзначные факты `UNKNOWN`, а не
  «Не в каталоге» или «Не установлена».
- Исторический факт мёртвой ссылки Агента 1С применяется только к подтверждённой
  установленной версии `0.3.0-dev.6`, не во время сбоя device-источника.
- `complete` проверяется на согласованность со статусом каждого источника;
  противоречивый source snapshot отклоняется.
- Состояние службы не выдумывается: `enabled=UNKNOWN`, последние запуск,
  результат и ошибка равны `null`. Контракт состояния относится к отдельной
  задаче B4.
- UI не предлагает включение, выключение, обновление или откат автоматизации.
- Ошибки источников проходят в iframe только как ограниченные `source` и
  `code`; детали и потенциальные секреты не передаются.
- Названия соответствуют обязательному `NAMING.md`; RU и EN поставляются
  одновременно.

## Строгий сканер карточек

Owned Expert: `_etb_evolution_registry_scan_v1`
Scope: `global:true`
Runtime target: только точный ID текущего устройства, без untargeted fallback
Source: `toolbar/plugins/scenarios/evolution-registry-scanner.py`
Raw source SHA-256:
`ab76ee5633353ebec87825b672eeb28c3b1c931c5426da26bda46370fff68134`

Сканер:

- читает только верхний уровень `~/extella-plugins/_registry`;
- принимает только lower-case stable ID по маске
  `^[a-z0-9][a-z0-9._-]{1,79}\.json$`;
- требует точного равенства имени файла и `manifest.id`;
- отклоняет symlink, повреждённый JSON и дубликаты;
- считает и игнорирует `*.bak_*`;
- возвращает только allowlist безопасных полей и не отдаёт `install.secrets`,
  код Experts или токены;
- ничего не пишет и не удаляет.

Тест воспроизводит одну точную карточку, 102 backup-файла, вложенную карточку,
несовпавший ID, upper-case ID и секретные поля: в проекцию попадает только
точная карточка, секретные значения отсутствуют.

## Обязательный внешний release-гейт: доставка Expert

Это изменение намеренно не выходит в репозиторий signed Extella Client
(§13 протокола). Одной заменой toolbar уже установленный
`profit-growth-scenario` с версии 0.4 на 0.5 новый Expert не получает:
локальный installed registry хранит только plugin ID, а provisioning карточки
повторно не запускается.

До deploy интегратор обязан включить точные bytes сканера в signed Client
upgrade:

1. Скопировать source без смысловых изменений под loader-compatible именем
   `platform_experts/_etb_evolution_registry_scan_v1.py`.
2. Добавить `_etb_evolution_registry_scan_v1` в
   `release/expert-classification.json` как `bundled`.
3. Добавить то же имя в
   `release/plugins/extella_toolbar.json → experts.required`.
4. Проверить byte equality и SHA-256 source из toolbar и marketplace; если
   merge изменил source, одновременно обновить `sourceSha256` манифеста и
   повторить toolbar tests.
5. Собрать signed candidate и выполнить штатные release gate и
   `installer/client_verify.py`: Expert GET, canonical SHA-256 read-back и
   side-effect-free install smoke должны быть зелёными.
6. Проверить upgrade 0.4 → 0.5 без reinstall карточки: stable plugin ID
   сохраняется, Expert появляется, exact-device run идёт с `global:true`, а
   Console получает три automation ID без backup entries.

Запрещено заменять этот шаг runtime-вызовом `saveExpert` при открытии Console:
основной путь реестра остаётся только чтением.

Отдельный write-side запрет записи `_mkt_automations` без `version`/`status`
должен быть добавлен владельцем Композитора/Визарда. В toolbar нет write-path
этого генератора; ветка отклоняет такую запись на чтении и не нарушает §13.

## Проверки

- `npm test` в `toolbar`: **160/160**, failed 0, skipped 0;
- focused registry/provider/router/scanner: зелёные;
- `check_brand_copy.py --strict`: `ИТОГ: БРЕНД СОБЛЮДЁН`;
- `scripts/check-account-scope.js`: passed;
- `scripts/check-managed-runtime-lifecycle.js`: passed;
- syntax checks, inline scripts и `git diff --check`: passed;
- preview RU/EN: визуально проверены обзор, фильтр мёртвых ссылок,
  раскрытие состава и одновременные метки Агента 1С; console errors: 0;
- toolbar-only reproducibility из временной копии: passed,
  SHA-256 `78c2a194c06dfa1edb04abbdf9a4275e84fd17d188ded207005b8dcff87c313f`,
  `8 367 834` bytes, строк `^</script>`: 0.

Последний hash — диагностический dev-артефакт, не разрешение на deploy: в
временной копии отсутствовал собранный Library. Полный release обязан быть
пересобран интегратором после merge из чистого `origin/main`.

`check-catalog-contract.js` и `check-runtime-portability.js` остаются красными
на известных baseline-долгах main (честные метки каталога, removal/installer
routes, Windows claims, checked-in stale artifacts и install-prompt). Новая
namespace-ошибка Evolution Console устранена. Протокольные `preflight_ui.sh` и
`smoke_e2e.py` в этом репозитории отсутствуют.

## Merge, deploy и rollback

1. Не смешивать эту ветку вслепую с прежней
   `codex/evolution-console-automation-mvp`: обе используют версию `0.5.0`.
   Интегратор выбирает один канонический состав поверх свежего main.
2. Влить toolbar branch.
3. Закрыть signed Client Expert gate выше.
4. В чистом checkout полученного `origin/main` выполнить полный test/build,
   release sentinels и ручную Xtel-приёмку.
5. Deploy — только штатным signed pack/RAW/install-all путём из чистого
   `origin/main`, согласно §§10–11 `docs/TEAM_PROTOCOL.md`.

Прямой deploy из этой feature-ветки запрещён. Rollback: revert merge toolbar,
убрать scanner Expert только через signed Client ownership-aware rollback,
пересобрать и установить предыдущий чистый release. Автоматизации, их карточки,
KV и состояние эта ветка не изменяет.
