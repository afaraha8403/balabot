import {useState} from 'react';
import {resolveIntervention, type InterventionPayload} from './api';

type Props = {
  intervention: InterventionPayload;
  onOpenComputer: () => void;
  onResolved?: (token: string, action: 'approve' | 'deny') => void;
};

/**
 * Polaris InterventionCard:
 * Restyled to match Polaris McpApprovalCard geometry (w-full max-w-[460px] rounded-[20px]).
 *
 * When an agent encounters a password/passkey, 2FA, CAPTCHA, or payment wall,
 * it pauses execution and posts this card. The human can open the Agent Computer,
 * complete the sensitive step, and click "Done — Continue Bot" to resume the turn.
 *
 * Invariant: Intervention resume-token resolution resolves the token and unblocks work.
 */
export function InterventionCard({
  intervention,
  onOpenComputer,
  onResolved,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<
    'pending' | 'approved' | 'denied' | 'accepted' | 'rejected' | 'expired'
  >(intervention.status ?? intervention.state ?? 'pending');
  const [error, setError] = useState('');

  const handleResolve = async (action: 'approve' | 'deny') => {
    setBusy(true);
    setError('');
    try {
      await resolveIntervention(intervention.resume_token, action);
      setStatus(action === 'approve' ? 'approved' : 'denied');
      onResolved?.(intervention.resume_token, action);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (status === 'approved' || status === 'accepted') {
    return (
      <div
        data-testid="intervention-card-approved"
        style={{
          border: '1px solid var(--border)',
          backgroundColor: 'var(--muted)',
          borderRadius: '16px',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '13px',
          color: 'var(--foreground)',
          maxWidth: '460px',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <span style={{color: 'var(--muted-foreground)'}}>
          Human take-over completed for <strong style={{color: 'var(--foreground)'}}>{intervention.bot}</strong>. Bot resumed.
        </span>
      </div>
    );
  }

  if (status === 'denied' || status === 'rejected') {
    return (
      <div
        data-testid="intervention-card-denied"
        style={{
          border: '1px solid var(--border)',
          backgroundColor: 'var(--muted)',
          borderRadius: '16px',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '13px',
          color: 'var(--muted-foreground)',
          maxWidth: '460px',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted-foreground)" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
        <span>
          Take-over request for <strong style={{color: 'var(--foreground)'}}>{intervention.bot}</strong> was declined.
        </span>
      </div>
    );
  }

  if (status === 'expired') {
    return (
      <div
        data-testid="intervention-card-expired"
        style={{
          border: '1px solid var(--border)',
          backgroundColor: 'var(--muted)',
          borderRadius: '16px',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '13px',
          color: 'var(--muted-foreground)',
          maxWidth: '460px',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="2">
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <span>
          Intervention for {intervention.bot} expired because the turn already completed.
        </span>
      </div>
    );
  }

  return (
    <div
      data-testid="intervention-card"
      style={{
        width: '100%',
        maxWidth: '460px',
        borderRadius: '20px',
        border: '1px solid rgba(233, 196, 106, 0.4)',
        backgroundColor: 'var(--card)',
        color: 'var(--card-foreground)',
        padding: '16px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      {/* Header with McpApprovalCard-inspired geometry */}
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px'}}>
        <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '30px',
              height: '30px',
              borderRadius: '10px',
              backgroundColor: 'rgba(233, 196, 106, 0.15)',
              color: 'var(--warning)',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </span>
          <div>
            <h4 style={{margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--foreground)'}}>
              Action Required: Human Take-Over
            </h4>
          </div>
        </div>
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
          {intervention.bot}
        </span>
      </div>

      <p style={{margin: 0, fontSize: '13px', lineHeight: 1.5, color: 'var(--foreground)'}}>
        {intervention.reason ||
          'The bot has encountered a wall that requires human intervention (CAPTCHA, 2FA, or credentials).'}
      </p>

      {intervention.hint ? (
        <p style={{margin: 0, fontSize: '12px', color: 'var(--muted-foreground)'}}>
          Hint: {intervention.hint}
        </p>
      ) : null}

      {intervention.url ? (
        <div style={{display: 'flex', alignItems: 'center', gap: '6px'}}>
          <span style={{fontSize: '11.5px', color: 'var(--muted-foreground)'}}>URL:</span>
          <span
            style={{
              backgroundColor: 'var(--muted)',
              color: 'var(--link)',
              padding: '2px 8px',
              borderRadius: '6px',
              fontSize: '11.5px',
              fontFamily: 'var(--font-family-code, monospace)',
            }}
          >
            {intervention.url}
          </span>
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

      {/* Action Buttons matching Polaris McpApprovalCard style */}
      <div style={{display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '4px'}}>
        <button
          type="button"
          onClick={onOpenComputer}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            borderRadius: '9999px',
            border: '1px solid var(--border)',
            backgroundColor: 'var(--muted)',
            color: 'var(--foreground)',
            padding: '6px 14px',
            fontSize: '12px',
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'background-color 120ms ease',
            fontFamily: 'inherit',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.backgroundColor = 'var(--accent)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.backgroundColor = 'var(--muted)';
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect width="20" height="14" x="2" y="3" rx="2" />
            <line x1="8" x2="16" y1="21" y2="21" />
            <line x1="12" x2="12" y1="17" y2="21" />
          </svg>
          <span>Open Agent Computer</span>
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() => void handleResolve('approve')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            borderRadius: '9999px',
            border: 'none',
            backgroundColor: 'var(--primary)',
            color: 'var(--primary-foreground)',
            padding: '6px 16px',
            fontSize: '12px',
            fontWeight: 600,
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.7 : 1,
            transition: 'opacity 120ms ease',
            fontFamily: 'inherit',
          }}
        >
          <span>{busy ? 'Resuming…' : 'Done — Continue Bot'}</span>
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() => void handleResolve('deny')}
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
            cursor: busy ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <span>Decline</span>
        </button>
      </div>
    </div>
  );
}
