"""BalaBot org/grant registry — the one registry for orgs, members,
resources and grants (cross-org included), plus a read-only inspector CLI.

Shape per kb/plans/org-registry-schema.md:

    principal (bot) -> resource { org, kind } -> access

A cross-org grant is NOT a special case: it is simply a grant whose
resource_org differs from subject_org. Same table, same revocation path.

Hard rules:
- No secret VALUE is ever printed, logged or returned from any function.
  Metadata + fingerprint ('…' + last 4 chars) only.
- The registry lives at <data root>/orgs/registry.json and holds metadata
  only; raw values live in <data root>/.secrets/<org>/<NAME> (mode 0600).
- Nothing is created at import time; dirs/files appear only on write.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

__all__ = [
    "ORG_ROOT",
    "REGISTRY_PATH",
    "SECRETS_ROOT",
    "ENC_PREFIX",
    "ENC_PREFIX_V1",
    "ENC_PREFIX_V2",
    "fingerprint",
    "load",
    "save",
    "list_orgs",
    "show_org",
    "add_org",
    "add_bot",
    "register_secret",
    "store_secret",
    "read_secret_value",
    "migrate_secrets",
    "rotate_master_key",
    "backup_secrets",
    "verify_secrets_integrity",
    "grant",
    "revoke",
    "grants_for",
    "secrets_visible_to",
]

DEFAULT_DATA_ROOT = Path(os.environ.get("BALABOT_DATA_ROOT", "/opt/data"))

ORG_ROOT: Path = DEFAULT_DATA_ROOT / "orgs"
REGISTRY_PATH: Path = ORG_ROOT / "registry.json"
SECRETS_ROOT: Path = DEFAULT_DATA_ROOT / ".secrets"

VERSION = 1
ACCESS_VALUES = {"inject", "read"}
SCOPE_VALUES = {"bot", "org"}
RESOURCE_KINDS = {"secret", "skill", "workspace", "display"}


def _data_root() -> Path:
    """Resolve the data root at call time so tests can repoint it via env."""
    return Path(os.environ.get("BALABOT_DATA_ROOT", str(DEFAULT_DATA_ROOT)))


def _registry_path() -> Path:
    return _data_root() / "orgs" / "registry.json"


def _secrets_root() -> Path:
    return _data_root() / ".secrets"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def fingerprint(value: str) -> str:
    """'…' + last 4 chars of the value. Never the value itself."""
    if not isinstance(value, str) or len(value) < 4:
        return "…" + (value or "")
    return "…" + value[-4:]


def _empty_registry() -> dict:
    return {"version": VERSION, "orgs": {}, "secrets": [], "grants": []}


def load() -> dict:
    """Full registry; an empty default shape if absent."""
    path = _registry_path()
    if not path.exists():
        return _empty_registry()
    reg = json.loads(path.read_text(encoding="utf-8"))
    for key, default in (("version", VERSION), ("orgs", {}), ("secrets", []), ("grants", [])):
        reg.setdefault(key, default)
    return reg


def save(reg: dict) -> None:
    """ATOMIC save (temp file + os.replace), mode 0600. Never logs values."""
    path = _registry_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".registry-", suffix=".tmp")
    try:
        try:
            os.fchmod(fd, 0o600)
        except AttributeError:  # Windows: no fchmod
            pass
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(reg, fh, indent=2, sort_keys=True)
            fh.write("\n")
        try:
            os.chmod(tmp, 0o600)
        except OSError:  # best-effort on filesystems without POSIX modes (Windows)
            pass
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def list_orgs() -> list[dict]:
    return sorted(load()["orgs"].values(), key=lambda o: o["id"])


def show_org(org_id: str) -> dict | None:
    """The org, with its live grants attached as 'grants'."""
    org = load()["orgs"].get(org_id)
    if org is None:
        return None
    live = [
        g for g in load()["grants"]
        if g["revoked_at"] is None
        and (g["subject_org"] == org_id or g["resource_org"] == org_id)
    ]
    return {**org, "grants": live}


def _require_org(reg: dict, org_id: str) -> None:
    if org_id not in reg["orgs"]:
        raise KeyError(f"unknown org: {org_id!r}")


def add_org(org_id: str, name: str, *, members: list[str] | None = None,
            computer: dict | None = None) -> dict:
    if not org_id or not isinstance(org_id, str):
        raise ValueError("org_id must be a non-empty string")
    reg = load()
    if org_id in reg["orgs"]:
        raise ValueError(f"org already exists: {org_id!r}")
    org = {
        "id": org_id,
        "name": name,
        "members": list(members or []),
        "computer": dict(computer) if computer else None,
        "created_at": _now(),
    }
    reg["orgs"][org_id] = org
    save(reg)
    return org


def add_bot(org_id: str, bot_id: str) -> dict:
    """Add a bot as a member of the org (idempotent)."""
    if not bot_id or not isinstance(bot_id, str):
        raise ValueError("bot_id must be a non-empty string")
    reg = load()
    _require_org(reg, org_id)
    org = reg["orgs"][org_id]
    if bot_id not in org["members"]:
        org["members"].append(bot_id)
        save(reg)
    return org


def register_secret(name: str, org: str, *, description: str = "") -> dict:
    """Record secret metadata ONLY. Fingerprint comes from the stored value
    if one exists on disk, else '…'."""
    if not name or not isinstance(name, str):
        raise ValueError("secret name must be a non-empty string")
    reg = load()
    _require_org(reg, org)
    existing = next((s for s in reg["secrets"]
                     if s["name"] == name and s["org"] == org), None)
    if existing is None:
        existing = {
            "name": name,
            "org": org,
            "description": description,
            "fingerprint": "…",
            "created_at": _now(),
            "rotated_at": None,
        }
        reg["secrets"].append(existing)
    else:
        existing["description"] = description
    value_path = _secrets_root() / org / name
    if value_path.exists():
        val = read_secret_value(org, name)
        if val is not None:
            existing["fingerprint"] = fingerprint(val)
    save(reg)
    return dict(existing)


ENC_PREFIX_V1 = b"BALABOT_ENC_V1:"
ENC_PREFIX_V2 = b"BALABOT_ENC_V2:"
ENC_PREFIX = ENC_PREFIX_V1


def _key_identifier(key: bytes) -> str:
    """Return an 8-hex-char identifier for the key (SHA-256 fingerprint)."""
    return hashlib.sha256(key).hexdigest()[:8]


def _resolve_key(key: bytes | str | None) -> bytes | None:
    if key is None:
        return None
    if isinstance(key, bytes):
        if len(key) >= 32:
            return key[:32]
        return None
    if isinstance(key, str):
        if len(key) == 64:
            try:
                return bytes.fromhex(key)
            except ValueError:
                pass
        return hashlib.sha256(key.encode("utf-8")).digest()
    return None


def _get_master_key() -> bytes:
    """Resolve or generate the AES-256 master key for secrets-at-rest encryption.

    Checks BALABOT_SECRETS_KEY (hex or raw string) or BALABOT_SECRETS_KEY_PATH
    (file path, default: <BALABOT_DATA_ROOT>/.secrets/master.key).
    If the key file does not exist, generates a fresh 32-byte key with 0600 mode.
    """
    env_key = os.environ.get("BALABOT_SECRETS_KEY")
    if env_key:
        if len(env_key) == 64:
            try:
                return bytes.fromhex(env_key)
            except ValueError:
                pass
        return hashlib.sha256(env_key.encode("utf-8")).digest()

    key_path_str = os.environ.get("BALABOT_SECRETS_KEY_PATH")
    if key_path_str:
        key_path = Path(key_path_str)
    else:
        key_path = _secrets_root() / "master.key"

    if key_path.exists():
        try:
            data = key_path.read_bytes()
            if len(data) >= 32:
                return data[:32]
        except OSError:
            pass

    key = os.urandom(32)
    try:
        key_path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(str(key_path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(key)
        try:
            os.chmod(key_path, 0o600)
        except OSError:
            pass
    except OSError:
        pass
    return key


def store_secret(name: str, org: str, value: str, *, allowed_origins: list[str] | None = None, key_version: int = 1) -> dict:
    """Encrypt the value with AES-256-GCM, write to SECRETS_ROOT/<org>/<NAME> (0600),
    update registry metadata, and return the record WITH fingerprint. NEVER the value.

    key_version=1: writes legacy V1 header BALABOT_ENC_V1:
    key_version=2: writes V2 header with key identifier BALABOT_ENC_V2:<key_id>:
    """
    if not isinstance(value, str) or value == "":
        raise ValueError("secret value must be a non-empty string")
    reg = load()
    _require_org(reg, org)
    d = _secrets_root() / org
    d.mkdir(parents=True, exist_ok=True)
    value_path = d / name

    # Authenticated encryption (AES-256-GCM) with record binding in AAD
    key = _get_master_key()
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)
    aad = f"{org}:{name}".encode("utf-8")
    ciphertext = aesgcm.encrypt(nonce, value.encode("utf-8"), aad)

    if key_version == 2:
        key_id = _key_identifier(key)
        payload = ENC_PREFIX_V2 + key_id.encode("ascii") + b":" + nonce + ciphertext
    else:
        payload = ENC_PREFIX_V1 + nonce + ciphertext

    fd = os.open(str(value_path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as fh:
        fh.write(payload)
    try:
        os.chmod(value_path, 0o600)
    except OSError:
        pass
    record = next((s for s in reg["secrets"]
                   if s["name"] == name and s["org"] == org), None)
    if record is None:
        record = {
            "name": name,
            "org": org,
            "description": "",
            "created_at": _now(),
            "rotated_at": None,
        }
        reg["secrets"].append(record)
    record["fingerprint"] = fingerprint(value)
    if allowed_origins is not None:
        record["allowed_origins"] = list(allowed_origins)
    save(reg)
    return {k: v for k, v in record.items() if k != "value"}


def _decrypt_secret_bytes(data: bytes, org: str, name: str, key: bytes) -> str | None:
    """Decrypt raw secret file bytes using AES-256-GCM.

    Supports both:
    - V2 format: BALABOT_ENC_V2:<key_id>:<nonce><ciphertext>
    - V1 format: BALABOT_ENC_V1:<nonce><ciphertext>
    Never leaks secret value on decryption failures.
    """
    if data.startswith(ENC_PREFIX_V2):
        header_len = len(ENC_PREFIX_V2)
        colon_pos = data.find(b":", header_len)
        if colon_pos == -1:
            return None
        enc_body = data[colon_pos + 1:]
        if len(enc_body) < 28:
            return None
        nonce = enc_body[:12]
        ciphertext = enc_body[12:]
        aesgcm = AESGCM(key)
        aad = f"{org}:{name}".encode("utf-8")
        try:
            return aesgcm.decrypt(nonce, ciphertext, aad).decode("utf-8")
        except Exception:
            return None

    if data.startswith(ENC_PREFIX_V1):
        enc_body = data[len(ENC_PREFIX_V1):]
        if len(enc_body) < 28:
            return None
        nonce = enc_body[:12]
        ciphertext = enc_body[12:]
        aesgcm = AESGCM(key)
        aad = f"{org}:{name}".encode("utf-8")
        try:
            return aesgcm.decrypt(nonce, ciphertext, aad).decode("utf-8")
        except Exception:
            return None

    return None


def read_secret_value(org: str, name: str) -> str | None:
    """Read and decrypt the secret value from disk.

    Supports both V1 and V2 encryption envelopes. If the secret file on disk
    is legacy plaintext (unencrypted), it is automatically migrated and
    encrypted in place on read.
    Returns the decrypted plaintext string, or None if not found, corrupted,
    or key cannot decrypt.
    NEVER leaks secret values in exceptions or logs.
    """
    path = _secrets_root() / org / name
    if not path.is_file():
        return None
    try:
        data = path.read_bytes()
    except OSError:
        return None

    key = _get_master_key()
    decrypted = _decrypt_secret_bytes(data, org, name, key)
    if decrypted is not None:
        return decrypted

    if data.startswith(ENC_PREFIX_V1) or data.startswith(ENC_PREFIX_V2):
        # Authenticated encryption failed with active key (wrong key or corrupted blob)
        return None

    # Legacy plaintext file — transparent in-place migration
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return None

    # Encrypt in place to complete the migration
    try:
        store_secret(name, org, text)
    except Exception:
        pass
    return text


def migrate_secrets() -> list[dict]:
    """Scan SECRETS_ROOT for legacy unencrypted secrets and encrypt them in place.

    Returns a list of migrated records: [{'org': ..., 'name': ...}].
    """
    migrated = []
    root = _secrets_root()
    if not root.is_dir():
        return migrated
    for org_dir in root.iterdir():
        if not org_dir.is_dir():
            continue
        org = org_dir.name
        for sec_file in org_dir.iterdir():
            if not sec_file.is_file() or sec_file.name == "master.key":
                continue
            try:
                data = sec_file.read_bytes()
                if not data.startswith(ENC_PREFIX_V1) and not data.startswith(ENC_PREFIX_V2):
                    val = data.decode("utf-8")
                    store_secret(sec_file.name, org, val)
                    migrated.append({"org": org, "name": sec_file.name})
            except Exception:
                pass
    return migrated


def rotate_master_key(
    new_key: bytes | str | None = None,
    old_key: bytes | str | None = None,
) -> dict:
    """Re-encrypt every stored secret under a new key atomically.

    RECOVERY & RESILIENCE STORY:
    - Master key location: The master encryption key lives at <data_root>/.secrets/master.key
      (or BALABOT_SECRETS_KEY / BALABOT_SECRETS_KEY_PATH).
    - Rotation command: Run `python -m balabot.orgs rotate-key` or call `rotate_master_key()`.
    - Lost key consequence: If the master key is lost, encrypted secrets cannot be recovered.
      AES-256-GCM is mathematically infeasible to decrypt without the key. Keep secure backups.
    - System resilience: When the secret store cannot be decrypted (e.g. key lost or corrupted),
      the rest of BalaBot still boots and functions normally. Reading secrets returns None, and
      secret_request returns 404 refused without crashing the container or host process.

    Safety:
    - Writes a timestamped backup of the store before rotation starts.
    - Stages re-encrypted secrets in a temporary staging directory to guarantee atomicity.
      A crash mid-rotation never leaves a half-encrypted store.
    - Blobs are re-encrypted in V2 format including the new key identifier:
      BALABOT_ENC_V2:<key_id>:<nonce><ciphertext>
    - Atomically updates master.key and secret metadata 'rotated_at' timestamps.
    """
    root = _secrets_root()
    resolved_old_key = _resolve_key(old_key) or _get_master_key()
    resolved_new_key = _resolve_key(new_key) or os.urandom(32)

    new_key_id = _key_identifier(resolved_new_key)

    # 1. Atomic backup of existing store before starting
    now_ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    backup_dir = root.parent / f".secrets_backup_{now_ts}_{uuid.uuid4().hex[:6]}"
    if root.exists():
        shutil.copytree(str(root), str(backup_dir))
    else:
        backup_dir.mkdir(parents=True, exist_ok=True)

    reg_path = _registry_path()
    if reg_path.exists():
        shutil.copy2(str(reg_path), str(backup_dir / "registry.json"))

    # 2. Stage new encrypted secrets in a temporary directory
    staging_dir = root.parent / f".secrets_staging_{uuid.uuid4().hex[:8]}"
    staging_dir.mkdir(parents=True, exist_ok=True)

    rotated_names = []
    try:
        # Write new master.key in staging
        staging_key_path = staging_dir / "master.key"
        fd = os.open(str(staging_key_path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(resolved_new_key)
        try:
            os.chmod(staging_key_path, 0o600)
        except OSError:
            pass

        # Re-encrypt all secrets across all orgs
        if root.is_dir():
            for org_dir in root.iterdir():
                if not org_dir.is_dir():
                    continue
                org = org_dir.name
                staging_org_dir = staging_dir / org
                staging_org_dir.mkdir(parents=True, exist_ok=True)
                for sec_file in org_dir.iterdir():
                    if not sec_file.is_file() or sec_file.name == "master.key":
                        continue
                    sec_name = sec_file.name
                    data = sec_file.read_bytes()
                    val = _decrypt_secret_bytes(data, org, sec_name, resolved_old_key)
                    if val is None:
                        # Attempt legacy plaintext
                        try:
                            val = data.decode("utf-8")
                        except UnicodeDecodeError:
                            val = None
                    if val is None:
                        raise ValueError(f"failed to decrypt secret {org}/{sec_name} with old key")

                    # Re-encrypt under new key with V2 header and key identifier
                    aesgcm = AESGCM(resolved_new_key)
                    nonce = os.urandom(12)
                    aad = f"{org}:{sec_name}".encode("utf-8")
                    ciphertext = aesgcm.encrypt(nonce, val.encode("utf-8"), aad)
                    new_payload = ENC_PREFIX_V2 + new_key_id.encode("ascii") + b":" + nonce + ciphertext

                    out_path = staging_org_dir / sec_name
                    fd = os.open(str(out_path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
                    with os.fdopen(fd, "wb") as fh:
                        fh.write(new_payload)
                    try:
                        os.chmod(out_path, 0o600)
                    except OSError:
                        pass
                    rotated_names.append((org, sec_name))

        # 3. Atomically swap staging_dir into root
        if root.exists():
            temp_old = root.parent / f".secrets_old_{uuid.uuid4().hex[:8]}"
            os.rename(root, temp_old)
            os.rename(staging_dir, root)
            shutil.rmtree(temp_old, ignore_errors=True)
        else:
            os.rename(staging_dir, root)
    except Exception:
        shutil.rmtree(staging_dir, ignore_errors=True)
        raise

    # 4. Update registry metadata timestamps atomically
    reg = load()
    now_str = _now()
    for sec_entry in reg.get("secrets", []):
        for o, n in rotated_names:
            if sec_entry.get("org") == o and sec_entry.get("name") == n:
                sec_entry["rotated_at"] = now_str
    save(reg)

    return {
        "ok": True,
        "rotated_count": len(rotated_names),
        "backup_path": str(backup_dir),
        "new_key_id": new_key_id,
    }


def backup_secrets(dest_dir: str | Path | None = None) -> Path:
    """Create a standalone backup of .secrets and orgs/registry.json."""
    root = _secrets_root()
    if dest_dir is None:
        now_ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        target = root.parent / f".secrets_backup_{now_ts}"
    else:
        target = Path(dest_dir)
    target.mkdir(parents=True, exist_ok=True)
    if root.exists():
        shutil.copytree(str(root), str(target / ".secrets"), dirs_exist_ok=True)
    reg_path = _registry_path()
    if reg_path.exists():
        shutil.copy2(str(reg_path), str(target / "registry.json"))
    return target


def verify_secrets_integrity() -> dict:
    """Check integrity of the secrets store against the org registry.

    Verifies master key existence, decodability, and that every registered
    secret can be decrypted and its fingerprint matches metadata.
    """
    errors = []
    checked = 0
    key = _get_master_key()
    if not key or len(key) != 32:
        return {"ok": False, "checked": 0, "errors": ["invalid or missing master key"]}

    reg = load()
    for s in reg.get("secrets", []):
        org = s.get("org")
        name = s.get("name")
        checked += 1
        val = read_secret_value(org, name)
        if val is None:
            errors.append(f"secret {org}/{name} missing or could not be decrypted")
            continue
        fp = fingerprint(val)
        if s.get("fingerprint") and fp != s.get("fingerprint"):
            errors.append(f"secret {org}/{name} fingerprint mismatch: expected {s.get('fingerprint')} got {fp}")

    return {"ok": len(errors) == 0, "checked": checked, "errors": errors}


def grant(subject_bot: str, resource: dict, *, subject_org: str, scope: str = "bot",
          access: str = "inject", created_by: str = "user") -> dict:
    """Create a grant. resource = {'kind': ..., 'name': ..., 'org'?}.

    resource_org comes from resource['org'] when present, else defaults to
    subject_org — that is how a CROSS-ORG grant arises (subject_org !=
    resource_org). No special case.
    """
    if access not in ACCESS_VALUES:
        raise ValueError(f"invalid access {access!r}: must be one of {sorted(ACCESS_VALUES)}")
    if scope not in SCOPE_VALUES:
        raise ValueError(f"invalid scope {scope!r}: must be one of {sorted(SCOPE_VALUES)}")
    if not isinstance(resource, dict) or "kind" not in resource or "name" not in resource:
        raise ValueError("resource must be a dict with 'kind' and 'name'")
    if resource["kind"] not in RESOURCE_KINDS:
        raise ValueError(
            f"invalid resource kind {resource['kind']!r}: must be one of {sorted(RESOURCE_KINDS)}")
    reg = load()
    _require_org(reg, subject_org)
    resource_org = resource.get("org", subject_org)
    _require_org(reg, resource_org)
    # Supersede any LIVE grant for the same (subject, resource). Without this,
    # re-saving a secret stacks a second live grant, and the delivery helper
    # (secret_lines_for) then emits the SAME env var once per stale grant — a
    # real bug found by exercising the product repeatedly rather than once.
    # The old record is revoked, never deleted: the audit trail is the point.
    for existing in reg["grants"]:
        if (existing.get("revoked_at") is None
                and existing.get("subject", {}).get("id") == subject_bot
                and existing.get("resource", {}).get("kind") == resource["kind"]
                and existing.get("resource", {}).get("name") == resource["name"]
                and existing.get("resource_org") == resource_org):
            existing["revoked_at"] = _now()
    g = {
        "id": f"g_{uuid.uuid4().hex[:12]}",
        "subject": {"kind": "bot", "id": subject_bot},
        "subject_org": subject_org,
        "resource": {"kind": resource["kind"], "name": resource["name"]},
        "resource_org": resource_org,
        "scope": scope,
        "access": access,
        "created_at": _now(),
        "created_by": created_by,
        "revoked_at": None,
    }
    reg["grants"].append(g)
    save(reg)
    return g


def revoke(grant_id: str) -> bool:
    """Set revoked_at. NEVER delete — the audit trail is the point."""
    reg = load()
    for g in reg["grants"]:
        if g["id"] == grant_id:
            if g["revoked_at"] is None:
                g["revoked_at"] = _now()
                save(reg)
            return True
    return False


def grants_for(bot_id: str, *, kind: str | None = None) -> list[dict]:
    """LIVE grants (revoked_at is None) for a bot: its own grants plus
    org-scope grants covering every bot in its org."""
    out = []
    for g in load()["grants"]:
        if g["revoked_at"] is not None:
            continue
        if kind is not None and g["resource"]["kind"] != kind:
            continue
        covered = (
            (g["scope"] == "bot" and g["subject"]["id"] == bot_id)
            or (g["scope"] == "org")
        )
        if covered:
            out.append(g)
    return out


def secrets_visible_to(bot_id: str) -> list[dict]:
    """[{name, org, fingerprint, granted, scope}] — metadata only, values never."""
    reg = load()
    rows = []
    for g in grants_for(bot_id, kind="secret"):
        secret = next(
            (s for s in reg["secrets"]
             if s["name"] == g["resource"]["name"] and s["org"] == g["resource_org"]),
            None,
        )
        rows.append({
            "name": g["resource"]["name"],
            "org": g["resource_org"],
            "fingerprint": secret["fingerprint"] if secret else "…",
            "granted": True,
            "scope": g["scope"],
        })
    return rows


# ---- read-only inspector CLI --------------------------------------------

def _fmt_grant(g: dict) -> str:
    origin = g["resource_org"]
    cross = "" if origin == g["subject_org"] else f" [cross-org from {g['subject_org']}]"
    return (
        f"  {g['id']}  {g['subject']['kind']}:{g['subject']['id']}"
        f" -> {g['resource']['kind']} {g['resource']['name']}"
        f" @ {origin}{cross}  scope={g['scope']} access={g['access']}"
        f" by={g['created_by']} at={g['created_at']}"
    )


def _cmd_list() -> int:
    orgs = list_orgs()
    if not orgs:
        print("no orgs registered")
        return 0
    for o in orgs:
        members = ", ".join(o["members"]) or "-"
        print(f"{o['id']}  ({o['name']})  members: {members}")
        if o.get("computer"):
            print(f"  computer: {json.dumps(o['computer'], sort_keys=True)}")
    return 0


def _cmd_grants(bot_id: str | None) -> int:
    grants = load()["grants"]
    if bot_id:
        grants = grants_for(bot_id)
    live = [g for g in grants if g["revoked_at"] is None]
    if not live:
        print("no live grants" + (f" for {bot_id}" if bot_id else ""))
        return 0
    for g in live:
        print(_fmt_grant(g))
    return 0


def _cmd_show(org_id: str) -> int:
    org = show_org(org_id)
    if org is None:
        print(f"unknown org: {org_id}", file=sys.stderr)
        return 1
    members = ", ".join(org["members"]) or "-"
    print(f"{org['id']}  ({org['name']})")
    print(f"  members: {members}")
    if org.get("computer"):
        print(f"  computer: {json.dumps(org['computer'], sort_keys=True)}")
    if org["grants"]:
        print("  live grants:")
        for g in org["grants"]:
            print(_fmt_grant(g))
    else:
        print("  live grants: none")
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv[:1] == ["list"]:
        return _cmd_list()
    if argv[:1] == ["grants"]:
        bot = argv[2] if len(argv) > 2 and argv[1] == "--bot" else None
        return _cmd_grants(bot)
    if argv[:2] == ["show"] and len(argv) == 3:
        return _cmd_show(argv[2])
    if argv[:1] == ["rotate-key"]:
        new_k, old_k = None, None
        for i, arg in enumerate(argv):
            if arg == "--new-key" and i + 1 < len(argv):
                new_k = argv[i + 1]
            elif arg == "--old-key" and i + 1 < len(argv):
                old_k = argv[i + 1]
        res = rotate_master_key(new_key=new_k, old_key=old_k)
        print(json.dumps(res, indent=2))
        return 0
    if argv[:1] == ["backup"]:
        dest = argv[2] if len(argv) > 2 and argv[1] == "--dest" else None
        p = backup_secrets(dest)
        print(json.dumps({"ok": True, "backup_path": str(p)}, indent=2))
        return 0
    if argv[:1] == ["verify"]:
        res = verify_secrets_integrity()
        print(json.dumps(res, indent=2))
        return 0 if res["ok"] else 1
    print("usage: python -m balabot.orgs list | grants [--bot X] | show <org> | rotate-key [--new-key K] [--old-key K] | backup [--dest D] | verify",
          file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())

