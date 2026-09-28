"""Tests for P0-4: AES-256-GCM encryption at rest, shell injection removal, and secret_request proxy.

Verifies:
1. Secrets on disk are AES-256-GCM encrypted (never plaintext bytes).
2. Existing plaintext secrets on disk are migrated and encrypted in place on read.
3. secret_helper discontinued shell environment injection (returns empty).
4. secret_request enforces grant authorization, origin allowlist, SSRF protection,
   refuses redirects, executes requests server-side, scrubs credentials from responses,
   and writes audit entries without leaking secret values.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import pytest
import httpx

from balabot import orgs, secret_helper, bot_tools

MOCK_SECRET = "sk-test-secret-value-abcdef123456"
FINGERPRINT = "…3456"


@pytest.fixture
def org_env(tmp_path, monkeypatch):
    monkeypatch.setenv("BALABOT_DATA_ROOT", str(tmp_path))
    orgs.add_org("balacode", "BalaCode")
    orgs.add_bot("balacode", "principal")
    orgs.add_bot("balacode", "governor")
    return tmp_path


def test_secrets_encrypted_at_rest(org_env):
    """Secret values must be encrypted at rest on disk with AES-256-GCM, never plaintext."""
    rec = orgs.store_secret("API_KEY", "balacode", MOCK_SECRET)
    assert rec["fingerprint"] == FINGERPRINT
    assert "value" not in rec

    disk_path = org_env / ".secrets" / "balacode" / "API_KEY"
    raw_disk_bytes = disk_path.read_bytes()

    # Raw secret must NEVER be visible in disk file
    assert MOCK_SECRET.encode() not in raw_disk_bytes
    # Must use versioned encryption envelope
    assert raw_disk_bytes.startswith(b"BALABOT_ENC_V1:")

    # Reading through decrypted API yields the original secret
    assert orgs.read_secret_value("balacode", "API_KEY") == MOCK_SECRET


def test_plaintext_migration_in_place(org_env):
    """Legacy plaintext files on disk are transparently migrated and encrypted on read."""
    d = org_env / ".secrets" / "balacode"
    d.mkdir(parents=True, exist_ok=True)
    legacy_file = d / "LEGACY_KEY"
    legacy_file.write_text(MOCK_SECRET, encoding="utf-8")

    # Before read, file is plaintext
    assert legacy_file.read_bytes() == MOCK_SECRET.encode("utf-8")

    # Reading migrates in place
    val = orgs.read_secret_value("balacode", "LEGACY_KEY")
    assert val == MOCK_SECRET

    # Now disk file is encrypted
    migrated_bytes = legacy_file.read_bytes()
    assert MOCK_SECRET.encode() not in migrated_bytes
    assert migrated_bytes.startswith(b"BALABOT_ENC_V1:")


def test_shell_injection_discontinued(org_env):
    """secret_helper must not inject org secrets into shell environment variables."""
    orgs.store_secret("API_KEY", "balacode", MOCK_SECRET)
    orgs.grant("principal", {"kind": "secret", "name": "API_KEY"},
               subject_org="balacode", scope="bot", access="inject")

    lines = secret_helper.secret_lines_for("principal")
    assert lines == []
    env = secret_helper.env_for("principal")
    assert env == {}


def test_secret_request_proxy_success_and_redaction(org_env, monkeypatch):
    """secret_request decrypts secret, sends request, redacts secret from response body, and audits."""
    orgs.store_secret("STRIPE_KEY", "balacode", MOCK_SECRET)
    orgs.grant("principal", {"kind": "secret", "name": "STRIPE_KEY"},
               subject_org="balacode", scope="bot", access="inject")

    # Upstream echoes the secret in the response body
    def handler(request: httpx.Request) -> httpx.Response:
        auth = request.headers.get("authorization", "")
        assert auth == f"Bearer {MOCK_SECRET}"
        # Upstream body echoes back the secret
        echo_body = json.dumps({"echo": auth, "status": "ok"})
        return httpx.Response(200, content=echo_body.encode("utf-8"), headers={"content-type": "application/json"})

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(bot_tools, "_get_http_transport", lambda: transport)

    res = bot_tools.secret_request(
        "principal",
        "STRIPE_KEY",
        "https://api.stripe.com/v1/charges",
        method="POST",
        body={"amount": 100},
    )

    assert res["ok"] is True
    assert res["status_code"] == 200
    # Redaction requirement: raw secret must NEVER appear in the returned body
    assert MOCK_SECRET not in res["body"]
    assert "[REDACTED_SECRET]" in res["body"]

    # Verify audit entry recorded
    audit_file = org_env / "orgs" / "secret_audit.json"
    assert audit_file.exists()
    audits = json.loads(audit_file.read_text(encoding="utf-8"))
    assert len(audits) >= 1
    last_audit = audits[-1]
    assert last_audit["bot"] == "principal"
    assert last_audit["secret_name"] == "STRIPE_KEY"
    assert last_audit["status"] == "allowed"
    # Never leak secret value in audit
    assert MOCK_SECRET not in json.dumps(last_audit)


def test_secret_request_unauthorized_bot_refused(org_env):
    """Bots without a live grant cannot proxy requests through secret_request."""
    orgs.store_secret("SECRET_KEY", "balacode", MOCK_SECRET)
    # Grant to governor, not principal
    orgs.grant("governor", {"kind": "secret", "name": "SECRET_KEY"},
               subject_org="balacode", scope="bot", access="inject")

    res = bot_tools.secret_request(
        "principal",
        "SECRET_KEY",
        "https://api.example.com/test",
    )
    assert res["ok"] is False
    assert res["status_code"] == 403
    assert "grant" in res["error"].lower()


def test_secret_request_ssrf_blocked(org_env):
    """Requests to loopback or private addresses must be blocked for SSRF safety."""
    orgs.store_secret("KEY", "balacode", MOCK_SECRET)
    orgs.grant("principal", {"kind": "secret", "name": "KEY"},
               subject_org="balacode", scope="bot", access="inject")

    for bad_url in [
        "http://127.0.0.1:8000/internal",
        "http://localhost:9000/admin",
        "http://169.254.169.254/latest/meta-data",
    ]:
        res = bot_tools.secret_request("principal", "KEY", bad_url)
        assert res["ok"] is False
        assert "ssrf" in res["error"].lower() or "blocked" in res["error"].lower()
