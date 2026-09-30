# FIX RUN F1 — duplicate assistant turn on a single user message

Review date: 2026-09-30 · Branch: `master` → pushed `origin master:main` ·
Impact: `ui/src/sessions.ts`, `ui/src/App.tsx`, `tests/e2e/ui_bridge_e2e.mjs`.

## Bug

One user message (*"I want to hire a marketing and SEO expert"*) rendered **the same
assistant turn twice** — identical intro + identical Agent Proposal card, stacked. The
server held **one** user row and **one** assistant row for that session. The turn ran
once; the duplication was client-side rendering.

## Confirmed mechanism (real runtime data, not code-reading)

`mergeServerMessages` in `ui/src/sessions.ts` is fed by **two delivery paths** on mount of
an active session (`ui/src/App.tsx:799-834`):

1. `getServerMessages(sessId)` → `mergeServerMessages(s.messages, res.messages)` — the REST fetch.
2. `subscribeSessionEvents(sessId, cb)` → `mergeServerMessages(s.messages, [serverMsg])` — the SSE
   fanout/catch-up replay (subscribed **without `sinceSeq`**, so `currentSeq` starts at 0 and the
   server replays the same rows the REST fetch just delivered — `ui/src/api.ts:385`).

A temporary counter (`globalThis.__mergeDiag`) inside `mergeServerMessages` recorded every append.
On a fresh F1-style session, the failing run showed **two appends**, one per delivery path:

```
diagAppends=[
 {in:[{role:assistant, hasMsgId:false, len:964, head:"On it. One thing before I file anything."}],
  appends:["assistant#seq=undefined#id=none@On it. One thing before I file"]},          <- App.tsx:1001 local finalMsg
 {in:[{role:assistant, hasMsgId:true, seq:3, len:966, head:"\n\nOn it. One thing before I file anythin"}],
  appends:["assistant#seq=3#id=m_1a0f374d057_0162c70a@\n\nOn it. One thing before I fi"]}          <- SSE server row
]
```

- **Copy A** is the **locally-completed** stream message appended by `App.tsx:1001`. It carries
  **no `id`, no `seq`**, and its `content` has been through `parseDraftsFromContent`
  (`ui/src/DraftCard.tsx:283-320`), which runs `.trim()` — so the local content (len 964) is not
  byte-identical to the server's stored row (len 966, which begins with `\n\n`).
- **Copy B** is the **server's authoritative row** pushed over SSE (`hasMsgId=true`, `seq=3`,
  `id=m_1a0f374d057_0162c70a`).

The dedupe match at `ui/src/sessions.ts:134-138` was:

```js
(sm.message_id && (m.id === sm.message_id || m.id === `msg-${sm.message_id}`))
|| (m.seq !== undefined && m.seq === sm.seq)
|| (m.role === sm.role && m.content === sm.content && (!m.seq || m.seq === sm.seq))
```

For the local copy vs the server row: clause 1 (no id on the local), clause 2 (no seq on the
local), and clause 3 (**content is not byte-identical — the client transformed it**) all fail, so
the server's authoritative copy was **appended as a second assistant turn**. End state:
`rendered=2 serverAssistant=1 localClient=2` with
`clientMsgs=[{user,seq:2,...},{assistant,seq:3,id:"m_1a0f37...",len:508},{assistant,len:506}]`.

> The transform that broke byte-equality is small in this trace (a two-byte `\n\n` trim via
> `parseDraftsFromContent.cleanContent`), but it is structural: any client-side mutation of the
> streamed content after the fact (draft-fence extraction, whitespace trim, future formatting)
> guarantees the content clause can never match, and the local message has no server identity for
> clauses 1/2 to grab. The old dedupe therefore **always** replicated any transformed turn.

## The fix

`mergeServerMessages` (`ui/src/sessions.ts:112-186`) now reconciles by **server identity +
turn position**, never by assuming the client copy's content is byte-identical:

1. **Identity/content match first** (unchanged clauses) → adopt `id/seq/created_at` onto the matched
   copy, in place.
2. **NEW — server-authoritative row echoes a local-only turn** (`ui/src/sessions.ts:144-158`): when
   an incoming message carries a server identity (`seq`/`message_id`) and no clause matched, the
   tail same-role copy that still has no server identity (`findLocalEcho`,
   `ui/src/sessions.ts:190-206`) is the same turn — the server row **adopts its identity onto that
   local copy** instead of appending a second copy. `findLocalEcho` only accepts a candidate that is
   the transcript tail (no later server-sequenced message), so a stale local from an earlier turn is
   never absorbed onto a later authoritative row.
3. **NEW — reverse order** (`ui/src/sessions.ts:160-170`): the SSE row may arrive *before* the
   client finishes building `finalMsg`. In that case a local-only incoming message whose
   predecessor tail is a same-role server-sequenced message is **folded into** the server row
   (identity kept, local fields like `drafts`/`thinking`/`toolCalls` preserved) instead of being
   appended.

Either arrival order now yields exactly one copy, carrying the server's stable identity. Verified
against the same harness: post-fix `rendered=1 serverAssistant=1 localClient=1`,
`clientMsgs=[{user,seq:2},{assistant,seq:3,id:"m_1a0f38...",len:671}]`.

## Regression scenario (RED → GREEN)

Added `f1SingleTurnRendersOnce` to `tests/e2e/ui_bridge_e2e.mjs` (registry `f1`). It drives the real
UI on a **fresh seeded session** (`s_f1_…` so the server transcript is exactly this one turn), sends
one message, waits for the stream bubble to appear and vanish plus a **stable assistant-bubble count
across two polls**, then asserts:

```js
rendered assistant bubbles  ===  server assistant rows  ===  1
```

This is the exact property the user reported broken (2 rendered ≠ 1 server row).

- **RED (current tree, pre-fix):** `FAIL — rendered=2 serverAssistant=1 serverUser=1 localClient=2`
- **GREEN (post-fix):** `PASS — rendered=1 serverAssistant=1 serverUser=1 localClient=1`

## Removal of the fabricated hire card

`ui/src/App.tsx` contained two hardcoded canned-content blocks keyed off the user's own phrasing,
which is product code branching on fixture text (forbidden by `docs/PROJECT-RULES.md`):

- `ui/src/App.tsx:984-988` (pre-removal) — in the happy path, if the outgoing text matched
  `/hire\s+(?:a|an)?\s*(?:marketing|seo|agent|expert)/i` and the model's reply did not already
  contain `openui-lang`/`HireAgentCard`, it **overwrote** the model's reply with a canned
  `HireAgentCard("Marketing & SEO Expert", …)`.
- `ui/src/App.tsx:1007-1010` (pre-removal) — the catch/abort path did the same to `partial`.

Both blocks are deleted. `const partial` is now `const` (no longer reassigned), and `finalMsg.content`
is `parsedDrafts.cleanContent` directly.

### Hire flow re-verified without the fabrication

A scratch driver replayed the exact request in the real app (this time without the regex): the
`principal` persona **itself emitted** the hire card:

```text
--- assistant row (seq=3 id=m_1a0f38c3303_789a5e6b) ---
Checked before filing: there's no marketing/SEO agent live. … Here's what I'd file, on your yes:

``openui-lang
root = HireAgentCard("Marketing & SEO Lead", "seo-lead", "Owns keyword and competitor research, on-page audits, and campaign/content plans.", "SEO audit, Keyword research, Content strategy, Competitor analysis")
``

Confirm the name and role and I'll file it for one-click approval.
```

`hasCard: true` in the rendered DOM, the client stored exactly one assistant turn (adopted
`seq=3`/`id=m_1a0f38c3303_789a5e6b`), and the server held exactly one assistant row — the hire
card renders because the **model** produces it, never because the client mines the user's words.
Scratch driver was deleted before finishing.

## What ran

- `npm run build` in `ui/` — **succeeded**, and that build **is** the UI deploy
  (`docs/PROJECT-RULES.md` §7), so the served SPA is the fixed bundle.
- UI harness `node tests/e2e/ui_bridge_e2e.mjs` (full): **39/42 runnable passed, 7 pending**,
  `f1` green. The three failures (W2-13 two-client interleave, W5-2, W6-13) are **pre-existing and
  unrelated** — they were already failing on the pre-fix full run (which also failed W2-15; that one
  now passes), and none touch the transcript-merge or hire-card paths. W2-13 is a live-fanout
  ordering scenario that is flaky under load; W5-2/W6-13 depend on the sibling's in-flight
  `balabot/queueing.py` work and live model behavior.
- API harness `python tests/e2e/bridge_api_e2e.py`: **36 passed / 0 failed / 12 pending** (0 failed
  holds; three formerly-pending W-scenarios now run live — a superset of the 33/0/15 baseline, not a
  regression).
- `python -m pytest tests -q -rs` (env from `.env.local`): **476 passed**.

## Not done

- Nothing of the product fix is left undone. Of the three persistent UI-harness failures
  (W2-13/W5-2/W6-13): W2-13 predates this change and is a live-fanout flake; W5-2 and W6-13 sit on
  the sibling's `balabot/queueing.py`/approval path, which is **not owned by this run** and was left
  untouched per the scope wall. They were not fixed here because doing so would touch a file
  (`queueing.py`) another agent owns this wave.
- The `__mergeDiag` instrumentation added by the previous attempt was fully removed from
  `ui/src/sessions.ts` before commit; debug scaffolding does not ship.