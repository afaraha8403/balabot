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

# --- Cloudflare tunnel: baked in, DORMANT by default -------------------------
# Every install ships the tunnel pre-wired so the operator only has to add a
# token; nothing runs until they do. The s6 slot is declared but reports DOWN
# when no token is configured — see docker/s6-rc.d/cloudflared/.
#
# Pinned by VERSION **and** SHA256, not just a URL. This binary is an egress
# path into the container, so an implicit upgrade must never happen underneath
# a user — the same reasoning as pinning the base Hermes tag above.
#
# amd64 deliberately: that checksum was verified against
# cloudflared-linux-amd64. Another architecture must supply its own checksum
# rather than silently trusting a different artifact.
ARG CLOUDFLARED_VERSION=2026.9.3
ARG CLOUDFLARED_SHA256=77e26d8d900e0b8469f416239d14b5f296525fdf79fee6f511ef55609e3fbac2
RUN set -eux; \
    curl -fsSL -o /usr/local/bin/cloudflared \
        "https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-amd64"; \
    echo "${CLOUDFLARED_SHA256}  /usr/local/bin/cloudflared" | sha256sum -c -; \
    chmod +x /usr/local/bin/cloudflared; \
    /usr/local/bin/cloudflared --version

# Merges into /etc/s6-overlay/s6-rc.d/, adding the cloudflared service alongside
# the image's existing dashboard/main-hermes services and joining the user bundle.
COPY docker/s6-rc.d/ /etc/s6-overlay/s6-rc.d/

# s6 requires the service scripts to be executable. Do NOT trust the checkout's
# file mode: Windows filesystems have no exec bit, so a repo cloned there builds
# with 0644 while a Linux clone builds with 0755 — the tunnel would then start
# for one developer and silently fail for another. Set it explicitly.
RUN chmod +x /etc/s6-overlay/s6-rc.d/cloudflared/run \
             /etc/s6-overlay/s6-rc.d/cloudflared/finish

# Inherits the official ENTRYPOINT's job: validate the hard dependency, then
# exec /opt/hermes/docker/entrypoint-dispatch.sh so s6-overlay still owns PID 1.
ENTRYPOINT ["/usr/local/bin/balabot-entrypoint.sh"]
