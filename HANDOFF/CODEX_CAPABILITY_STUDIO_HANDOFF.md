# Передача интегратору: «Студия способностей»

Дата: 25.07.2026

Ветка: `codex/capability-studio-enable`

База: свежий `origin/main` (`d930cc0`)

## Результат

В штатный каталог Extella добавлен устанавливаемый сценарий «Студия способностей».

Пользовательский путь после официального релиза:

`Extella → Плагины → Программы → Работа и карьера → Студия способностей → Установить → Открыть`

Студия содержит:

- карту 30 подтверждённых или заявленных способностей Extella;
- честное разделение на 12 доступных в Studio, 10 частично видимых в продукте и 8 доступных как evidence;
- рабочий сценарий «Прибыльный рост»;
- рабочую проверку общей памяти через временные global Concept и Rule;
- сравнение решений двух разных клиентских агентов;
- автоматическую подтверждённую очистку временных governance-объектов.

## Почему это не было видно

Исходники Studio находились только в старом незакоммиченном worktree, который отставал от `origin/main` примерно на 100 коммитов. В текущей установленной сборке карточки Studio нет.

Старая резервная сборка Studio также содержала дефект сериализации: literal `</script>` из встроенного HTML преждевременно завершал host script и мог ломать витрину. Поэтому старый bundle нельзя копировать или устанавливать.

Эта ветка переносит только сценарий и минимальные платформенные изменения на свежий `origin/main`. Старые tracked-файлы и старый bundle не переносились.

## Основные изменения

- Добавлен манифест `profit-growth-scenario`.
- UI и Expert source подключаются как reviewed assets и безопасно встраиваются при build.
- JSON для inline script экранирует `<`, U+2028 и U+2029.
- Секрет остаётся в host-контуре и не передаётся iframe или модели.
- Studio получает только узкий bridge для своих декларированных способностей.
- Tokenless Studio работает в `sandbox="allow-scripts"` без same-origin, с CSP `connect-src 'none'`; iframe не может прочитать host token или самостоятельно выйти в сеть.
- Generic Expert bridge ограничен allowlist из манифеста Studio.
- Два агента вызываются без Claude/Anthropic; запрет проверяется и в UI, и host-side, с `tool_choice: none`, пустым набором tools и конечными ограниченными бюджетами.
- Governance-проверка использует только временные объекты с маркером `XTL-STUDIO-GOV-*`.
- Concept pagination читается полностью, а не только первые 500 объектов.
- Cleanup сериализован, подтверждается повторным чтением, привязан к user/account и восстанавливается после close/timeout/restart и позднего появления session token.
- Expert имеет namespaced-имя `xtl_capability_studio_profitability_v1`.
- Удаление плагина удаляет только явно принадлежащий ему namespaced Expert, перепроверяет отсутствие и возвращает карточку в installed при неподтверждённой очистке.
- WebCrypto SHA-256 работает fail-closed; ненадёжного fallback нет.

## Инварианты

- Клиентские агенты: Qwen/Alibaba, не Claude.
- Agents не изменяются во время проверки.
- External writes в сценарии прибыльности: 0.
- Реальный token не хранится в коде, тестах, артефактах или отчёте.
- `global=true` используется только у намеренно общего Expert и у временных governance-маркеров.
- Временные Concept и Rule удаляются после проверки.
- Карточка не помечается установленной заранее: сначала выполняется штатное provisioning.

## Проверки

Зелёные проверки:

- `npm test` в `toolbar`: 19 тестов.
- полный `npm run build` из корня.
- inline-script VM gate.
- canonical naming gate.
- `npm run test:reproducible`.
- `node --check toolbar/build/toolbar.js`.
- regression sentinels `hasSnapshot=2`, `onlyKnown=3`, равны `origin/main`.
- live smoke на реальном аккаунте:
  - Expert вернул корректный расчёт и SHA-256;
  - два разных Qwen-агента вернули согласованное решение `SCALE`;
  - `agents_changed=0`;
  - `external_writes=0`;
  - результат `LIVE_SMOKE_PASSED`.

`test:catalog-contract` остаётся красным на девяти проблемах, уже существующих в чистом `origin/main`. Studio-специфическая ошибка устранена. Не связанные с этой веткой baseline-проблемы:

- managed runtime allowlist;
- Windows claims для OCR/LibreOffice/qpdf;
- CLI installer route;
- localhost в Adoption Wizard;
- catalog removal route;
- unverified/managed candidate labels;
- managed runtime uninstall bridge.

Другие baseline-gates `account-scope`, `runtime-portability` и старый путь managed-runtime manifest также красные на чистом `origin/main`; ветка их не расширяет.

## Официальное включение

1. Провести review и влить эту ветку в `main`.
2. На полученном `origin/main` выполнить чистую установку зависимостей.
3. Выполнить:

   ```bash
   npm run build
   npm run test:reproducible
   npm run build:release
   ```

4. Проверить карточку Studio, inline-script gate и regression sentinels.
5. Собрать и установить toolbar только штатным `pack/RAW/install-all` путём из `origin/main`.
6. Полностью закрыть Extella через `Cmd+Q` и открыть заново.
7. Пройти пользовательский путь:

   `Плагины → Программы → Работа и карьера → Студия способностей → Установить → Открыть`

8. Выполнить обе лаборатории и убедиться, что после governance-теста временные объекты отсутствуют.

**Запрещено:** напрямую копировать `toolbar/build/toolbar.js` из этого worktree в `~/Library/Application Support/extella-desktop/toolbar.js`. Командный протокол разрешает deployed override только из `origin/main` через официальный release/install путь.

## Rollback

1. Откатить merge-коммит Studio в `main`.
2. Повторить официальный build/release/install.
3. Полностью перезапустить Extella.
4. При необходимости удалить только принадлежащий Studio Expert:

   `xtl_capability_studio_profitability_v1`

Другие Experts, Concepts и Rules rollback не затрагивает.

## Неблокирующее продолжение

HTML Studio сейчас встраивается в несколько host-артефактов, поэтому суммарный bundle увеличивается примерно на 0,88 МБ. После релиза можно вынести reviewed asset в единый безопасный ресурс, не меняя продуктовый контракт.
