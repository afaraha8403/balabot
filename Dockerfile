# BalaBot — ONE image, built on the official Hermes Agent image.
#
# WHY NOT `FROM python:3.12-slim`:
#   The official image compiles a PATCHED SQLite (3.53.4, FTS5 enabled). Debian
#   trixie — which python:3.12-slim is built on — ships SQLite 3.46.1, which
#   carries the upstream WAL-reset corruption bug (hermes-agent #70480).
#   BalaBot's per-agent memory IS SQLite, so building on anything else risks
#   silent data loss in the exact subsystem we depend on.
#
# Building on the official image also inherits, for free:
#   - the s6-overlay supervision tree (the principal's job includes restarting
#     agents, so supervision is not optional infrastructure here)
#   - Node 26 (browser tooling)
#   - profile reconciliation cont-init hooks
#
# Pinned by TAG deliberately: this tag matches the Hermes release the personas
# were verified against. Bump it as a deliberate act, never implicitly.
FROM nousresearch/hermes-agent:v2026.9.24

ENV BALABOT_HOME=/opt/balabot \
    PYTHONPATH=/opt/balabot \
    BALABOT_DATA_ROOT=/opt/data

# BalaBot's Python package, skills, and persona templates.
COPY balabot/ /opt/balabot/balabot/
COPY skills/ /opt/balabot/skills/
COPY personas/ /opt/balabot/personas/
COPY entrypoint.sh /usr/local/bin/balabot-entrypoint.sh

# /data holds per-persona workspaces (rules files must live in the workspace,
# not the profile dir — see entrypoint.sh). compileall catches syntax errors at
# build time instead of at first boot.
# /opt/data is the image's HERMES_HOME (verified: HERMES_HOME=/opt/data). Persona
# workspaces live under it too, so ONE volume persists profiles, per-agent memory
# stores, the ledger, and the rules files together. compileall + an import check
# catch errors at build time instead of at first boot.
RUN chmod +x /usr/local/bin/balabot-entrypoint.sh \
    && mkdir -p /opt/data/workspace/principal /opt/data/workspace/governor \
    && python3 -m compileall -q /opt/balabot/balabot \
    && python3 -c "import balabot, balabot.bootstrap, balabot.jev, balabot.memory_relevance"

# Inherits the official ENTRYPOINT's job: validate the hard dependency, then
# exec /opt/hermes/docker/entrypoint-dispatch.sh so s6-overlay still owns PID 1.
ENTRYPOINT ["/usr/local/bin/balabot-entrypoint.sh"]
