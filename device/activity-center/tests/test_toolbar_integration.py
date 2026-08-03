"""Плашка активности собрана в тулбар и держит свои контракты.

ПОЧЕМУ ЭТОТ ФАЙЛ ПЕРЕПИСАН (03.08.2026). Тест падал, и падал по правильной причине:
он требовал слово «PID» в панели, а его убрали как жаргон, и строку «Очистить
выполненные», которую переформулировали. То есть тест защищал ФОРМУЛИРОВКИ — то, что
дизайнер меняет законно и часто. Такой тест краснеет на каждой удачной правке текста,
и его начинают пролистывать; а рядом в нём же лежало требование «install-prompt.js не
должно существовать», хотя файл живой, 76 КБ и входит в сборку.

Тест, который врёт о причине, хуже отсутствующего: он учит игнорировать красное.

Поэтому проверяем не слова, а контракты, которые ломаются молча:
  • панель действительно попадает в модульную сборку (иначе её просто нет у людей);
  • переход в автоматизации живёт (кнопка ведёт в раздел, а не в никуда);
  • служебный заголовок управления на месте (без него служба не отличит свои запросы);
  • панель прибита к своему углу (её позиция — часть договора с окном);
  • причина отказа читается КОДОМ, а не угадыванием по английскому тексту.

Последнее — новое и главное: до 03.08 причина узнавалась регуляркой по словам вроде
«worker hung». Стоило источнику поменять формулировку, и перевод отваливался молча —
человек видел сырую английскую строку и читал её как поломку продукта.
"""
from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
PANEL = ROOT / "toolbar" / "src" / "panels" / "activity-center.js"
BUILD = ROOT / "toolbar" / "build.js"
INSTALLER = ROOT / "install.sh"


class ToolbarIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.panel = PANEL.read_text(encoding="utf-8")

    def test_activity_panel_is_part_of_modular_build(self) -> None:
        self.assertIn("'activity-center.js'", BUILD.read_text(encoding="utf-8"))
        self.assertIn("store.setc('automations')", self.panel)
        self.assertIn("X-Extella-Control", self.panel)
        self.assertIn("right:12px;bottom:12px", self.panel)

    def test_failure_reason_is_read_from_a_code(self) -> None:
        """Код — источник правды о причине, текст — только запасной путь."""
        self.assertIn("run.code", self.panel)
        for code in ("'hung'", "'timeout'", "'not_found'", "'forbidden'"):
            self.assertIn(code, self.panel, f"нет разбора кода {code}")
        # Разбор текста остаётся намеренно: записи до введения кодов кода не имеют,
        # и часть сообщений приходит от платформы. Но он обязан быть ЗАПАСНЫМ — идти
        # ниже разбора кодов, а не вместо него.
        #
        # Сравниваем позиции ВНУТРИ ТЕЛА функции, а не по всему файлу: первая версия
        # этой проверки поймала слова «worker hung» в комментарии над функцией и
        # объявила порядок нарушенным. Тест, меряющий комментарии, ничего не защищает.
        body = self.panel.split("function runErrText(", 1)[1].split("\n  }", 1)[0]
        self.assertIn("switch (code)", body)
        self.assertLess(body.index("switch (code)"), body.index("worker hung"),
                        "текст разбирается раньше кода — значит код ни на что не влияет")

    def test_removed_subtitle_does_not_return(self) -> None:
        self.assertNotIn("Понятная лента вместо технического лога", self.panel)

    def test_jargon_stays_out_of_the_panel(self) -> None:
        """Машинные слова не возвращаются в ВИДИМЫЙ текст (дизайн-код, раздел 7).

        Проверяем запрет, а не формулировку, которая его заменила: привязка к
        формулировке и сломала прежнюю версию теста.

        И только видимые строки, а не весь файл. Первая версия этой проверки искала
        «localhost» по всему исходнику и нашла — в правиле, которое как раз ЗАМЕНЯЕТ
        localhost на «на этом компьютере». То есть тест обвинил защиту от жаргона.
        Ровно тот же дефект, из-за которого этот файл и переписывается.
        """
        visible = " ".join(re.findall(r"T\(\s*'((?:[^'\\]|\\.)*)'", self.panel))
        self.assertTrue(visible, "не нашёл ни одной видимой строки — проверка бессмысленна")
        for word in ("PID ", "localhost", "воркер", "конфиг"):
            self.assertNotIn(word, visible, f"жаргон вернулся в видимый текст: {word}")

    def test_standalone_installer_is_retired(self) -> None:
        source = INSTALLER.read_text(encoding="utf-8")
        self.assertIn("EXTELLA_STANDALONE_INSTALLER_RETIRED=1", source)
        self.assertIn("StandaloneInstallerRetired", source)
        self.assertNotIn("api_token.txt", source)
        self.assertNotIn("read -p", source)

    @staticmethod
    def _has_own_files(path) -> bool:
        """Каталог считается существующим, только если в нём есть что-то своё.

        Запуск рантайма локально оставляет __pycache__, и тест падал на нём:
        в git этих файлов нет, репозиторий чист, а проверка кричала о нарушении
        контракта. Обвинялся при этом чужой код — самая дорогая ошибка теста.
        """
        if not path.exists():
            return False
        return any(p.name != "__pycache__" for p in path.iterdir())

    def test_device_runtime_has_one_canonical_owner(self) -> None:
        # install-prompt.js из этого списка убран: файл живой, входит в сборку
        # (build.js) и правился последним коммитом. Требование его отсутствия было
        # остатком отменённого решения — тест утверждал то, чего мы не делаем.
        self.assertFalse(self._has_own_files(ROOT / "device" / "activity-center" / "bridge"))
        self.assertFalse(self._has_own_files(ROOT / "device" / "activity-center" / "instrumentation"))
        self.assertFalse(self._has_own_files(ROOT / "device" / "activity-center" / "uninstall.py"))
        self.assertFalse(self._has_own_files(ROOT / "device" / "boot"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
