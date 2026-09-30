# W4 — Secret-Store HTTP Perimeter: Live Acceptance

Review date: 2026-09-30 · Adapter: `ui/server.py` on `http://127.0.0.1:9119` · Runtime artifact: `balabot-balabot-1` container
Harness: `python tests/e2e/bridge_api_e2e.py` (the nine former `pending("W4-…")` stubs are now real scenarios)

## What was tested

The secret-proxy perimeter is executed **in-container exactly as Hermes invokes it**
(`python3 -m balabot.bot_tools secret_request …`), not through a test-only HTTP shim.
Setup (org / secret / grant) goes through the **real** `/api/org/*` HTTP surface, and the
audit trail is read back from the container's own store. Nothing in `balabot/**` or
`ui/**` was changed and nothing keys off test strings (constraint #1 is satisfied — no
product edit was needed at all).

## Endpoints each scenario exercises

| Scenario | HTTP setup endpoint | In-container execution | Audit read-back |
|---|---|---|---|
| W4-3 tools never return secret value | `POST /api/org/secrets` · `GET /api/org/grants` | `list_org_secrets`, `secret_request` | — |
| W4-4 non-allowlisted origin refused | `POST /api/org/secrets` | `secret_request` | `POST /api/org/grants/{id}/revoke` (cleanup) |
| W4-5 loopback/link-local blocked | `POST /api/org/secrets` | `secret_request` × 5 destinations | — |
| W4-6 redirect refusal | `POST /api/org/secrets` | `secret_request` | — |
| W4-7 response redaction | `POST /api/org/secrets` | `secret_request` against an echoing origin | — |
| W4-9 audit records every attempt | `POST /api/org/secrets` | `secret_request` × 4 (mixed refused/allowed) | container `orgs/secret_audit.json` |
| W4-10 audit stores no value | `POST /api/org/secrets` · `POST /api/org/grants` | `secret_request` (query-string URL) | container `orgs/secret_audit.json` |
| W4-13 non-granted bot gets nothing | `POST /api/org/secrets` | `secret_request`, `list_org_secrets` (ungranted bot) | — |
| W4-15 secret never enters LLM prompt | `POST /api/sessions` · `POST /api/sessions/{id}/messages` · `POST /api/chat` (SSE) | `secret_request` against an echoing origin | container registry |

The live upgrade/list/revoke surfaces (`GET /api/orgs`, `GET /api/org/secrets`,
`GET /api/org/grants`, `POST /api/org/grants`, `POST /api/org/grants/{id}/revoke`)
are exercised indirectly by the fixture lifecycle of every scenario.

## Where each control is enforced (`file:line` on the shipped code)

| Control | Enforced at |
|---|---|
| Tools never return a value (result envelope is metadata-only) | `balabot/bot_tools.py` — `list_org_secrets` (274–300), `request_secret` (226–272) |
| Grant gating (request refused before any I/O) | `balabot/bot_tools.py:697–706` (`orgs.grants_for`) · `balabot/orgs.py:688–703` |
| Per-secret origin allowlist | `balabot/bot_tools.py:710–722` (reads `allowed_origins` from the registry record) |
| SSRF: loopback/link-local/private/reserved/unspecified (resolve-time) | `balabot/bot_tools.py:724–731` (string check) + `:734–743` (`ipaddress` literal check) + `:746–761` (DNS resolve check) |
| SSRF: rebinding + peer verification (connect-time defence-in-depth) | `balabot/bot_tools.py:96–130` (`_PinnedSyncBackend.connect_tcp`), pinned transport `:133–141` |
| Redirect refusal | `balabot/bot_tools.py:793` (`httpx.Client(..., follow_redirects=False, ...)`) |
| Response redaction (body + headers) | `balabot/bot_tools.py:815–824` |
| Audit records every attempt (refused + allowed, no value, no raw URL/query) | `balabot/bot_tools.py:616–660` (`_record_secret_audit`), called at every refusal/error/allowed point |
| Value at rest is AES-256-GCM, fingerprint-only metadata | `balabot/orgs.py:292–342` (`store_secret`), `:386–424` (`read_secret_value`), `:88–92` (`fingerprint`) |
| Registry is append-only for grants (revoke sets `revoked_at`) | `balabot/orgs.py:676–685` |
| HTTP upload never echoes the value | `ui/server.py:1292–1333` (`POST /api/org/secrets`; value only via the `_BALABOT_ORG_PAYLOAD` env in `_org_run`) |

## The nine outcomes (final GREEN run)

```
[ ok ] W4-3  tools never return secret value        list listed the secret True, request envelope value-free True
[ ok ] W4-4  non-allowlisted origin refused         HTTP-ish 403 origin 'https://httpbin.org' not in allowed origins for secret '…_a'
[ ok ] W4-5  loopback/link-local blocked            5/5 prohibited destinations refused
[ ok ] W4-6  redirect refusal                       3xx surfaced un-followed (302)
[ ok ] W4-7  response redaction                     redacted 200
[ ok ] W4-13 non-granted bot gets nothing           request refused, granted flag off True, value-free True
[ ok ] W4-9  audit records every attempt            audit grew 4 (expected 4)
[ ok ] W4-10 audit stores no value                  credential absent from every audit row
[ ok ] W4-15 secret never enters LLM prompt         tool result clean True; registry clean True; SSE HTTP 200, value-free across stream+transcript True

24 passed, 0 failed, 23 pending   (pending = feature not built — never folded into passes)
```

Every scenario carries an explicit **fails-if** note next to its assertion (e.g. W4-5
"fails if: the proxied client can reach loopback/link-local/private targets").

## Mutation proofs (RED → restore → GREEN), applied to the running artifact

The container's `/opt/balabot` is a **snapshot, not a bind mount** (only `/opt/data` is a
volume), so the mutations were applied inside the running container — the artifact the
harness actually drives — and restored byte-for-byte from the committed tree afterwards
(`docker cp balabot/bot_tools.py balabot-balabot-1:/opt/balabot/balabot/bot_tools.py`).

### Proof 1 — disable the SSRF guard (W4-5)

Mutation: replaced `ip.is_loopback or ip.is_private or ip.is_link_local or ip.is_reserved
or ip.is_unspecified` with `False` at both single-line enforcement points (resolve-time
literal check at `bot_tools.py:736` and the pinned-transport rebinding pre-check at
`:100`), so the link-local `169.254.169.254` and private `10.10.10.10` destinations pass
the guard. RED:

```
[FAIL] W4-5 loopback/link-local blocked  3/5 prohibited destinations refused  [fails if: the proxied client can reach …
--- W4 only: 8 passed, 1 failed
```

The three string-blocked cases (`127.0.0.1`, `localhost`, `::1`) stayed refused — the
test isolates exactly the disabled layer. Restored → GREEN:

```
[ ok ] W4-5 loopback/link-local blocked  5/5 prohibited destinations refused
--- W4 only (restored): 9 passed, 0 failed
```

Noted finding: the SSRF policy is **defence-in-depth** — dropping only the resolve-time
check stays GREEN because `_PinnedSyncBackend.connect_tcp` re-verifies the destination
and the actual socket peer at connect time (`bot_tools.py:96–130`). Both layers must be
removed to reach the vulnerable state.

### Proof 2 — make the audit persist the value (W4-10)

Mutation: the allowed-path audit call gained `reason=secret_val`
(`_record_secret_audit(..., "allowed", reason=secret_val, ...)` at the call in
`bot_tools.py:826`), so the trail now stores the plaintext credential. RED:

```
[FAIL] W4-10 audit stores no value  credential absent from every audit row  [fails if: the audit trail persists the value, …
--- W4 only: 8 passed, 1 failed
```

Restored → GREEN:

```
[ ok ] W4-10 audit stores no value  credential absent from every audit row
--- W4 only (restored): 9 passed, 0 failed
```

## Regression bar

- `python tests/e2e/bridge_api_e2e.py` → **24 passed, 0 failed, 23 pending** (W1-*, W2-*,
  W3-*, W6-*, W8-*, W9-9, Polaris guards unchanged and green).
- `pytest tests -q -rs` (env sourced) → **476 passed**, no regression, no product code touched.

## Gaps found and anything not done

1. **No byte-level prompt recorder.** The review's ideal W4-15 proof — a payload-recording
   upstream stub that logs the exact bytes sent to the model — does not exist (it was never
   built; the shared W1/W6 stub is also absent). W4-15 instead proves the strongest real
   property available: the secret value is absent from **every surface that can feed a
   prompt** — the tool result the model reads (stdout of the proxied call against an
   origin that reflects the credential), the org registry metadata, a **real** stored
   transcript, and a **real** `/api/chat` SSE stream assembled from that transcript. An
   honest surface-level proof, not a fabricated byte-level pass.
2. **`allowed_origins` is not configurable over HTTP.** `POST /api/org/secrets` and the
   UI have no way to set a secret's origin allowlist; only `orgs.store_secret(...,  allowed_origins=...)`
   (not exposed via HTTP) can. W4-4 seeds it through the container's own `orgs.load/save`
   so the control is still exercised end to end. Exposing the field on the HTTP route is
   the natural follow-up if operators need to configure allowlists from the UI.
3. **The audit trail is not queryable over HTTP.** There is no audit endpoint; W4-9/W4-10
   read `orgs/secret_audit.json` from the container (append-only by design). An operator-facing
   read endpoint would be the gap to close for observability.
4. **Mutations were proven against the container's copy** of `bot_tools.py`, because the
   harness drives the container CLI. The host tree's `balabot/bot_tools.py` is byte-identical
   to what was restored into the container; no product file was left altered.