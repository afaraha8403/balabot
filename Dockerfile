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
# The per-org fleet manifests. The agent-computer run script is
# manifest-driven: with no fleet/ dir it finds zero declared agents and
# correctly goes DORMANT, which means NO Xvfb, NO cua-driver, NO sockets —
# the Agent Computer silently disappears. Repo copy alone is not enough;
# the manifest must ship inside the image. Caught by E2E against the rebuilt
# artifact (S5 principal+governor frames), not by unit tests.
COPY fleet/ /opt/balabot/fleet/
# The product UI: SPA source + FastAPI adapter. The SPA is BUILT in-image (see
# the RUN below); ui/node_modules and ui/dist are dockerignored so host build
# artefacts can never leak into the context.
COPY ui/ /opt/balabot/ui/
# The Jev continuity memory provider. Seeded into the DATA ROOT at boot by
# balabot.bootstrap.install_memory_plugin(): /opt/data is a named volume, so a
# COPY straight into it would be shadowed by the mount at runtime.
COPY hermes/ /opt/balabot/hermes/
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

# --- Agent Computer: a real screen per persona ------------------------------
# Core product surface, not optional: a bot with its own display the user can
# watch and drive. The driver is pinned by VERSION **and** SHA256 for the same
# reason cloudflared is — it is an execution path into the container (it can
# click and type), so an implicit upgrade must never happen underneath a user.
#
# The sha256 below is not a guess: it was verified against the GitHub release's
# own checksums.txt AND matched the binary running in the separate GrokBot
# stack (grokbot-computer) byte for byte. The permission manifest (/etc/cua/
# policy.json) is the SAME artefact that stack runs, copied verbatim, so the
# bounded capability set is identical rather than re-invented.
RUN DEBIAN_FRONTEND=noninteractive apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        xterm openbox dbus-x11 x11-xserver-utils \
 && rm -rf /var/lib/apt/lists/*

ARG CUA_DRIVER_VERSION=0.29.1
# TWO different artifacts, so TWO hashes. Checking one against the other's hash
# is a guaranteed build failure: the archive and the binary inside it never
# share a checksum. Both are pinned, and both are verified.
#   archive:  61a0c0f2…  (cua-driver-rs-0.29.1-linux-x86_64.tar.gz)
#   binary:   a9c32628…  (verified byte-identical to the cua-driver running in
#                         the separate GrokBot stack, which is where the pin
#                         originally came from)
ARG CUA_DRIVER_TARBALL_SHA256=61a0c0f24d6b03e31bb7a73390db875ecf0de2ce53aa435eadb03d70979d79a5
ARG CUA_DRIVER_SHA256=a9c3262817103cdff6c09e351f6a3410206624a6f40eea5bd14b4abb3ddf9362
RUN set -eux; \
    curl -fsSL -o /tmp/cua.tar.gz \
      "https://github.com/trycua/cua/releases/download/cua-driver-rs-v${CUA_DRIVER_VERSION}/cua-driver-rs-${CUA_DRIVER_VERSION}-linux-x86_64.tar.gz"; \
    echo "${CUA_DRIVER_TARBALL_SHA256}  /tmp/cua.tar.gz" | sha256sum -c -; \
    tar xzf /tmp/cua.tar.gz -C /tmp; \
    echo "${CUA_DRIVER_SHA256}  /tmp/cua-driver-rs-${CUA_DRIVER_VERSION}-linux-x86_64/cua-driver" | sha256sum -c -; \
    install -m 0755 "/tmp/cua-driver-rs-${CUA_DRIVER_VERSION}-linux-x86_64/cua-driver" \
                    /usr/local/bin/cua-driver; \
    rm -rf /tmp/cua.tar.gz /tmp/cua-driver-rs-*; \
    /usr/local/bin/cua-driver --version

# Bounded capability manifest for cua-driver (never run unbounded).
COPY docker/cua/ /etc/cua/

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
             /etc/s6-overlay/s6-rc.d/cloudflared/finish \
             /etc/s6-overlay/s6-rc.d/agent-computer/run \
             /etc/s6-overlay/s6-rc.d/agent-computer/finish \
             /etc/s6-overlay/s6-rc.d/balabot-ui/run \
             /etc/s6-overlay/s6-rc.d/balabot-ui/finish

# --- Product UI SPA: built IN-IMAGE ------------------------------------------
# ui/dist/ is gitignored (and dockerignored), so the image must build it. The
# base image ships Node 26 (verified: v26.5.1, npm 11.17.0) — no extra toolchain.
# The final `test -f` ASSERTS the build artefact exists at BUILD time: a broken
# SPA build fails the docker build, never first boot.
RUN set -eux; \
    cd /opt/balabot/ui; \
    npm ci --no-audit --no-fund; \
    npm run build; \
    test -f /opt/balabot/ui/dist/index.html

# Inherits the official ENTRYPOINT's job: validate the hard dependency, then
# exec /opt/hermes/docker/entrypoint-dispatch.sh so s6-overlay still owns PID 1.
ENTRYPOINT ["/usr/local/bin/balabot-entrypoint.sh"]
