#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Проверка панели агента по дизайн-коду Extella (DESIGN_CODE.md).

Запуск:   python3 check_panel_canon.py путь/к/panel.html [ещё файлы...]
Выход:    0 — панель проходит канон, 1 — есть нарушения.

Скрипт НИЧЕГО не правит. Он называет, что именно вне канона и сколько раз,
чтобы правки делались по фактам, а не на глаз. Проверяет то, что измеримо:
шрифты и их доставку, кегли, веса, радиусы, отступы, тени, обращение на «вы»,
машинные слова и эмодзи. Композицию — дыры, спорящие кнопки, порядок блоков —
он не видит: это смотрит человек.
"""

import io
import re
import sys

КЕГЛИ = {11, 13, 15, 20, 26}
ВЕСА = {400, 500, 600, 700}
РАДИУСЫ = {8, 12, 999}
ОТСТУПЫ = {0, 4, 8, 12, 16, 24, 32, 48}
СЕМЕЙСТВА = ('nunito', 'source serif 4', 'jetbrains mono',
             'var(--sans', 'var(--serif', 'var(--mono)', 'var(--etb-sans',
             'var(--etb-serif', 'var(--etb-mono', 'inherit')

МАШИННЫЕ = ['псевдоанонимизац', 'юзер', 'ассистент', 'визард', 'деплой', 'токен',
            'скоуп', 'эндпоинт', 'воркер', 'репозитор', 'рецепт установки',
            'оркестратор', 'аллоулист', 'конфиг', 'ПДн', 'PID', 'PORT', 'localhost']

ВЫ_ФОРМЫ = [r'\bВы\b', r'\bвы\b', r'\bваш', r'\bВаш', r'\bвам\b', r'\bВам\b',
            r'\bвведите\b', r'\bНажмите\b', r'\bнажмите\b', r'\bукажите\b',
            r'\bзаполните\b', r'\bскопируйте\b', r'\bоткройте\b', r'\bвыберите\b',
            r'\bсоздаёте\b', r'\bпередаёте\b', r'\bописываете\b', r'\bприглашайте\b']

ЭМОДЗИ = re.compile('[\U0001F300-\U0001FAFF☀-➿️]')


def текст_без_кода(s):
    """Грубо вырезаем <script> и <style>, чтобы слова искать в видимом тексте."""
    s = re.sub(r'<script\b.*?</script>', ' ', s, flags=re.S | re.I)
    s = re.sub(r'<style\b.*?</style>', ' ', s, flags=re.S | re.I)
    return s


def проверить(путь):
    s = io.open(путь, encoding='utf-8').read()
    видимый = текст_без_кода(s)
    беды = []
    заметки = []

    # 1. Доставка начертаний — самая частая поломка: шрифт работает случайно, из системы.
    #    Спрашиваем только с самостоятельных документов: панель, которая живёт внутри
    #    приложения Extella, получает начертания от шелла, и требовать их с неё — ложная тревога.
    самостоятельный = bool(re.search(r'<html\b|<head\b|<!DOCTYPE', s, re.I))
    доставка = len(re.findall(r'@font-face|\.woff2|data:font/|fonts\.googleapis', s))
    if самостоятельный and not доставка:
        беды.append('Начертаний нет в документе: ни @font-face, ни .woff2. '
                    'Шрифт сейчас берётся из системы и на другой машине уедет в Georgia.')
    elif not самостоятельный and not доставка:
        заметки.append('Это встраиваемая панель: начертания должен дать шелл приложения. '
                       'Если панель открывается своим окном — добавь @font-face.')

    # 2. Чужие семейства
    чужие = {}
    for m in re.finditer(r'(?:font-family|--sans|--serif|--mono)\s*:\s*([^;\n}"\']+)', s):
        стек = m.group(1).strip()
        if not any(f in стек.lower() for f in СЕМЕЙСТВА):
            чужие[стек[:60]] = чужие.get(стек[:60], 0) + 1
    for стек, n in sorted(чужие.items(), key=lambda x: -x[1]):
        беды.append('Чужой шрифт (%d): %s' % (n, стек))

    # 3. Кнопки и поля не наследуют шрифт — без правила браузер ставит им Arial
    if re.search(r'<(button|input|select|textarea)\b', s, re.I) \
       and not re.search(r'button\s*,\s*input|input\s*,\s*button|button,select,input|'
                         r'button,\s*input,\s*select', s, re.I):
        заметки.append('Не вижу правила «button,input,select,textarea{font-family:inherit}» — '
                       'проверь, что кнопки и поля не набраны системным шрифтом.')

    # 4. Кегли
    кегли = {}
    for m in re.finditer(r'font-size\s*:\s*(\d+)px', s):
        n = int(m.group(1))
        if n not in КЕГЛИ and n < 40:
            кегли[n] = кегли.get(n, 0) + 1
    if кегли:
        беды.append('Кегли вне шкалы 11/13/15/20/26: ' +
                    ', '.join('%dpx×%d' % (k, v) for k, v in sorted(кегли.items())))

    # 5. Веса
    веса = sorted(set(int(m.group(1)) for m in re.finditer(r'font-weight\s*:\s*(\d{3})', s)
                      if int(m.group(1)) not in ВЕСА))
    if веса:
        беды.append('Веса вне 400/500/600/700: ' + ', '.join(str(w) for w in веса))

    # 6. Радиусы
    радиусы = {}
    for m in re.finditer(r'border-radius\s*:\s*(\d+)px', s):
        n = int(m.group(1))
        if n not in РАДИУСЫ:
            радиусы[n] = радиусы.get(n, 0) + 1
    if радиусы:
        беды.append('Радиусы вне 8/12/пилюля: ' +
                    ', '.join('%dpx×%d' % (k, v) for k, v in sorted(радиусы.items())))

    # 7. Отступы
    отступы = {}
    for m in re.finditer(r'(?:margin|padding|gap)(?:-(?:top|right|bottom|left))?\s*:\s*([^;\n}"\']+)', s):
        for n in re.findall(r'(\d+)px', m.group(1)):
            n = int(n)
            if n not in ОТСТУПЫ:
                отступы[n] = отступы.get(n, 0) + 1
    if отступы:
        топ = sorted(отступы.items(), key=lambda x: -x[1])[:8]
        беды.append('Отступы вне шкалы 4/8/12/16/24/32/48: ' +
                    ', '.join('%dpx×%d' % (k, v) for k, v in топ))

    # 8. Тени
    тени = len([m for m in re.finditer(r'box-shadow\s*:\s*([^;\n}]+)', s)
                if 'none' not in m.group(1).lower()])
    if тени:
        беды.append('Теней быть не должно, глубину даёт граница 1px. Найдено: %d' % тени)

    # 9. Обращение на «вы»
    вы = {}
    for шаблон in ВЫ_ФОРМЫ:
        for m in re.finditer(шаблон, видимый):
            вы[m.group(0)] = вы.get(m.group(0), 0) + 1
    if вы:
        беды.append('Обращение на «вы» (канон — «ты»): ' +
                    ', '.join('%s×%d' % (k, v) for k, v in sorted(вы.items(), key=lambda x: -x[1])[:8]))

    # 10. Машинные слова
    машинные = {}
    for слово in МАШИННЫЕ:
        n = len(re.findall(re.escape(слово), видимый, re.I))
        if n:
            машинные[слово] = n
    if машинные:
        беды.append('Машинные слова в видимом тексте: ' +
                    ', '.join('%s×%d' % (k, v) for k, v in sorted(машинные.items(), key=lambda x: -x[1])))

    # 11. Эмодзи
    эмодзи = ЭМОДЗИ.findall(видимый)
    if эмодзи:
        заметки.append('Эмодзи в интерфейсе: %d. Допустим только аватар агента, '
                       'который выбрал человек; остальное — линейная иконка Iconoir.' % len(эмодзи))

    return беды, заметки


def main():
    пути = sys.argv[1:]
    if not пути:
        print(__doc__)
        return 2
    всего = 0
    for путь in пути:
        try:
            беды, заметки = проверить(путь)
        except IOError as e:
            print('%s — не прочитать: %s' % (путь, e))
            всего += 1
            continue
        print('\n=== %s' % путь)
        if not беды and not заметки:
            print('  ✓ канон соблюдён')
        for b in беды:
            print('  ✕ %s' % b)
        for z in заметки:
            print('  · %s' % z)
        всего += len(беды)
    print('\nИтого нарушений: %d' % всего)
    return 1 if всего else 0


if __name__ == '__main__':
    sys.exit(main())
