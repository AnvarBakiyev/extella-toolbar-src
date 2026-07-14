# Extella Toolbar — вводная для разработчика

Тулбар («витрина/магазин» внутри приложения Extella) — это **один собираемый файл** `toolbar.js`,
который приложение Extella (Electron) грузит на старте. Тут вся вкладочная витрина: Рабочий стол,
Витрина, Программы, Модели, Навыки, Инструменты, Знания, Workspace, Агенты, Сервисы, Профи.

## Ветки (ВАЖНО — начни отсюда)
- **`merge/ella-vitrina`** — актуальная интеграционная ветка (13.07). **Базируйся на ней.**
- `main` — **устарел (5 июля), НЕ бери его.**
- `ws-ui` — feature-ветка «Workspace» (кокпит воркспейсов, ws-v1.2), в открытом PR → `merge/ella-vitrina` (мержится по слову Анвара).

## Раскладка
- `toolbar/public/*.html` — экраны/панели. Главный — **`plugins_manager.html`** (~4500 строк: все вкладки, рендеры, мост).
  Формы плагинов — `plugin-form.html`, чат-плагина — `plugin-chat.html`.
- `toolbar/plugins/*.json` — определения плагинов витрины (form-плагины несут код эксперта в `expert_defs`).
- `toolbar/src/core/*.js` — общие JS-модули (инлайнятся в сборку).
- `toolbar/build.js` — сборщик: инлайнит `public/*.html` + `src/core/*.js` → `build/toolbar.js`.

## Сборка и деплой
```
cd toolbar
node build.js                       # → build/toolbar.js (единый артефакт)
# ЛОКАЛЬНАЯ проверка (build.js НЕ деплоит сам!):
cp build/toolbar.js "$HOME/Library/Application Support/extella-desktop/toolbar.js"
# затем Cmd+Q приложения Extella и открыть заново
```
- Приложение грузит `<userData>/toolbar.js` если он есть (macOS: `~/Library/Application Support/extella-desktop/`),
  иначе бандл. То есть для теста достаточно положить свой `toolbar.js` в userData + перезапуск.
- **Коллегам** тулбар доезжает НЕ отсюда, а из публичного `extella-marketplace-pack` (`toolbar/toolbar.js`),
  который тянет установщик. Публикация туда — только по прямому слову Анвара.

## Как это работает в рантайме
- **Эксперты на устройстве** зовутся через мост: `skBridge('etb_run_expert','etb_expert_result',{name, params}, timeoutMs)`
  → приложение → REST `/api/expert/run` на аккаунте, в который залогинен пользователь.
  - **Глобальные эксперты зови с `global:true`** (иначе «Expert not found» на новых аккаунтах — это был реальный баг).
  - Отложенные задачи (`build` и т.п.) мост **НЕ доводит сам** — возвращают `deferred/task_id`;
    поллить результат надо самому (напр. синхронным `list`), см. панель Workspace.
- **KV/правила/агенты** — тоже через `skBridge` (`etb_kv_get/set`, `etb_rule_*`, `etb_run_agent`).
- **Плагины-серверы** (Визард, excalidraw, Travel Agency…) НЕ бандлятся в тулбар:
  открываются `notify('open','<plugin_id>')` → хост резолвит по реестру `~/extella-plugins/_registry/*.json`
  → локальный сервер плагина. **Визард грузится так же (реестр → 8765), версия нигде не пришпилена** —
  какой визард зарегистрирован, тот и грузится.

## Канон (не нарушать)
- **Ядро v6 (Electron-оболочку) не патчим** — работаем только в плагин-слое `toolbar.js` (`plugins_manager.html` и пр.).
- Клиентские агенты — платформенный **Qwen**, не платный Claude (`agent_extella_default` = Claude, запрещён клиентам;
  keyless-Qwen = `agent_extella_alibaba_default`; лучше — свой Qwen-агент пользователя).
- Каталоги-витрины в KV **шардированы** (`_mkt_models`, `_mkt_skills_catalog`) — читать через `_loadSharded`.

## Workspace (ветка ws-ui)
Панель воркспейсов — contract-first против движка `wz_workspace` (репо `extella-adoption-wizard`, `copilot/WORKSPACE_API.md`).
UI только рендерит ответ движка, сам ничего не вычисляет. Функции: `renderWorkspace / wsRenderCockpit / wsRenderCurated / wsOpen / wsDoBuild / ws*`.

Вопросы — Анвар сведёт с нужной сессией (тулбар / Визард / движок Workspace).
