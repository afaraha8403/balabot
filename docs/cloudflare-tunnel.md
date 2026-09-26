# Cloudflare tunnel

BalaBot ships with a **Cloudflare tunnel baked into the image**. It is
**pre-wired and dormant**: the service is declared, supervised, and ready on
every install, and it does **nothing** until you supply a token. No port is
published, nothing is exposed, and no process lingers.

This is deliberate. A fresh install must not silently open a path into your
machine, but the moment you *do* want remote access there should be no yak-shaving.

## Bringing it up

**1. Create a tunnel in the Cloudflare dashboard** (Zero Trust → Networks →
Tunnels → Create a tunnel → *Cloudflared*). Copy the token it gives you.

**2. Supply the token.** Either the environment:

```bash
echo 'CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoi...' >> .env
```

…or, better, a mounted secret file:

```yaml
# docker-compose.yml
services:
  balabot:
    secrets: [cloudflare_tunnel_token]
secrets:
  cloudflare_tunnel_token:
    file: ./cloudflare_tunnel_token
```

```bash
echo 'CLOUDFLARE_TUNNEL_TOKEN_FILE=/run/secrets/cloudflare_tunnel_token' >> .env
```

**3. Restart the container.**

```bash
docker compose restart balabot
```

That's it. The token is all that is required — ingress and hostnames are
configured in the dashboard, not in the image (see *Where ingress lives* below).

## Where ingress lives

A **token-managed tunnel is configured remotely.** The hostname → service rules
live in the Cloudflare dashboard, and the local side needs no config file. That
is why this image ships no `config.yml`: there would be nothing in it to
pre-configure.

If you want a **locally-managed** tunnel instead (ingress as a file in your repo,
`.cloudflared/config.yml` plus a `cert.pem` and a tunnel UUID), that is a
different Cloudflare operating mode and is not wired here. Say so and we can add
it — it needs a credentials file, which is a secret, so it belongs on a mounted
volume rather than baked into the image.

## Posture — what this actually does

- **Outbound only.** `cloudflared` dials out to Cloudflare; the container
  publishes no ports. Nothing is reachable unless you publish a hostname.
- **Drops privileges.** The service runs as the unprivileged `hermes` user, like
  every other service in the image. A token tunnel needs no root.
- **No auto-update.** `--no-autoupdate` is set: a container's binary is pinned by
  the image tag and its checksum, so it must not rewrite itself at runtime.
- **The token never reaches a log.** The service logs that a token is present and
  nothing else — no value, no prefix, no length. It is passed via the
  **environment rather than argv**, so it never appears in a process command line
  (`ps aux` shows argv, not the environment) and cannot be harvested from a
  process listing. It remains readable to root via `/proc/<pid>/environ`, which
  is the standard trade-off for secret injection — use
  `CLOUDFLARE_TUNNEL_TOKEN_FILE` if you want it off the environment entirely.
  Same rule as every other secret here: *the interface is in the chat, the value
  never is.*

## Verifying it

Dormant (the default):

```bash
docker compose exec balabot /command/s6-svstat /run/service/cloudflared
# expect: down (exitcode 0) 1 seconds, normally up, ready 1 seconds
# note the ABSENCE of "want up" — that is s6 saying it will not restart it.
docker compose logs balabot | grep cloudflared
# expect: [cloudflared] DORMANT — no tunnel token configured, so nothing is exposed.
```

Enabled — and while it is up, a bad token makes cloudflared exit, which s6 then
restarts, so you will see `want up`:

```bash
docker compose logs balabot | grep cloudflared
# expect: [cloudflared] token present — starting tunnel (ingress is managed remotely)
docker compose exec balabot /command/s6-svstat /run/service/cloudflared
# expect: up (pid N) ... seconds      <- healthy
#     or: down (exitcode 255) ... want up   <- token rejected; s6 is retrying
```

The slot is declared but reports **down** when dormant rather than flapping in a
restart loop — the run script exits cleanly and the finish script returns `125`
("permanent failure, do not restart"), the same conditional-service pattern the
image's dashboard service uses. When a token *is* set and the tunnel later dies,
s6 restarts it.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Slot shows `down (exitcode 125)` | Expected. No token, so the tunnel is dormant. |
| `CLOUDFLARE_TUNNEL_TOKEN_FILE is set but not readable` | The secret isn't mounted where you pointed it. The tunnel will not start. |
| Tunnel starts then exits repeatedly | The token is wrong, revoked, or belongs to a deleted tunnel. Check the container log for cloudflared's own error; the credential itself is never echoed. |
| Nothing reachable after a successful start | Ingress lives in the dashboard for a token-managed tunnel — publish a hostname there pointing at the in-container service. |

## Why the binary is checksum-pinned

`cloudflared` is fetched at build time at a **pinned version with a pinned
SHA256**. It is an egress path into the container, so an implicit upgrade must
never happen underneath a user — the same reasoning that pins the base Hermes
tag. The pinned artifact is `cloudflared-linux-amd64`; building for another
architecture requires supplying that architecture's own checksum rather than
silently trusting a different binary.

To bump it deliberately: change `CLOUDFLARED_VERSION`, update
`CLOUDFLARED_SHA256` from the release's published checksum, rebuild, and re-run
the verification above.
