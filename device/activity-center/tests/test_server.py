from __future__ import annotations

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "bridge"))

from server import _LISTENER_COMMAND  # noqa: E402


class ServerTests(unittest.TestCase):
    def test_matches_listener_and_rejects_shell_probe(self) -> None:
        listener = (
            "/Users/me/.cache/uv/archive-v0/env/bin/python "
            "/Users/me/.cache/uv/archive-v0/env/bin/extella-listener "
            "--url https://disnet.extella.ai/ --type private"
        )
        shell = "zsh -c ps | rg '/bin/extella-listener --url https://disnet.extella.ai/'"
        self.assertIsNotNone(_LISTENER_COMMAND.search(listener))
        self.assertIsNone(_LISTENER_COMMAND.search(shell))


if __name__ == "__main__":
    unittest.main()
