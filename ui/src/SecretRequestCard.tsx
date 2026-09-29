import {useRef, useState} from 'react';
import type {Bot} from './api';
import {postOrgSecret, type SecretCard, type SecretSaveResult} from './api';

type ShareChoice = 'self' | 'all' | 'choose' | 'another-org';

type Props = {
  card: SecretCard;
  /** The fleet's bots — the real share targets. */
  bots: Bot[];
  onResolve: (requestId: string, status: SecretCard['status']) => void;
};

/**
 * In-chat secret request card (Polaris BuiCard geometry) —
 * "the interface is in the chat, the value never is".
 *
 * SECURITY INVARIANT (do not refactor away):
 * The secret VALUE is read from the password input's DOM ref at submit time,
 * POSTed straight to POST /api/org/secrets, and the field is cleared
 * immediately after. The value NEVER enters React state — no useState, no
 * store, no chat message, no transcript render, no console.log. The only
 * state in this component is share choice, save result metadata (name,
 * fingerprint, granted scope), and error text.
 */
export function SecretRequestCard({card, bots, onResolve}: Props) {
  // The ONLY reference to the value: the DOM input itself. Never mirrored
  // into component state — read it from the ref at submit time only.
  const valueInputRef = useRef<HTMLInputElement | null>(null);
  const [share, setShare] = useState<ShareChoice>('self');
  const [chosenBot, setChosenBot] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [result, setResult] = useState<SecretSaveResult | null>(null);
  const [error, setError] = useState('');

  const resolved = card.status !== undefined;
  const isAccessRequest = card.kind === 'secret_access_request';

  /** Wipe the value from the DOM the moment we no longer need it. */
  const clearValue = () => {
    if (valueInputRef.current) valueInputRef.current.value = '';
  };

  const cancel = () => {
    clearValue();
    onResolve(card.requestId, {state: 'cancelled'});
  };

  const save = async () => {
    // Read the value straight from the DOM at submit time — it has never
    // passed through React state at any point in this component's life.
    const value = valueInputRef.current?.value ?? '';
    if (!value) return;
    setIsSaving(true);
    setError('');
    try {
      const shareValue =
        share === 'self'
          ? [card.bot]
          : share === 'choose'
            ? chosenBot
              ? [chosenBot]
              : []
            : share; // 'all'
      const res = await postOrgSecret({
        name: card.name,
        value,
        share: shareValue,
      });
      setResult(res);
      onResolve(card.requestId, {
        state: 'saved',
        fingerprint: res.fingerprint ?? '',
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      // Clear the field in every path — success and failure. The value never
      // outlives this function.
      clearValue();
      setIsSaving(false);
    }
  };

  const grantedScope = (res: SecretSaveResult): string => {
    const g = res.granted_to;
    if (Array.isArray(g) && g.length > 0) return g.join(', ');
    return res.share_scope ?? 'unknown scope';
  };

  return (
    <div
      data-testid="secret-request-card"
      style={{
        width: '420px',
        maxWidth: '100%',
        borderRadius: '20px',
        border: '1px solid var(--border)',
        backgroundColor: 'var(--card)',
        color: 'var(--card-foreground)',
        padding: '16px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        margin: '8px 0',
      }}
    >
      {/* Header */}
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap'}}>
        <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '28px',
              height: '28px',
              borderRadius: '8px',
              backgroundColor: 'var(--accent)',
              color: 'var(--foreground)',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </span>
          <span style={{fontSize: '14px', fontWeight: 600, color: 'var(--foreground)'}}>
            {card.name}
          </span>
        </div>
        <div style={{display: 'flex', alignItems: 'center', gap: '6px'}}>
          <span
            style={{
              backgroundColor: 'var(--accent)',
              color: 'var(--accent-foreground)',
              padding: '2px 8px',
              borderRadius: '9999px',
              fontSize: '11px',
              fontWeight: 500,
            }}
          >
            {card.bot || 'bot'}
          </span>
          <span style={{fontSize: '11px', color: 'var(--muted-foreground)'}}>
            {new Date(card.at).toLocaleTimeString()}
          </span>
        </div>
      </div>

      {card.description ? (
        <p style={{margin: 0, fontSize: '13px', lineHeight: 1.5, color: 'var(--muted-foreground)'}}>
          {card.description}
        </p>
      ) : null}

      {resolved ? (
        card.status?.state === 'saved' ? (
          <div
            data-testid="secret-saved-badge"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              backgroundColor: 'rgba(78, 203, 113, 0.1)',
              border: '1px solid rgba(78, 203, 113, 0.3)',
              borderRadius: '12px',
              padding: '10px 14px',
              fontSize: '12.5px',
              color: 'var(--success)',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>
              Saved. Fingerprint {card.status.fingerprint || '—'}
              {result ? ` · shared with: ${grantedScope(result)}` : ''}
            </span>
          </div>
        ) : card.status?.state === 'denied' && isAccessRequest ? (
          <p style={{margin: 0, fontSize: '12.5px', color: 'var(--muted-foreground)'}}>
            Access request handled.
          </p>
        ) : (
          <p style={{margin: 0, fontSize: '12.5px', color: 'var(--muted-foreground)'}}>
            Request cancelled.
          </p>
        )
      ) : isAccessRequest ? (
        <p style={{margin: 0, fontSize: '12.5px', color: 'var(--muted-foreground)', lineHeight: 1.5}}>
          This bot is asking to reuse an existing secret. Access grants are
          not backed by the current server, so approve/deny is disabled
          until a grants endpoint exists.
        </p>
      ) : (
        <div style={{display: 'flex', flexDirection: 'column', gap: '10px'}}>
          {/* Uncontrolled password input: the value lives ONLY in the
              DOM. Never add a value/onChange state pair here. */}
          <div style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
            <label
              htmlFor={`secret-input-${card.requestId}`}
              style={{fontSize: '12px', fontWeight: 600, color: 'var(--foreground)'}}
            >
              Value for {card.name}
            </label>
            <input
              id={`secret-input-${card.requestId}`}
              ref={valueInputRef}
              type="password"
              autoComplete="off"
              placeholder="Paste the value — it is sent straight to the secret store"
              disabled={isSaving}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 'var(--radius-md, 8px)',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--input)',
                color: 'var(--foreground)',
                fontSize: '13px',
                fontFamily: 'inherit',
                outline: 'none',
                boxSizing: 'border-box',
                transition: 'border-color 150ms ease',
              }}
            />
            <span style={{fontSize: '11px', color: 'var(--muted-foreground)'}}>
              Sent straight to the secret store — never through the chat.
            </span>
          </div>

          <div style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
            <label
              htmlFor={`secret-share-${card.requestId}`}
              style={{fontSize: '12px', fontWeight: 500, color: 'var(--foreground)'}}
            >
              Share with
            </label>
            <select
              id={`secret-share-${card.requestId}`}
              value={share}
              onChange={e => setShare(e.target.value as ShareChoice)}
              style={{
                width: '100%',
                padding: '6px 10px',
                borderRadius: 'var(--radius-md, 8px)',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--input)',
                color: 'var(--foreground)',
                fontSize: '12.5px',
                fontFamily: 'inherit',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            >
              <option value="self">{card.bot || 'This bot'} only</option>
              <option value="all">All bots</option>
              <option value="choose">Choose bots…</option>
              <option value="another-org" disabled>
                Another org… (no org registry on this server)
              </option>
            </select>
          </div>

          {share === 'choose' && bots.length > 0 ? (
            <div style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
              <label
                htmlFor={`secret-bot-pick-${card.requestId}`}
                style={{fontSize: '12px', fontWeight: 500, color: 'var(--foreground)'}}
              >
                Pick a bot
              </label>
              <select
                id={`secret-bot-pick-${card.requestId}`}
                value={chosenBot}
                onChange={e => setChosenBot(e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-md, 8px)',
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--input)',
                  color: 'var(--foreground)',
                  fontSize: '12.5px',
                  fontFamily: 'inherit',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              >
                <option value="">Select a bot…</option>
                {bots.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {error ? (
            <div style={{display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--destructive)', fontSize: '12px'}}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{error}</span>
            </div>
          ) : null}

          <div style={{display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px'}}>
            <button
              type="button"
              disabled={isSaving}
              onClick={cancel}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                borderRadius: '9999px',
                border: '1px solid var(--border)',
                backgroundColor: 'transparent',
                color: 'var(--muted-foreground)',
                padding: '6px 14px',
                fontSize: '12px',
                fontWeight: 500,
                cursor: isSaving ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void save()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                borderRadius: '9999px',
                border: 'none',
                backgroundColor: 'var(--primary)',
                color: 'var(--primary-foreground)',
                padding: '6px 16px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: isSaving ? 'not-allowed' : 'pointer',
                opacity: isSaving ? 0.7 : 1,
                fontFamily: 'inherit',
              }}
            >
              {isSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function SecretCardDismissButton({onDismiss}: {onDismiss: () => void}) {
  return (
    <button
      type="button"
      aria-label="Dismiss"
      onClick={onDismiss}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '24px',
        height: '24px',
        borderRadius: '9999px',
        border: 'none',
        backgroundColor: 'transparent',
        color: 'var(--muted-foreground)',
        cursor: 'pointer',
        padding: 0,
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  );
}
