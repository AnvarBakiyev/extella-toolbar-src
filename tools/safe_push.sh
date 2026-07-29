#!/bin/bash
# Безопасный пуш: ничего чужого не затирается, чужие пуши подхватываются.
#
# Порядок: забрать удалённое → перенести свои коммиты поверх (rebase, не merge)
# → пересобрать артефакт → убедиться, что мои правки на месте → отправить.
# Ни при каких условиях не делает force-push и не трогает чужие файлы.
#
# Использование:
#   bash tools/safe_push.sh                 # проверить и отправить
#   bash tools/safe_push.sh --check         # только проверить, не отправлять
#
set -euo pipefail
cd "$(dirname "$0")/.."
CHECK_ONLY=false
[ "${1:-}" = "--check" ] && CHECK_ONLY=true

say(){ printf '\n\033[1m%s\033[0m\n' "$*"; }

# 0. Незакоммиченное — это риск: параллельная сессия в той же папке может
#    забрать наши правки в свой коммит. Останавливаемся и говорим об этом.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  say "Есть незакоммиченные правки — сначала коммит, потом пуш:"
  git status --short
  exit 1
fi

MINE=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)
say "1. Забираю удалённое"
git fetch origin

THEIRS=$(git rev-list --count HEAD..origin/main)
echo "мои коммиты: $MINE · пришло чужих: $THEIRS"

if [ "$THEIRS" -gt 0 ]; then
  say "2. Переношу свои коммиты поверх чужих (rebase)"
  git log --oneline HEAD..origin/main | sed 's/^/   чужой: /'
  if ! git rebase origin/main; then
    if git status --porcelain | grep -q '^UU HANDOFF/toolbar.js'; then
      say "Конфликт только в собранном артефакте — пересобираю из исходника"
      ( cd toolbar && node build.js >/dev/null )
      cp toolbar/build/toolbar.js HANDOFF/toolbar.js
      git add HANDOFF/toolbar.js
      GIT_EDITOR=true git rebase --continue
    else
      say "Конфликт в ИСХОДНИКАХ — разбирать руками, чужое не затирать:"
      git status --short | grep '^UU' || true
      echo "   после разрешения: git add <файлы> && git rebase --continue"
      exit 1
    fi
  fi
else
  say "2. Чужих коммитов нет, переносить нечего"
fi

say "3. Пересобираю и проверяю сборку"
( cd toolbar && node build.js >/dev/null )
node --check toolbar/build/toolbar.js
# Зеркал артефакта ДВА, и оба под гитом: HANDOFF/toolbar.js и toolbar/toolbar.js.
# Скрипт обновлял только первое — 29.07 они разъехались, и в отстающем осталась
# старая сборка. Обновляем оба из одной свежей.
cp toolbar/build/toolbar.js HANDOFF/toolbar.js
cp toolbar/build/toolbar.js toolbar/toolbar.js
if [ -n "$(git status --porcelain HANDOFF/toolbar.js toolbar/toolbar.js)" ]; then
  git add HANDOFF/toolbar.js toolbar/toolbar.js
  git commit -q -m "Пересборка артефакта после слияния с чужими правками"
  echo "артефакт пересобран и закоммичен"
fi

say "4. Проверяю, что мои правки пережили слияние"
FAIL=0
# Маркеры — по одному от каждого, кто ведёт файл: иначе скрипт скажет «зелено»,
# потеряв чужую правку. Добавляешь свою — впиши сюда её якорь.
for MARK in "BENTO_HEROES" "cmd_add_btn" "claudeConnectModal" "Управление агентами" "skRunAgent"; do
  if grep -q "$MARK" toolbar/public/plugins_manager.html; then
    echo "   ✓ $MARK на месте"
  else
    echo "   ✗ $MARK ПРОПАЛ после слияния"; FAIL=1
  fi
done
[ "$FAIL" = 0 ] || { say "Останавливаюсь: правки потерялись при слиянии"; exit 1; }

say "4б. Гоняю гейты и тесты"
# `node --check` ловит только синтаксис. Утром 29.07 через него спокойно прошла
# сборка с платным Claude-агентом в зеркале — гейт account-scope её и поймал.
GATES_FAILED=""
for G in check-account-scope check-runtime-portability check-reproducible-build; do
  if node "scripts/$G.js" >/dev/null 2>&1; then echo "   ✓ $G"
  else echo "   ✗ $G ПРОВАЛ"; GATES_FAILED="$GATES_FAILED $G"; fi
done
CANON="$HOME/Documents/Extella/extella-agent-standards/tools/check_code_canon.py"
if [ -f "$CANON" ]; then
  if python3 "$CANON" toolbar HANDOFF >/dev/null 2>&1; then echo "   ✓ канон кода"
  else echo "   ✗ канон кода ПРОВАЛ"; GATES_FAILED="$GATES_FAILED check_code_canon"; fi
else
  echo "   · канон кода пропущен (нет репозитория стандартов рядом)"
fi
if node --test toolbar/tests/*.test.js >/dev/null 2>&1; then echo "   ✓ тесты"
else echo "   ✗ тесты ПРОВАЛ"; GATES_FAILED="$GATES_FAILED tests"; fi
[ -z "$GATES_FAILED" ] || { say "Останавливаюсь, красное:$GATES_FAILED"; exit 1; }

if [ "$CHECK_ONLY" = true ]; then
  say "Проверка пройдена (--check: не отправляю)"; exit 0
fi

say "5. Отправляю"
git push origin main          # без --force, никогда
git status -sb | head -1
