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
cp toolbar/build/toolbar.js HANDOFF/toolbar.js
if [ -n "$(git status --porcelain HANDOFF/toolbar.js)" ]; then
  git add HANDOFF/toolbar.js
  git commit -q -m "Пересборка артефакта после слияния с чужими правками"
  echo "артефакт пересобран и закоммичен"
fi

say "4. Проверяю, что мои правки пережили слияние"
FAIL=0
for MARK in "BENTO_HEROES" "cmd_add_btn" "claudeConnectModal"; do
  if grep -q "$MARK" toolbar/public/plugins_manager.html; then
    echo "   ✓ $MARK на месте"
  else
    echo "   ✗ $MARK ПРОПАЛ после слияния"; FAIL=1
  fi
done
[ "$FAIL" = 0 ] || { say "Останавливаюсь: правки потерялись при слиянии"; exit 1; }

if [ "$CHECK_ONLY" = true ]; then
  say "Проверка пройдена (--check: не отправляю)"; exit 0
fi

say "5. Отправляю"
git push origin main          # без --force, никогда
git status -sb | head -1
