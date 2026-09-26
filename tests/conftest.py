"""Fixtures isolating state for the BalaBot test suite.

- HERMES_HOME and BALABOT_DATA_ROOT point at pytest tmp_path.
- Path.home() is monkeypatched so the default `~/.hermes` fallback also
  lands inside tmp_path.
- A fake repo root with personas/{principal,governor} templates + a skill
  stands in for the real repo (same layout, same contracts).
- A FakeJev client satisfies the Jev duck-type without any network.
- requests.post / Session.post are monkeypatched at the HTTP layer so the
  real client code (connection, retry, parse) still runs.
"""

from __future__ import annotations

import copy
import json
import pytest

from balabot import bootstrap as bootstrap_mod
from balabot.jev import Jev
from balabot.memory_relevance import Candidate


TEMPLATE = """\
model:
  default: some/other-model
  provider: some-provider
telegram:
  bot_token: "SHOULD-NOT-SURVIVE"
"""


@pytest.fixture
def hermes_env(tmp_path, monkeypatch):
    """Isolated env: hermes home + data root under tmp_path, no secrets."""
    hermes_home = tmp_path / "hermes_home"
    data_root = tmp_path / "data"
    hermes_home.mkdir()
    data_root.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(hermes_home))
    monkeypatch.setenv("BALABOT_DATA_ROOT", str(data_root))
    for key in ("OPENROUTER_API_KEY", "TELEGRAM_BOT_TOKEN", "TYPESAFE_API_KEY"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setattr("pathlib.Path.home", lambda: tmp_path)
    return {"hermes_home": hermes_home, "data_root": data_root}


@pytest.fixture
def fake_repo(tmp_path):
    """Minimal repo root with the persona templates + one skill."""
    root = tmp_path / "repo"
    for persona in bootstrap_mod.PERSONAS:
        pdir = root / "personas" / persona
        pdir.mkdir(parents=True)
        (pdir / "config.template.yaml").write_text(TEMPLATE, encoding="utf-8")
        (pdir / "AGENTS.md").write_text("# rules\n", encoding="utf-8")
        (pdir / "SOUL.md").write_text("# soul\n", encoding="utf-8")
    skill = root / "skills" / "demo-skill"
    (skill / "references").mkdir(parents=True)
    (skill / "SKILL.md").write_text("---\nname: demo-skill\n---\nbody\n", encoding="utf-8")
    return root


class FakeJev:
    """Fake Jev client (no network). Scripted: answers per ref, keyed per call."""

    def __init__(self, answers_by_call=None):
        # answers_by_call: list of dicts {ref: noul_probability}
        self.calls: list[tuple] = []  # (state, questions dict)
        self.answers_by_call = answers_by_call or []
        self._call_index = 0

    def system_one(self, state, questions, *, shadow=False):
        self.calls.append((state, dict(questions)))
        if self._call_index >= len(self.answers_by_call):
            probs = {ref: 0.0 for ref in questions}  # everything scores low
        else:
            probs = self.answers_by_call[self._call_index]
        self._call_index += 1
        return {
            "model": "jev-1.13.0",
            "answers": {
                ref: {"type": "noul", "noul": prob} for ref, prob in probs.items()
            },
            "usage": {"input_tokens": 10, "output_tokens": 2},
        }


@pytest.fixture
def fake_jev():
    def _make(answers_by_call=None):
        return FakeJev(answers_by_call)

    return _make


def make_candidates(*refs):
    return [Candidate(ref=r, text=f"fact for {r}") for r in refs]


# ---- HTTP-layer mocks for jev.py (real client code, fake transport) ----

def make_response(status_code, payload):
    class Resp:
        def __init__(self):
            self.status_code = status_code
            self.text = json.dumps(payload)

        def json(self):
            return payload

    return Resp()


@pytest.fixture
def http_responses(monkeypatch):
    """Queue of scripted responses; records each request payload."""
    recorded = {"bodies": [], "headers": []}
    queue: list = []

    def _queue(status_code, payload):
        queue.append((status_code, payload))

    def fake_post(url, *args, **kwargs):
        recorded["bodies"].append(kwargs.get("json"))
        recorded["headers"].append(kwargs.get("headers"))
        if not queue:
            raise AssertionError("HTTP call made but no scripted response left")
        status_code, payload = queue.pop(0)
        # Deep-copy: shadow mode mutates the returned dict; never share state.
        return make_response(status_code, copy.deepcopy(payload))

    monkeypatch.setattr("requests.Session.post", fake_post)
    return _queue, recorded
