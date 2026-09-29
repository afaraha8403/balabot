import {useCallback, useEffect, useState} from 'react';
import {
  approveBotProposal,
  createApprovedBot,
  createBotProposal,
  getBotProposals,
  rejectBotProposal,
  type BotProposal,
} from './api';

type Props = {
  onCancel: () => void;
  onFleetChanged?: () => void;
};

const STATUS_COLOR: Record<BotProposal['status'], string> = {
  proposed: 'var(--warning, #eab308)',
  approved: 'var(--success, #22c55e)',
  rejected: 'var(--destructive, #ef4444)',
  registered: 'var(--success, #22c55e)',
};

/**
 * Polaris right-panel CreateBotForm with the bot-creation proposal consent seam:
 * Propose -> human approval -> create -> fleet registration.
 * Nothing is created without explicit human approval.
 */
export function CreateBotForm({onCancel, onFleetChanged}: Props) {
  const [proposals, setProposals] = useState<BotProposal[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [unavailableReason, setUnavailableReason] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [proposer] = useState('user');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await getBotProposals();
      if (r.available === false) {
        setAvailable(false);
        setUnavailableReason(r.reason ?? 'unavailable');
        return;
      }
      setAvailable(true);
      setProposals(r.proposals ?? []);
    } catch (e) {
      setAvailable(false);
      setUnavailableReason((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const propose = async () => {
    if (!name.trim() || !role.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createBotProposal({
        name: name.trim(),
        role: role.trim(),
        proposed_by: proposer,
      });
      setName('');
      setRole('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pending = proposals.filter(p => p.status === 'proposed');
  const decided = proposals.filter(p => p.status !== 'proposed');

  return (
    <div data-testid="create-bot-form" style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
      {/* Header */}
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '1px solid var(--border)'}}>
        <div>
          <h3 style={{margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--foreground)'}}>
            Create a bot
          </h3>
          <p style={{margin: '2px 0 0', fontSize: '12px', color: 'var(--muted-foreground)'}}>
            Propose → you approve → create &amp; register.
          </p>
        </div>
        <button
          type="button"
          aria-label="Cancel new bot"
          onClick={onCancel}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--muted-foreground)',
            cursor: 'pointer',
            padding: '4px',
            borderRadius: '4px',
            display: 'inline-flex',
            alignItems: 'center',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {error ? (
        <div
          role="alert"
          style={{
            padding: '8px 12px',
            fontSize: '12.5px',
            color: 'var(--destructive)',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            borderRadius: '6px',
          }}
        >
          {error}
        </div>
      ) : null}

      {available === false ? (
        <div
          style={{
            padding: '8px 12px',
            fontSize: '12.5px',
            color: 'var(--warning, #eab308)',
            backgroundColor: 'rgba(234, 179, 8, 0.1)',
            borderRadius: '6px',
          }}
        >
          Proposals unavailable: {unavailableReason}
        </div>
      ) : null}

      {/* Proposal form */}
      <div style={{display: 'flex', flexDirection: 'column', gap: '12px'}}>
        <div>
          <label
            htmlFor="create-bot-name-input"
            style={{display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--muted-foreground)', marginBottom: '4px'}}
          >
            Name
          </label>
          <input
            id="create-bot-name-input"
            className="polaris-input"
            value={name}
            placeholder="e.g. Research Scout"
            onChange={e => setName(e.target.value)}
          />
          <span style={{fontSize: '11.5px', color: 'var(--muted-foreground)', marginTop: '2px', display: 'block'}}>
            Becomes the bot’s fleet id (slugified).
          </span>
        </div>

        <div>
          <label
            htmlFor="create-bot-role-input"
            style={{display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--muted-foreground)', marginBottom: '4px'}}
          >
            Role &amp; description
          </label>
          <textarea
            id="create-bot-role-input"
            value={role}
            placeholder="What is this bot for?"
            onChange={e => setRole(e.target.value)}
            rows={3}
            style={{
              width: '100%',
              padding: '8px 12px',
              fontFamily: 'inherit',
              fontSize: '13px',
              backgroundColor: 'var(--input)',
              color: 'var(--foreground)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md, 10px)',
              boxSizing: 'border-box',
              resize: 'vertical',
            }}
          />
          <span style={{fontSize: '11.5px', color: 'var(--muted-foreground)', marginTop: '2px', display: 'block'}}>
            Stored as metadata; nothing runs until you approve.
          </span>
        </div>

        <button
          type="button"
          className="polaris-btn polaris-btn-primary"
          disabled={!name.trim() || !role.trim() || busy}
          onClick={() => void propose()}
          style={{alignSelf: 'flex-start'}}
        >
          {busy ? 'Proposing…' : 'Propose bot'}
        </button>
      </div>

      {/* Pending proposals needing human consent */}
      <div style={{marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px'}}>
        <div style={{fontSize: '13px', fontWeight: 600, color: 'var(--foreground)'}}>
          Awaiting your approval {pending.length ? `(${pending.length})` : ''}
        </div>

        {available === true && pending.length === 0 ? (
          <div style={{fontSize: '12.5px', color: 'var(--muted-foreground)', padding: '8px 0'}}>
            No pending proposals. Bots are never created without a proposal and your approval.
          </div>
        ) : null}

        {pending.map(p => (
          <div
            key={p.id}
            style={{
              border: '1px solid var(--border)',
              borderRadius: '8px',
              padding: '10px 12px',
              backgroundColor: 'var(--muted)',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
              <span style={{fontWeight: 600, fontSize: '13.5px', color: 'var(--foreground)'}}>
                {p.name}
              </span>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 500,
                  padding: '2px 6px',
                  borderRadius: '9999px',
                  backgroundColor: 'rgba(234, 179, 8, 0.15)',
                  color: 'var(--warning, #eab308)',
                }}
              >
                proposed
              </span>
            </div>
            <div style={{fontSize: '12.5px', color: 'var(--muted-foreground)'}}>{p.role}</div>
            <div style={{fontSize: '11px', color: 'var(--muted-foreground)'}}>
              fleet id: <code>{p.bot_id}</code> · proposed by {p.proposed_by}
            </div>
            <div style={{display: 'flex', gap: '8px', marginTop: '6px'}}>
              <button
                type="button"
                className="polaris-btn polaris-btn-primary"
                style={{fontSize: '12px', padding: '4px 10px'}}
                disabled={busy}
                onClick={() => void act(() => approveBotProposal(p.id))}
              >
                Approve (human consent)
              </button>
              <button
                type="button"
                className="polaris-btn polaris-btn-outline"
                style={{fontSize: '12px', padding: '4px 10px'}}
                disabled={busy}
                onClick={() => void act(() => rejectBotProposal(p.id))}
              >
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Decided proposals */}
      {decided.length ? (
        <div style={{marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px'}}>
          <div style={{fontSize: '13px', fontWeight: 600, color: 'var(--foreground)'}}>
            Decided
          </div>
          {decided.map(p => (
            <div
              key={p.id}
              style={{
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '8px 12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <span style={{fontSize: '13px', fontWeight: 500, color: 'var(--foreground)'}}>
                  {p.name}
                </span>
                <span
                  style={{
                    marginLeft: '8px',
                    fontSize: '11px',
                    color: STATUS_COLOR[p.status],
                  }}
                >
                  {p.status}
                </span>
              </div>
              {p.status === 'approved' ? (
                <button
                  type="button"
                  className="polaris-btn polaris-btn-primary"
                  style={{fontSize: '12px', padding: '4px 10px'}}
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const res = await createApprovedBot(p.id);
                      onFleetChanged?.();
                      return res;
                    })
                  }
                >
                  Create &amp; register
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
