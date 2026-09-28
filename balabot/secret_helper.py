"""Command helper: print KEY=VALUE lines for the secrets a profile's bot is
GRANTED with access='inject'.

This is the helper Hermes' `secrets.command.command` extension point execs:
it writes the value ONLY to stdout, where Hermes injects each line as an
environment variable into the bot process. The bot can therefore use the
secret but never read the raw value from disk.

Hard rules:
- A value must never reach a log, an exception message, argv, or stderr.
- Only live grants with access == 'inject' deliver a value; access == 'read'
  means the operator may inspect it via orgs, not that bots receive it.
- Missing / undecodable / unreadable value files are skipped silently —
  an incomplete injection beats a leaked value in an error message.
- No registry (or no grants) => print nothing, exit 0.
"""

from __future__ import annotations

import argparse
import os
import sys

from balabot import orgs

__all__ = ["secret_lines_for", "env_for", "main"]


def _read_value(org: str, name: str) -> str | None:
    """Read <SECRETS_ROOT>/<org>/<name>; None on any failure. NEVER raise."""
    path = orgs._secrets_root() / org / name
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError, ValueError):
        return None
    if not isinstance(text, str):
        return None
    return text


def secret_lines_for(profile: str) -> list[str]:
    """Raw environment variable injection is discontinued for security (P0-4).

    Agents must use the server-side request-proxy tool `secret_request`
    instead of having raw credentials exposed in shell environment variables.
    Always returns [] so Hermes never injects org secrets into the agent's shell.
    """
    return []


def env_for(profile: str) -> dict[str, str]:
    """The same grants as a dict, suitable for an injected environment.

    Always returns {} as raw environment variable injection is discontinued.
    """
    return {}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m balabot.secret_helper",
        add_help=True,
    )
    # --profile is optional so the helper still works if a caller relies on the
    # environment instead. Order: explicit flag, then BALABOT_PROFILE, then
    # HERMES_PROFILE. bootstrap writes the flag literally, so this is belt and
    # braces rather than the primary path.
    parser.add_argument("--profile", required=False, default=None,
                        help="bot principal id (falls back to BALABOT_PROFILE / HERMES_PROFILE)")
    args = parser.parse_args(list(sys.argv[1:] if argv is None else argv))

    profile = args.profile or os.environ.get("BALABOT_PROFILE") \
        or os.environ.get("HERMES_PROFILE")
    if not profile:
        # Nothing to resolve is NOT an error: no profile means no grants, and
        # printing nothing is the correct, value-safe answer.
        return 0

    for line in secret_lines_for(profile):
        # The ONLY permitted output surface for a value is stdout, which
        # Hermes consumes for env injection.
        sys.stdout.write(line + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
