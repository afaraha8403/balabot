# Agent Computer — /api/computer/{bot}/frame + /action

## Status: REAL (verified live)

The endpoints are wired to a real driver: `cua-driver` 0.29.1 talking to one
Xvfb display per bot inside `balabot-balabot-1`. There is no placeholder image
anywhere; every frame is decoded + PNG-verified before it is returned, and a
capture that fails verification returns an error, not a fallback.

## Live proof (2026-09-27, container balabot-balabot-1)

`docker exec` + `balabot/computer.py`, entirely inside the container:

1. `computer.check("principal")` → `{"available": true, "state": "ready",
   "width": 1920, "height": 1080}`.
2. `computer.frame("principal")` → real PNG, 1920×1080, RGBA, 57 KB.
3. Click at (640,400) → driver `get_cursor_position` → `{"x": 640, "y": 400}`
   (exact hit).
4. `type_text` "echo END2END-OK" + Enter → fresh frame shows the typed command
   AND its output line `END2END-OK` inside the xterm (vision-verified).
5. Refusals stay refusals: empty text, unknown bots, and lone unsupported keys
   all return `ok:false` with a named reason.

## Architecture (copied from the proven grokbot-computer stack)

Per agent: one Xvfb display + one `cua-driver serve` daemon + one socket.

    Xvfb :1 -screen 0 1920x1080x24 -nolisten tcp        # principal
    Xvfb :2 -screen 0 1920x1080x24 -nolisten tcp        # governor
    export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/session-bus
    dbus-daemon --session --fork --address=$DBUS_SESSION_BUS_ADDRESS
    DISPLAY=:1 openbox --sm-disable &                   # window manager
    DISPLAY=:1 cua-driver serve \
      --socket /run/cua-driver/principal.sock \
      --permission-mode bounded \
      --capability-manifest /etc/cua/policy.json \
      --approve-capability-manifest &

`balabot/computer.py` wraps `cua-driver call <tool> --args '{...}'`:

| UI action                       | driver tool            | notes |
|---------------------------------|------------------------|-------|
| click/doubleClick/rightClick    | `click`                | `target:{kind:"desktop",display_id:"primary"}`, `scope:"desktop"` |
| type text                       | `type_text`            | 2000-char cap |
| key "ctrl+c" (chord)            | `hotkey`               | driver requires modifier(s)+key |
| key "Return"/"Tab"/"Escape"...  | `type_text` ("\n"/...) | hotkey refuses lone keys (`keys` minItems 2, invalid_arguments) |
| scroll x,y,±amount              | `scroll`               | direction down/up |
| frame                           | `get_desktop_state`    | PNG b64; verified with PIL + magic + size cross-check |

## What the image needs (the ONE change left)

The running image lacked four things; three were proven fixable at runtime and
must be baked in. Exact Dockerfile addition:

```dockerfile
# Agent Computer: Xvfb ships in the base image; add the session stack + driver.
RUN DEBIAN_FRONTEND=noninteractive apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        xterm openbox dbus-x11 \
 && rm -rf /var/lib/apt/lists/*

# cua-driver, pinned to the SAME sha256 grokbot-computer runs.
#
# TWO artifacts, TWO hashes — an archive and the binary inside it never share a
# checksum, and checking one against the other's hash is a guaranteed build
# failure (learned the hard way: the first build died here).
#   archive: 61a0c0f24d6b03e31bb7a73390db875ecf0de2ce53aa435eadb03d70979d79a5
#            (cua-driver-rs-0.29.1-linux-x86_64.tar.gz, 33,634,849 bytes)
#   binary:  a9c3262817103cdff6c09e351f6a3410206624a6f40eea5bd14b4abb3ddf9362
#            (the extracted cua-driver, 56,430,648 bytes — byte-identical to the
#             binary running in grokbot-computer, which is where the pin came from)
# Source: github.com/trycua/cua release tag cua-driver-rs-v0.29.1
ARG CUA_DRIVER_VERSION=0.29.1
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
```

And the session supervisor (s6 longrun, mirroring
`docker/s6-rc.d/cloudflared/`'s dormant-slot pattern), e.g.
`docker/s6-rc.d/agent-computer/run`:

```sh
#!/command/with-contenv sh
export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/session-bus"
mkdir -p /run/cua-driver
dbus-daemon --session --fork --address="$DBUS_SESSION_BUS_ADDRESS" 2>/dev/null || true
i=1
for agent in principal governor; do
  d=":$i"
  Xvfb "$d" -screen 0 1920x1080x24 -nolisten tcp &
  sleep 0.5
  DISPLAY="$d" openbox --sm-disable >/tmp/openbox-$agent.log 2>&1 &
  DISPLAY="$d" /usr/local/bin/cua-driver serve \
    --socket "/run/cua-driver/$agent.sock" \
    --permission-mode bounded \
    --capability-manifest /etc/cua/policy.json \
    --approve-capability-manifest \
    >/tmp/cua-driver-$agent.log 2>&1 &
  i=$((i+1))
done
wait
```

Copy `/etc/cua/policy.json` from grokbot-computer verbatim (it allows
`click`, `type_text`, `hotkey`, `scroll`, `get_desktop_state`, … and the
desktop resource) and add it to the Dockerfile with a `COPY`.

## Honest unavailable contract

Until the image change above is built/redeployed, a freshly recreated
container will answer `{"available": false, "state": "no-driver", "reason":
"driver socket /run/cua-driver/principal.sock does not exist — the
agent-computer service is not running"}`. That is the honest state — it names
the exact missing socket, never a fabricated frame.

## Removed this wave

The old `available:false` ("no computer-use driver is wired to this adapter")
was wrong the moment the plan was approved: the driver is wired now. The vault
doc's "pane is DONE" claim was also ahead of reality until today's live proof.
