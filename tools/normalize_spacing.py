#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Приводит отступы, тени и веса к дизайн-коду Extella.

Запуск:   python3 normalize_spacing.py файл.html [ещё файлы...]
          python3 normalize_spacing.py --dry файл.html    — только показать, что изменится

Что делает:
  · margin / padding / gap — значения px округляются к шкале 4/8/12/16/24/32/48
    (1px не трогаем: это хайрлайн, а не отступ);
  · box-shadow — заменяется на none, глубину по канону даёт граница 1px;
  · font-weight 800/900 → 700, 650/750/760/780 → 600, 200/300 → 400.

Радиусы и кегли НЕ трогает: там выбор осмысленный (пилюля против карточки,
заголовок против подписи), и его должен делать человек.
"""

import io
import re
import sys

ШКАЛА = [0, 4, 8, 12, 16, 24, 32, 48]


def к_шкале(n):
    """Ближайшее значение шкалы; при равенстве — большее (воздуха больше, чем меньше)."""
    if n <= 1:
        return n                      # 0 и 1px — не отступы
    лучший = ШКАЛА[0]
    for v in ШКАЛА:
        if abs(v - n) < abs(лучший - n) or (abs(v - n) == abs(лучший - n) and v > лучший):
            лучший = v
    return лучший


def нормализовать(s):
    счёт = {'отступы': 0, 'тени': 0, 'веса': 0}

    def отступ(m):
        свойство, значение = m.group(1), m.group(2)
        def чинить(px):
            n = int(px.group(1))
            новое = к_шкале(n)
            if новое != n:
                счёт['отступы'] += 1
            return str(новое) + 'px'
        return свойство + re.sub(r'(\d+)px', чинить, значение)

    s = re.sub(r'((?:margin|padding|gap)(?:-(?:top|right|bottom|left))?\s*:\s*)([^;\n}"\']+)',
               отступ, s)

    def тень(m):
        if 'none' in m.group(2).lower():
            return m.group(0)
        счёт['тени'] += 1
        return m.group(1) + 'none'
    s = re.sub(r'(box-shadow\s*:\s*)([^;\n}]+)', тень, s)

    def вес(m):
        n = int(m.group(2))
        новый = {200: 400, 300: 400, 650: 600, 750: 600, 760: 600, 780: 600,
                 800: 700, 900: 700}.get(n)
        if новый is None:
            return m.group(0)
        счёт['веса'] += 1
        return m.group(1) + str(новый)
    s = re.sub(r'(font-weight\s*:\s*)(\d{3})', вес, s)

    return s, счёт


def main():
    сухой = '--dry' in sys.argv
    пути = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not пути:
        print(__doc__)
        return 2
    for путь in пути:
        было = io.open(путь, encoding='utf-8').read()
        стало, счёт = нормализовать(было)
        print('%s: отступов %d, теней %d, весов %d%s'
              % (путь, счёт['отступы'], счёт['тени'], счёт['веса'],
                 ' (ничего не записано)' if сухой else ''))
        if not сухой and стало != было:
            io.open(путь, 'w', encoding='utf-8').write(стало)
    return 0


if __name__ == '__main__':
    sys.exit(main())
