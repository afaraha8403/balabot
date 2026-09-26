# Jev question patterns

Worked shapes for typed questions. `state` stays minimal — only what the
question needs. All examples are illustrative request shapes, not a fixed SDK.

## 1. Relevance filtering — one Noul per candidate

"Does anything here match?" is a *whether* question per item. Choice is
relative and would force a winner; Noul is absolute and can be low for all.

```python
questions = [
    {"kind": "noul", "id": f"rel_{i}",
     "text": "Is this passage relevant to the user's request?"}
    for i, passage in enumerate(candidates)
]
# keep candidate i if result[f"rel_{i}"] >= threshold (tuned for THIS noul)
```

Filter nothing on a shared threshold borrowed from another question shape.

## 2. Classification — Choice

One winner from a labelled set. Labels are fixed and known up front.

```python
decision = jev.ask(
    state={"message": user_message, "topics": TOPICS},
    questions=[{
        "kind": "choice",
        "id": "topic",
        "labels": TOPICS,          # e.g. ["billing", "bug", "feature", "other"]
        "text": "Which topic does this message belong to?",
    }],
)["topic"]  # -> winning label
```

## 3. Rubric scoring — Score

Ordered levels, 2..10. Define each level's meaning; Jev returns a level.

```python
decision = jev.ask(
    state={"diff_summary": pr_summary},
    questions=[{
        "kind": "score",
        "id": "risk",
        "levels": ["trivial", "minor", "notable", "major", "critical"],
        "text": "How risky is this change to deploy?",
    }],
)["risk"]  # -> a level
```

## 4. The decision gate — "is this decision-worthy?"

One Noul before spending effort on anything expensive (an agent run, a
notification, a deep analysis).

```python
gate = jev.ask(
    state={"event": event_payload},
    questions=[{"kind": "noul", "id": "worthy",
                "text": "Does this event require an agent to act?"}],
)["worthy"]
if gate < 0.9:   # tune per question; never reuse a Choice/Score threshold
    return       # not worth waking an agent
```

## 5. Confidence-gated routing

Never let a bare probability trigger an irreversible action. Gate on bands:

```python
p = decision.probability
if p >= 0.9:
    act()                    # high confidence — proceed
elif p >= 0.5:
    confirm_or_escalate()    # uncertain — ask a human / gather more state
else:
    do_not_act()             # below 0.5 — do nothing
```

For irreversible actions (send, spend, delete, publish), require the top band
AND an owning agent decision — Jev proposes, the agent owns the outcome.

## Calibration reminders

- Thresholds are per-question-shape: tune a Noul threshold on Noul outputs only.
- P(A) + P(not A) ≠ 1 when asked as two separate Nouls — never derive one from
  the other.
- Keep adversarial/untrusted text out of `state`; it can argue its own score.
