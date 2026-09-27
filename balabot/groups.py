"""Multi-agent group chat state (Wave 6 P3).

A group is 2–6 fleet bots sharing ONE conversation room. Hard rules:

- SERIAL rounds: a user message fans out to the targeted members one at a
  time, in manifest order — never in parallel. The round counter increments
  after every turn, so ordering is observable in the transcript.
- @mentions route the message to specific members; no mention means every
  member speaks in the round.
- PER-MEMBER sessions: each bot keeps its OWN message history inside the
  group (`sessions[bot]["messages"]`). A member's upstream context is built
  only from its own history plus a short shared-transcript context — no
  member ever sees another member's raw session dump as its history.
- SHARED Agent Computer pane: the group carries ONE `computer_agent` (a
  member id). The group's screen is that agent's screen — one pane for the
  whole group, exactly as the plan specifies.

State lives in the container's data root (`<BALABOT_DATA_ROOT>/groups/`),
one JSON file per group, written atomically — the same durability model as
the org registry. Nothing is created at import time.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

__all__ = [
    "GroupsError",
    "MIN_MEMBERS",
    "MAX_MEMBERS",
    "create_group",
    "list_groups",
    "get_group",
    "delete_group",
    "mention_targets",
    "turn_plan",
    "apply_turn_results",
]

MIN_MEMBERS = 2
MAX_MEMBERS = 6


class GroupsError(ValueError):
    """A group request is invalid (bad size, unknown group, unknown member)."""


def _root() -> Path:
    return Path(os.environ.get("BALABOT_DATA_ROOT", "/opt/data")) / "groups"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _group_path(gid: str) -> Path:
    return _root() / f"{gid}.json"


def _save(group: dict) -> None:
    path = _group_path(group["id"])
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".g-", suffix=".tmp")
    try:
        try:
            os.fchmod(fd, 0o600)
        except AttributeError:  # Windows
            pass
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(group, fh, indent=2, sort_keys=True)
            fh.write("\n")
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


_GROUP_ID_RE = re.compile(r"^g_[0-9a-f]{10}$")
_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,63}$")


def new_group_id() -> str:
    return f"g_{uuid.uuid4().hex[:10]}"


def create_group(name: str, members: list[str], *, created_by: str = "user",
                 computer_agent: str | None = None,
                 known_bots: list[str] | None = None) -> dict:
    """Create a group of 2–6 distinct bots. Validates every member against
    `known_bots` when given (the fleet registry is the caller's truth)."""
    if not name or not isinstance(name, str) or len(name) > 80:
        raise GroupsError("group name must be a non-empty string (max 80 chars)")
    if not isinstance(members, list):
        raise GroupsError("members must be a list of bot ids")
    if len(members) < MIN_MEMBERS or len(members) > MAX_MEMBERS:
        raise GroupsError(
            f"a group needs between {MIN_MEMBERS} and {MAX_MEMBERS} members "
            f"(got {len(members)})")
    if len(set(members)) != len(members):
        raise GroupsError("members must be distinct bots")
    for m in members:
        if not isinstance(m, str) or not _SLUG_RE.match(m):
            raise GroupsError(f"invalid member id {m!r}")
        if known_bots is not None and m not in known_bots:
            raise GroupsError(f"unknown bot {m!r} is not in the fleet")
    pane = computer_agent if computer_agent is not None else members[0]
    if pane not in members:
        raise GroupsError("computer_agent must be a member of the group")
    group = {
        "id": new_group_id(),
        "name": name.strip(),
        "members": list(members),
        "computer_agent": pane,
        "created_by": created_by,
        "created_at": _now(),
        "round": 0,
        "transcript": [],
        "sessions": {m: {"messages": [], "updated_at": None} for m in members},
    }
    _save(group)
    return group


def _load(gid: str) -> dict:
    if not isinstance(gid, str) or not _GROUP_ID_RE.match(gid):
        raise GroupsError(f"invalid group id {gid!r}")
    path = _group_path(gid)
    if not path.exists():
        raise GroupsError(f"unknown group {gid!r}")
    return json.loads(path.read_text(encoding="utf-8"))


def get_group(gid: str) -> dict:
    return _load(gid)


def list_groups() -> list[dict]:
    """Summary rows, newest last. A missing dir is an honest empty list."""
    root = _root()
    if not root.is_dir():
        return []
    rows = []
    for p in sorted(root.glob("g_*.json")):
        g = json.loads(p.read_text(encoding="utf-8"))
        rows.append({
            "id": g["id"], "name": g["name"], "members": g["members"],
            "computer_agent": g["computer_agent"], "round": g["round"],
            "created_at": g["created_at"],
            "transcript_len": len(g["transcript"]),
        })
    return rows


def delete_group(gid: str) -> bool:
    path = _group_path(gid)
    if path.exists():
        path.unlink()
        return True
    return False


# ---------------------------------------------------------------------------
# Mentions and serial-round mechanics
# ---------------------------------------------------------------------------

_MENTION_RE = re.compile(r"@([a-z0-9][a-z0-9_-]*)")


def mention_targets(text: str, members: list[str]) -> list[str]:
    """Members explicitly named with `@id` in the text, in member order.

    A mention of a non-member is ignored (not an error): the group roster is
    the truth about who can be addressed.
    """
    named = set(_MENTION_RE.findall(text or ""))
    return [m for m in members if m in named]


def turn_plan(gid: str, text: str) -> dict:
    """The serial plan for one turn, WITHOUT touching state.

    Returns the group plus, for each member who will speak this round, its
    OWN session history and the upstream messages payload. The orchestrator
    (the HTTP layer) executes these one at a time, in order, then calls
    apply_turn_results. Group-context is a short labelled excerpt of the
    shared transcript — NOT another member's session history.
    """
    g = _load(gid)
    targets = mention_targets(text, g["members"]) or list(g["members"])
    tail = [
        {"from": e["from"], "text": e["text"]}
        for e in g["transcript"][-6:]
    ]
    context = "\n".join(f"{e['from']}: {e['text']}" for e in tail)
    plan = []
    for bot in targets:
        history = list(g["sessions"][bot]["messages"])
        content = (
            (f"[Group chat '{g['name']}' — recent transcript]\n{context}\n\n"
             if context else "")
            + text
        )
        plan.append({
            "bot": bot,
            "messages": history + [{"role": "user", "content": content}],
        })
    return {"group": g, "plan": plan}


def apply_turn_results(gid: str, text: str, results: list[dict]) -> dict:
    """Persist one completed serial round.

    `results` is ordered (the orchestrator ran them serially): each entry is
    {"bot", "text"} on success or {"bot", "error", "detail"} on failure. An
    error is recorded in the transcript as an explicit honest row — a member
    that could not speak is reported, never silently skipped.

    Each successful member also gets its own-session history advanced with
    the user message and its own reply (per-member sessions, P3).
    """
    g = _load(gid)
    round_no = g["round"] + 1
    g["round"] = round_no
    spoke = set()
    for r in results:
        bot = r.get("bot", "")
        if bot not in g["members"]:
            continue
        if r.get("error"):
            g["transcript"].append({
                "at": _now(), "round": round_no, "from": bot,
                "kind": "error", "text": "",
                "detail": str(r.get("detail", "could not respond"))[:300],
            })
            continue
        spoke.add(bot)
        text_out = str(r.get("text", ""))
        g["transcript"].append({
            "at": _now(), "round": round_no, "from": bot,
            "kind": "message", "text": text_out,
        })
        sess = g["sessions"][bot]
        sess["messages"] = (sess["messages"] +
                            [{"role": "user", "content": text},
                             {"role": "assistant", "content": text_out}])[-80:]
        sess["updated_at"] = _now()
    # Members who did NOT speak this round still get the user's message in
    # their own history exactly once, so they see it on their next turn.
    for bot in g["members"]:
        if bot in spoke:
            continue
        sess = g["sessions"][bot]
        sess["messages"] = (sess["messages"] +
                            [{"role": "user", "content": text}])[-80:]
        sess["updated_at"] = _now()
    _save(g)
    return g


# ---------------------------------------------------------------------------
# Read-only inspector CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    import sys
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv[:1] == ["list"]:
        rows = list_groups()
        if not rows:
            print("no groups")
            return 0
        for r in rows:
            print(f"{r['id']}  {r['name']}  members={','.join(r['members'])} "
                  f"round={r['round']} computer={r['computer_agent']}")
        return 0
    if argv[:2] == ["show"] and len(argv) == 3:
        g = get_group(argv[2])
        print(json.dumps(g, indent=2, sort_keys=True))
        return 0
    print("usage: python -m balabot.groups list | show <gid>", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
