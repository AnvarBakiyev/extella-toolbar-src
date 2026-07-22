from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
PANEL = ROOT / "toolbar" / "src" / "panels" / "activity-center.js"
BUILD = ROOT / "toolbar" / "build.js"
INSTALLER = ROOT / "install.sh"


class ToolbarIntegrationTests(unittest.TestCase):
    def test_activity_panel_is_part_of_modular_build(self) -> None:
        self.assertIn("'activity-center.js'", BUILD.read_text(encoding="utf-8"))
        source = PANEL.read_text(encoding="utf-8")
        self.assertIn("store.setc('automations')", source)
        self.assertIn("Регулярные задачи", source)
        self.assertIn("Что работает в фоне", source)
        self.assertIn("X-Extella-Control", source)
        self.assertIn("Очистить выполненные", source)
        self.assertIn("Убрать запись из ленты", source)
        self.assertIn("PID ", source)
        self.assertIn("right:12px;bottom:12px", source)

    def test_removed_subtitle_does_not_return(self) -> None:
        self.assertNotIn(
            "Понятная лента вместо технического лога",
            PANEL.read_text(encoding="utf-8"),
        )

    def test_standalone_installer_is_retired(self) -> None:
        source = INSTALLER.read_text(encoding="utf-8")
        self.assertIn("EXTELLA_STANDALONE_INSTALLER_RETIRED=1", source)
        self.assertIn("StandaloneInstallerRetired", source)
        self.assertNotIn("api_token.txt", source)
        self.assertNotIn("read -p", source)

    def test_device_runtime_has_one_canonical_owner(self) -> None:
        self.assertFalse((ROOT / "device" / "activity-center" / "bridge").exists())
        self.assertFalse((ROOT / "device" / "activity-center" / "instrumentation").exists())
        self.assertFalse((ROOT / "device" / "activity-center" / "install.py").exists())
        self.assertFalse((ROOT / "device" / "activity-center" / "uninstall.py").exists())
        self.assertFalse((ROOT / "device" / "boot").exists())
        self.assertFalse((ROOT / "toolbar" / "src" / "core" / "install-prompt.js").exists())


if __name__ == "__main__":
    unittest.main()
