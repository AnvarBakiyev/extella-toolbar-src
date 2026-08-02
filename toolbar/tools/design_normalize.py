#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Механика дизайн-кода: замер и нормализация кеглей, радиусов и доставки шрифтов.

ЧТО ЭТО И ЧЕГО НЕ ДЕЛАЕТ. Инструмент снимает МЕХАНИКУ — значения, которых нет в шкале.
Он не судит о композиции: отличить случайный 17-й кегль от намеренного заголовка машина
не может, это работа глазами (Элла, HANDOFF/CHECK_BY_EYE_01-08.md). Порядок именно такой:
сначала машина сводит значения к шкале, потом человек идёт по композиции — иначе человек
ищет дыры между блоками, которые через час сдвинет нормализатор.

РАЗДЕЛЕНИЕ ИСТОЧНИКОВ (просьба Эллы, 03.08). Витрина инлайнит чужие панели, и без
разделения она отвечает за чужие стили: замер показывал «в витрине Inter», хотя в её
исходнике Inter нет ни одного вхождения — слово встречалось внутри Interview / Interest /
Internal. Ловушка подстроки. Поэтому шрифты ищем как ЗНАЧЕНИЯ font-family, а не как слова
в тексте, и каждый файл считаем отдельно.

ШКАЛА — DESIGN_CODE.md от 31.07:
  кегли  11 / 13 / 15 / 20 / 26
  радиусы 12 / 8 / 999 / 50%
  шрифты Nunito (интерфейс) / Source Serif 4 (заголовки) / JetBrains Mono (подписи)
  доставка шрифтов обязательна: панель без @font-face или ссылки на шрифты работает
  случайно — из того, что нашлось в системе у конкретного человека.

  python3 design_normalize.py --measure <файлы...>
  python3 design_normalize.py --apply   <файлы...>      # правит на месте

Коды выхода: 0 — всё в шкале (для --measure) или правки применены, 1 — есть отклонения.
"""
import re
import sys
from pathlib import Path

SIZES = [11, 13, 15, 20, 26]
RADII = [8, 12, 999]
CANON_FONTS = ("nunito", "source serif 4", "jetbrains mono")

FONT_SIZE_RE = re.compile(r"(font-size\s*:\s*)(\d+(?:\.\d+)?)px", re.I)
RADIUS_RE = re.compile(r"(border-radius\s*:\s*)(\d+(?:\.\d+)?)px", re.I)
RADIUS_VAR_RE = re.compile(r"(--radius[\w-]*\s*:\s*)(\d+(?:\.\d+)?)px", re.I)
# Шрифт ищем как ЗНАЧЕНИЕ свойства, а не как слово в тексте: см. ловушку подстроки выше.
#
# Границы значения — не только ;{}: в этом файле стили живут внутри JS-строк
# (`'<div style="font-family:var(--mono, monospace)">…'`), и правило «до точки с запятой»
# утаскивало в «название шрифта» пол-абзаца текста. Режем ещё по кавычкам, угловой скобке
# и переводу строки, а объявления через var() пропускаем: токен и есть канон.
FONT_FAMILY_RE = re.compile(r"font-family\s*:\s*([^;}{'\"<>\n]+)", re.I)

# Шрифт объявляют ещё двумя способами, и без них замер врёт в самую важную сторону:
#   --sans: Inter, ui-sans-serif, …   ← определение токена; сам токен выглядит канонным
#   font: 14px/1.45 var(--sans);      ← сокращённая запись, font-size в ней не найти
# Именно так Inter и жил в profit-growth: в определении токена. Проверка, которая видит
# только font-family и font-size, объявила бы панель чистой.
FONT_TOKEN_RE = re.compile(r"--(?:sans|serif|mono)[\w-]*\s*:\s*([^;}{\n]+)", re.I)
FONT_SHORTHAND_RE = re.compile(r"(font\s*:\s*(?:[\w]+\s+)*?)(\d+(?:\.\d+)?)px", re.I)


def nearest(value: float, scale: list) -> int:
    return min(scale, key=lambda s: (abs(s - value), s))


def font_names(text: str) -> set:
    """ПЕРВЫЕ семейства каждого стека — то, чем текст рисуется на самом деле.

    Считать весь стек нельзя: Georgia, Menlo, -apple-system, ui-monospace — это законные
    ЗАПАСНЫЕ семейства, они и должны там стоять. Первая версия клеймила их наравне с Inter,
    и «шрифты вне канона» появлялись у совершенно здоровой витрины. Обвинение, которое
    нельзя исполнить, ничем не лучше пропущенного дефекта: его просто перестают читать.
    """
    names = set()
    decls = list(FONT_FAMILY_RE.findall(text)) + list(FONT_TOKEN_RE.findall(text))
    for decl in decls:
        if "var(" in decl.lower():
            continue                      # ссылка на токен — канон; само определение ниже
        # В собранном файле стили живут внутри JS-строк, и кавычки там экранированы:
        # \"JetBrains Mono\". Без снятия слэшей канонный шрифт выглядит как чужой.
        head = decl.split(",")[0].strip().replace("\\", "").strip("'\"").lower()
        if head and head not in ("inherit", "sans-serif", "serif", "monospace",
                                 "system-ui", "initial", "ui-sans-serif", "ui-monospace",
                                 "ui-serif", "-apple-system"):
            names.add(head)
    return names


def has_font_delivery(text: str) -> bool:
    """Доставлены ли шрифты: @font-face, ссылка на css шрифтов или локальный файл."""
    low = text.lower()
    return ("@font-face" in low
            or "fonts.googleapis" in low
            or "fonts.gstatic" in low
            or bool(re.search(r"url\([^)]+\.(woff2?|ttf|otf)", low)))


def measure(path: Path) -> dict:
    text = path.read_text(encoding="utf-8", errors="ignore")
    sizes = {float(m.group(2)) for m in FONT_SIZE_RE.finditer(text)} | \
            {float(m.group(2)) for m in FONT_SHORTHAND_RE.finditer(text)}
    radii = {float(m.group(2)) for m in RADIUS_RE.finditer(text)} | \
            {float(m.group(2)) for m in RADIUS_VAR_RE.finditer(text)}
    fonts = font_names(text)
    return {
        "path": path,
        "off_sizes": sorted(s for s in sizes if int(s) not in SIZES),
        "off_radii": sorted(r for r in radii if int(r) not in RADII),
        "off_fonts": sorted(f for f in fonts if f not in CANON_FONTS),
        "fonts": sorted(fonts),
        "delivery": has_font_delivery(text) if fonts else True,
    }


def apply(path: Path) -> tuple:
    text = path.read_text(encoding="utf-8", errors="ignore")
    changed_sizes, changed_radii = 0, 0

    def fix_size(m):
        nonlocal changed_sizes
        value = float(m.group(2))
        if int(value) in SIZES:
            return m.group(0)
        changed_sizes += 1
        return "%s%dpx" % (m.group(1), nearest(value, SIZES))

    def fix_radius(m):
        nonlocal changed_radii
        value = float(m.group(2))
        if int(value) in RADII:
            return m.group(0)
        changed_radii += 1
        return "%s%dpx" % (m.group(1), nearest(value, RADII))

    text = FONT_SIZE_RE.sub(fix_size, text)
    text = FONT_SHORTHAND_RE.sub(fix_size, text)
    text = RADIUS_RE.sub(fix_radius, text)
    text = RADIUS_VAR_RE.sub(fix_radius, text)

    # Шрифты сводим к канону по назначению: моноширинный — в JetBrains Mono, засечный —
    # в Source Serif 4, остальное — в Nunito. Стек с запасным семейством сохраняем.
    def fix_font(m):
        decl = m.group(1)
        low = decl.lower()
        if any(c in low for c in CANON_FONTS) or "var(" in low:
            return m.group(0)
        if "mono" in low or "courier" in low or "consol" in low:
            head = "'JetBrains Mono', ui-monospace, monospace"
        elif "serif" in low and "sans" not in low:
            head = "'Source Serif 4', Georgia, serif"
        else:
            head = "'Nunito', system-ui, sans-serif"
        return "font-family: " + head

    text = FONT_FAMILY_RE.sub(fix_font, text)

    # Определения токенов правим отдельно: именно там жил Inter (--sans: Inter, …).
    # Поправив только font-family, мы бы отчитались об успехе, не тронув причину.
    def fix_token(m):
        whole, decl = m.group(0), m.group(1)
        head = decl.split(",")[0].strip().strip("'\"").lower()
        if head in CANON_FONTS or head.startswith("var("):
            return whole
        name = m.group(0).split(":")[0].strip().lower()
        if "mono" in name:
            canon = "'JetBrains Mono'"
        elif "serif" in name and "sans" not in name:
            canon = "'Source Serif 4'"
        else:
            canon = "'Nunito'"
        rest = ",".join(decl.split(",")[1:]).strip()
        return whole.replace(decl, canon + (", " + rest if rest else ""))

    text = FONT_TOKEN_RE.sub(fix_token, text)
    path.write_text(text, encoding="utf-8")
    return changed_sizes, changed_radii


def main(argv) -> int:
    mode = argv[0] if argv else ""
    files = [Path(a).expanduser() for a in argv[1:]]
    if mode not in ("--measure", "--apply") or not files:
        print(__doc__.strip().splitlines()[-4])
        return 2

    problems = 0
    for path in files:
        if not path.exists():
            print("  ~ %s — файла нет" % path.name)
            continue
        before = measure(path)
        if mode == "--apply":
            s, r = apply(path)
            after = measure(path)
            print("%s: кеглей сведено %d, радиусов %d" % (path.name, s, r))
            if after["off_sizes"] or after["off_radii"]:
                print("    осталось вне шкалы: кегли %s, радиусы %s"
                      % (after["off_sizes"] or "—", after["off_radii"] or "—"))
            if after["off_fonts"]:
                print("    шрифты вне канона: %s" % ", ".join(after["off_fonts"]))
            if not after["delivery"]:
                print("    ⚠ ДОСТАВКИ ШРИФТОВ НЕТ — панель работает на системном шрифте")
                problems += 1
        else:
            bad = bool(before["off_sizes"] or before["off_radii"]
                       or before["off_fonts"] or not before["delivery"])
            print("%s%s" % ("  ✗ " if bad else "  ✓ ", path.name))
            if before["off_sizes"]:
                print("      кегли вне шкалы (%d): %s" % (
                    len(before["off_sizes"]), ", ".join("%g" % s for s in before["off_sizes"])))
            if before["off_radii"]:
                print("      радиусы вне шкалы (%d): %s" % (
                    len(before["off_radii"]), ", ".join("%g" % r for r in before["off_radii"])))
            if before["off_fonts"]:
                print("      шрифты вне канона: %s" % ", ".join(before["off_fonts"]))
            if not before["delivery"]:
                print("      ⚠ доставки шрифтов нет — шрифт работает случайно, из системы")
            problems += bool(bad)

    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
