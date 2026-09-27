"""E2E: does the live balabot-jev checkpoint actually WRITE and actually BLOCK?

Runs inside the container with HERMES_HOME bound to a real persona home, through
the real memory-provider loader and the real durable store — no fakes, no
monkeypatched wire shapes. Prints PASS/FAIL per step plus raw evidence.

Usage:  python /opt/balabot/tests/e2e_jev_checkpoint_live.py <profile>
"""
import json
import os
import sys
import traceback
from pathlib import Path

profile = sys.argv[1] if len(sys.argv) > 1 else "principal"
home = Path(f"/opt/data/profiles/{profile}")
os.environ["HERMES_HOME"] = str(home)
sys.path.insert(0, "/opt/hermes")

results = {}


def step(name, fn):
    try:
        value = fn()
        results[name] = {"ok": True, "value": value}
        print(f"[PASS] {name}: {value}")
    except Exception as exc:  # noqa: BLE001 — this script's whole job is to report
        results[name] = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
        print(f"[FAIL] {name}: {type(exc).__name__}: {exc}")
        traceback.print_exc()


from plugins.memory import load_memory_provider  # noqa: E402

provider = None

EVIDENCE = [
    {"role": "user", "content": "We decided the retention window is 30 days, not 90."},
    {"role": "assistant", "content": "Noted: retention window = 30 days."},
    {"role": "user", "content": "Also: the governor must approve any schema change."},
]


def load():
    global provider
    provider = load_memory_provider("balabot-jev")
    assert provider is not None, "loader returned None"
    api = getattr(provider, "pre_compress_checkpoint_api_version", None)
    assert api == 2, f"expected checkpoint API v2, got {api!r}"
    tools = provider.get_tool_schemas()
    return {"api": api, "tools": [t.get("name") for t in tools]}


step("load via real loader (api v2 + tool surface)", load)


def init():
    provider.initialize(session_id=f"e2e-{profile}")
    return "initialized"


step("initialize session", init)


def write():
    ctx = provider.on_pre_compress(EVIDENCE, require_checkpoint=True)
    assert ctx, "checkpoint returned empty context under require_checkpoint=True"
    return {"context_len": len(ctx), "head": ctx[:120].replace("\n", " | ")}


step("checkpoint WRITE (require_checkpoint=True)", write)


def readback():
    store = provider._get_store()
    state = store.re_anchor(f"e2e-{profile}")
    assert state, "re_anchor empty — write was NOT confirmed by readback"
    return {"re_anchor": json.dumps(state)[:200]}


step("durable READBACK of the checkpoint", readback)


def idempotent():
    before = provider._get_store().re_anchor(f"e2e-{profile}")
    provider.on_pre_compress(EVIDENCE, require_checkpoint=True)
    after = provider._get_store().re_anchor(f"e2e-{profile}")
    assert json.dumps(before, sort_keys=True, default=str) == json.dumps(after, sort_keys=True, default=str), "re-checkpoint CHANGED state (not idempotent)"
    return "same evidence -> same stored state"


step("IDEMPOTENCY (repeat evidence does not double-write)", idempotent)

# --- fail-closed: the durable store cannot be written -------------------------
store = provider._get_store()
raw = store.raw


def nuke():
    """Make the durable write fail the way it REALLY fails in production.

    Drops the cached connection, chmods the DB file read-only, and clears the
    adapter so the next call must open a fresh store — reproducing
    "attempt to write a readonly database" exactly as the root-owned store did
    to the hermes gateway. The checkpoint must then RAISE, not return "".
    """
    provider._checkpointed.clear()
    path = store.raw._path
    con = getattr(store.raw, "_conn", None)
    try:
        if con is not None:
            con.close()
    except Exception:
        pass
    os.chmod(path, 0o400)
    provider._store_adapter = None
    return f"db {path} set read-only + connection dropped"


step("arm the failure (durable writes now impossible)", nuke)


def blocked():
    try:
        provider.on_pre_compress(
            [{"role": "user", "content": "Different evidence after the store broke."}],
            require_checkpoint=True,
        )
    except Exception as exc:  # noqa: BLE001
        return {"raised": type(exc).__name__, "msg": str(exc)[:160]}
    raise AssertionError("returned instead of RAISING — fail-closed is BROKEN")


step("checkpoint BLOCKS when the store cannot confirm", blocked)


def restore():
    os.chmod(store.raw._path, 0o600)
    provider._store_adapter = None
    return "db writable again"


step("restore the store", restore)


def works_again():
    ctx = provider.on_pre_compress(
        [{"role": "user", "content": "Post-restore evidence, must checkpoint again."}],
        require_checkpoint=True,
    )
    assert ctx, "checkpoint did not recover after the store was restored"
    return {"recovered": True, "context_len": len(ctx)}


step("checkpoint RECOVERS after restore (no permanent damage)", works_again)


print("\n=== RESULT JSON ===")
print(json.dumps(results, indent=2))
fails = [k for k, v in results.items() if not v.get("ok")]
print(f"\nSUMMARY: {len(results) - len(fails)}/{len(results)} passed" + (f" — FAILED: {fails}" if fails else ""))
sys.exit(1 if fails else 0)
