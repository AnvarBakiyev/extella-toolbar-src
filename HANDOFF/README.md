# Готовая сборка тулбара

Свежий собранный `toolbar.js` — можно ставить без сборки:

```
cp HANDOFF/toolbar.js ~/Library/Application\ Support/extella-desktop/toolbar.js
# затем полностью перезапустить Extella Desktop (Cmd+Q → открыть заново)
```

Либо канонический путь: `./install.sh` из корня репо (соберёт из исходников и задеплоит;
без Node.js установщик сам возьмёт эту готовую сборку).

Версия файла = последний коммит, тронувший `HANDOFF/toolbar.js`:
`git log -1 --format='%h %ad' -- HANDOFF/toolbar.js`
