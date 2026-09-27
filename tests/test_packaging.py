"""Keep requirements.txt honest with the code's real imports.

Parses every third-party import in balabot/*.py and ui/server.py with the
`ast` module (never regex) and asserts each one is declared in
requirements.txt. Adding an import without declaring it fails this test.
"""

import ast
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
SCAN_DIRS = ("balabot", "ui")


def _third_party_imports() -> set[str]:
    mods = set()
    for d in SCAN_DIRS:
        for py in (REPO / d).glob("*.py"):
            tree = ast.parse(py.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    mods.update(a.name.split(".")[0] for a in node.names)
                elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
                    mods.add(node.module.split(".")[0])
    # Import name -> distribution name (e.g. `import yaml` comes from PyYAML).
    ALIAS = {"yaml": "pyyaml"}
    return {ALIAS.get(m, m) for m in mods if m not in sys.stdlib_module_names}


def _declared() -> set[str]:
    mods = set()
    for line in (REPO / "requirements.txt").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            mods.add(line.split(">=")[0].split("==")[0].split("<")[0].strip().lower())
    return mods


def test_every_third_party_import_is_declared():
    undeclared = _third_party_imports() - _declared()
    assert not undeclared, (
        "Third-party imports missing from requirements.txt: "
        f"{sorted(undeclared)} — declare them or the install is broken."
    )
