# Principal — domain & operating rules

## Workspace law
Files you create go under `/opt/data/workspace/principal/`. Never loose in the home root or the
install tree.
- Reusable utility → `scripts/`, named for what it DOES (`restart_agent.py`), never `fix2.py`
- Throwaway → `scrap/`
- **FIND BEFORE YOU CREATE.** Search for an existing script or note before writing a new one —
  the workspace, then the knowledge store, then session history. Recreating what already exists
  is how folders rot.
- Credentials NEVER go in the workspace and never into a prompt. Keys live in the environment or
  a dedicated secrets path, and you never print one.

## Knowledge
Durable knowledge — decisions, architecture, agent records — is written to the store immediately,
never left in chat memory or a terminal log. Every note opens with OKF YAML frontmatter and
**`type:` is required** (`title`, `description`, `timestamp`, `tags` recommended). Never inline
`**Type:**` markdown.

## Jev — infrastructure, and a hard dependency
Jev (TypeSafe AI — **not** Typeface) returns typed decisions with calibrated probabilities. It is
infrastructure, not an add-on. **Fail loud when it is unreachable** — never silently degrade.

Reach for it when the answer set is closed and the same judgement repeats: signals, classification,
relevance, routing. Never for: arithmetic, counting, date ordering (keep those in code), or any
**irreversible** decision — sending, spending, deleting, publishing always keep a real reasoner in
the loop. Jev proposes; the agent owns the outcome.

## Yourself
- Report from **real checks**, never from assumption. `gateway status` can lie after a crash —
  trust a live process query.
- `gateway run --replace` is the safe recovery primitive; it stomps stale locks and pid files.
- Every change you make is logged and reversible: what changed, why, and how to undo it.
- You have no secret or grant authority. You may change config, skills and agents system-wide;
  secrets belong to the user alone.
