# Ответ интегратору: Evolution Console, круг 4

## Блокер снят в коде и релизном артефакте

Console больше не содержит литеральные ID устройств из Automation Passports.
Шесть проекций перепинены на опубликованные паспорта:

- `DEVICE_FROM_HOST` — Predictive Sales, Рекрутёр, Таргетолог, Юрист и Травел;
- `DEVICE_FROM_REF` + `~/extella_baga/panel.json:data_device` — Баға.

Пины `commit` и `sha256` сверены с фактическими файлами во всех шести
репозиториях и закреплены точными значениями в тесте.

## Как теперь разрешается устройство

1. Host передаёт Console ID текущего устройства.
2. Read-only scanner получает только список заранее закреплённых `device_ref`.
3. Scanner умеет читать только один разрешённый адрес Баға и возвращает только
   поле `data_device`. Произвольный путь, соседнее поле, symlink, большой файл,
   неверный JSON и значение не в формате target ID отклоняются.
4. `DEVICE_FROM_HOST` резолвится в ID текущего host-моста.
5. `DEVICE_FROM_REF` резолвится только в подтверждённое значение scanner.
6. При отсутствии файла или значения Console не вызывает state Expert, не
   подставляет host-устройство и возвращает
   `STATE_READER_DEVICE_UNAVAILABLE` с пустыми `requestedTarget` и `dataDevice`.

`targets: [resolvedDevice]` остаётся обязательным эффективным полем платформы;
одиночный `target` сохранён только для совместимости старых desktop-сборок.

## Релизная проверка

- полный прогон с `EXTELLA_REQUIRE_STANDARDS=1` и точным checkout стандартов
  `4d8d759`: **340/340, пропусков 0**;
- сборка Library: выполнена;
- release build: **111 манифестов**, Console `0.16.1`;
- catalog contract: passed;
- runtime portability: passed;
- account-scope portability: passed;
- UI hardcoded text: passed;
- reproducibility: passed,
  `136072cf8bd0bed71a118630decfecc9ef0dcd4ade7a59e2e19abb2322f58da1`;
- старые ID `85800354-f7b7-449f-b526-9357cd91f780` и
  `24f37e45-8c9f-4896-b64f-0dcd0cd8b0e4` отсутствуют в обоих release artifacts;
- source и contract-тест запрещают любой литеральный UUID в проекции паспортов.

Ваш приватный `check_no_client_data.sh` не входит в репозиторий toolbar, поэтому
его нужно повторить на собранном артефакте после слияния. Именно сработавшие
ранее два ID устранены и защищены регрессионным тестом.

## Приёмка и выкладка

1. Проверить, что ветка не отстаёт от свежего `origin/main`.
2. Слить PR.
3. Собрать Library и release artifacts только из чистого checkout `main`.
4. Запустить полный тест с обязательными pinned standards и проверить
   `skipped 0`.
5. Запустить `check_no_client_data.sh` на итоговом `toolbar/toolbar.js`.
6. Выложить пак обычным процессом интегратора.
7. На машине без `~/extella_baga/panel.json` проверить честное «состояние
   недоступно»; на настроенной машине — точный вызов `kzg_state` на VPS target.

Rollback: вернуть один merge-коммит этого PR и пересобрать пакет из `main`.
