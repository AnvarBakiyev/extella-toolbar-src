#!/bin/sh
set -eu

# EXTELLA_STANDALONE_INSTALLER_RETIRED=1
#
# Этот репозиторий — источник сборки, а не канал раздачи. Деплой одного
# сгенерированного файла из изменяемого чекаута обходит подписанную атомарную
# транзакцию клиента и оставляет тулбар, каталог, Activity Center и состояние
# аккаунта на несовместимых версиях (живой инцидент 24.07: боковая сборка
# перетёрла рабочую витрину — она печатала сырой JSON).
#
# КУДА ИДТИ ВМЕСТО ЭТОГО (обновлено 27.07.2026, живой путь, проверен):
#
#   Коллеги и новые машины ставятся одной командой из пака:
#     curl -fsSL https://raw.githubusercontent.com/AnvarBakiyev/extella-marketplace-pack/main/toolbar/install-all.sh | bash
#
#   Пак = канал раздачи: тулбар + эксперты + Конструктор, версия Конструктора
#   пиннится неизменяемым SHA. Артефакт в пак попадает ТОЛЬКО сборкой из чистого
#   origin/main (§11 TEAM_PROTOCOL); синхронность проверяется одной командой:
#     bash tools/sync_toolbar_artifact.sh --check   (в репозитории пака)
#
#   Подписанного клиента Extella с версионированным bootstrap ПОКА НЕ СУЩЕСТВУЕТ —
#   не отсылаем туда, пока он не появится. Это честная граница, а не заглушка.

printf '%s\n' >&2 \
  '{"status":"failed","errorClass":"StandaloneInstallerRetired","message":"Прямая установка из этого репозитория отключена: он источник сборки, а не канал раздачи. Живой путь: curl -fsSL https://raw.githubusercontent.com/AnvarBakiyev/extella-marketplace-pack/main/toolbar/install-all.sh | bash — пак ставит тулбар, эксперты и Конструктор (версия пиннится SHA). Direct installation from this repository is disabled: it is a build input, not a distribution channel. Use the pack installer above."}'
exit 2
