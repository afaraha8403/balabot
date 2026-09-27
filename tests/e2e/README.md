# BalaBot Docker E2E Harness

`e2e_docker.sh` builds the real BalaBot image and exercises the real
container — the same container a user gets from `docker compose up`.

## Run it

```bash
cd tests/e2e
./e2e_docker.sh                 # builds and tests balabot:test
./e2e_docker.sh balabot:mine    # or any image tag
```

Optional: export `OPENROUTER_API_KEY` (or `MODEL_API_KEY`) to also run a live
model round-trip. A key is never printed by the harness.

## What it asserts

1. **Image builds** from the repo root with the given tag.
2. **Hard dependency enforced** — running the image with no
   `TYPESAFE_API_KEY` exits 1 and prints a loud message about Jev being a
   hard dependency with no fallback. This is a deliberate design invariant;
   the harness fails if the entrypoint ever degrades silently.
3. **Provisioning** — with a (dummy) key set and the container started via
   the **real entrypoint** (detached + TTY, probed with `docker exec`), both
   `/opt/data/profiles/principal` and `/opt/data/profiles/governor` exist,
   each with `config.yaml` + `SOUL.md`, each workspace has `AGENTS.md`, and
   each has `skills/balabot/jev-signals/SKILL.md`.
4. **Forced config deltas** — the principal's rendered config has
   `memory.provider: holographic` and an **empty** `telegram.bot_token`
   (one shared Telegram token would make two gateways race).

## What is skipped without a key

Step 5 — a live model round-trip asserting the reply contains `BALABOT_OK` —
requires a real `OPENROUTER_API_KEY`/`MODEL_API_KEY`. Without one, the
harness prints `SKIP:` for that step. A skip is **not** a pass; nothing is
fabricated. With a key, the step fails loudly if the reply lacks
`BALABOT_OK`.

## Do not "fix" the harness with `--entrypoint sh`

Overriding the entrypoint skips the s6-overlay `cont-init` hooks (including
`015-supervise-perms`) and produces misleading errors like
`Permission denied: .../profiles/<x>/cron`. Always go through the real
entrypoint: `docker run -d -t ...` then `docker exec`.

## UI-level harnesses (stealth browser, real DOM)

Two Node harnesses drive the **real product UI** through CloakBrowser and assert on
rendered state (never prose, never screenshots):

```bash
node tests/e2e/ui_e2e.mjs            # core product scenarios (auth, shell, chat, org…)
node tests/e2e/ui_thinking_e2e.mjs   # agent reasoning: hidden by default, toggle, collapsible
```

`ui_thinking_e2e.mjs` seeds a session with a canary reasoning string and asserts it
never reaches the DOM while the "Show thinking" switch is off — so removing the
render gate fails the suite (verified: 19/19 with the gate, 17/19 without).

## Notes

- The interactive-CLI default command printing a banner and exiting 0 with no
  TTY (`Input is not a terminal`) is expected Hermes behaviour, not a crash.
- The harness is idempotent: it names its container uniquely per run and
  removes it on exit (success, failure, or interrupt).
