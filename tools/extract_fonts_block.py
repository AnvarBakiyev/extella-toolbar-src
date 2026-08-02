#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Достаёт из витрины Extella готовый блок начертаний и кладёт его в отдельный CSS.

Запуск:  python3 extract_fonts_block.py путь/к/plugins_manager.html [куда.css]
По умолчанию пишет extella-fonts.css рядом.

Зачем: панель может просить Nunito сколько угодно — если самого начертания в
документе нет, браузер подставит системный шрифт, и на другой машине заголовки
уедут в Georgia. Шрифты внутри блока лежат data-строками, поэтому файл
самодостаточен: ни интернета, ни отдельных .woff2 рядом не нужно.
"""

import io
import re
import sys


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    источник = sys.argv[1]
    цель = sys.argv[2] if len(sys.argv) > 2 else 'extella-fonts.css'
    s = io.open(источник, encoding='utf-8').read()
    блоки = re.findall(r'@font-face\s*\{[^}]*\}', s)
    if not блоки:
        print('В этом файле нет @font-face — проверь, что это собранная витрина '
              '(toolbar/build/plugins_manager.html), а не исходник.')
        return 1
    css = '/* Начертания Extella. Взято из витрины, править руками не нужно. */\n' + '\n'.join(блоки) + '\n'
    io.open(цель, 'w', encoding='utf-8').write(css)
    семейства = sorted(set(re.findall(r"font-family:\s*'([^']+)'", css)))
    print('Записан %s: блоков %d, семейства — %s' % (цель, len(блоки), ', '.join(семейства)))
    print('Подключи в <head> панели:  <link rel="stylesheet" href="%s">' % цель)
    return 0


if __name__ == '__main__':
    sys.exit(main())
