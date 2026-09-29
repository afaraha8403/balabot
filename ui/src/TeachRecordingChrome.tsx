import {useEffect, useState} from 'react';

export function formatRemaining(expiresAt: string | number | null | undefined): string {
  if (!expiresAt) return '10:00';
  const target = typeof expiresAt === 'number' ? expiresAt : new Date(expiresAt).getTime();
  const ms = Math.max(0, target - Date.now());
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function TeachRecordingChrome({
  goal,
  expiresAt,
  busy,
  actionsCount = 0,
  onStop,
  variant = 'panel',
}: {
  goal: string;
  expiresAt?: string | number | null;
  busy?: boolean;
  actionsCount?: number;
  onStop?: () => void | Promise<void>;
  variant?: 'panel' | 'overlay';
}) {
  const [remaining, setRemaining] = useState(() => formatRemaining(expiresAt));

  useEffect(() => {
    setRemaining(formatRemaining(expiresAt));
    const timer = window.setInterval(() => {
      setRemaining(formatRemaining(expiresAt));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  if (variant === 'overlay') {
    return (
      <div
        data-testid="teach-recording-overlay"
        style={{
          display: 'flex',
          minWidth: 0,
          flex: 1,
          flexDirection: 'column',
          gap: '2px',
          padding: '0 12px',
        }}
      >
        <div style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '13px', fontWeight: 500, color: 'var(--foreground)'}}>
          Recording: {goal}
        </div>
        <div style={{fontSize: '12px', color: 'var(--muted-foreground)'}}>
          {remaining} left · bot is watching, not acting
        </div>
        <div style={{fontSize: '12px', color: 'var(--destructive)'}}>
          Do not type passwords into the demo. Use Take control for credentials.
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="teach-recording"
      style={{
        borderRadius: '11px',
        border: '1px solid var(--border)',
        backgroundColor: 'var(--card)',
        padding: '12px 14px',
        borderLeft: '4px solid var(--destructive)',
      }}
    >
      <div style={{fontSize: '14px', fontWeight: 500, color: 'var(--foreground)'}}>
        Recording: {goal}
      </div>
      <div style={{marginTop: '4px', fontSize: '13px', color: 'var(--muted-foreground)'}}>
        {remaining} left · bot is watching, not acting
      </div>
      <div style={{marginTop: '4px', fontSize: '13px', color: 'var(--destructive)'}}>
        Do not type passwords into the demo. Use Take control for credentials.
      </div>
      {actionsCount > 0 ? (
        <div style={{marginTop: '6px', fontSize: '12.5px', color: 'var(--muted-foreground)'}}>
          Actions captured: {actionsCount}
        </div>
      ) : null}
      {onStop ? (
        <button
          type="button"
          disabled={busy}
          data-testid="teach-stop-button"
          aria-label="Stop teaching"
          onClick={() => void onStop()}
          style={{
            marginTop: '10px',
            padding: '5px 12px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)',
            backgroundColor: 'transparent',
            color: 'var(--foreground)',
            fontSize: '13px',
            cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >
          Stop teaching
        </button>
      ) : null}
    </div>
  );
}

export function TeachStopButton({
  busy,
  onStop,
}: {
  busy?: boolean;
  onStop: () => void | Promise<void>;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      data-testid="teach-stop-overlay"
      aria-label="Stop teaching"
      onClick={() => void onStop()}
      style={{
        padding: '5px 12px',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border)',
        backgroundColor: 'transparent',
        color: 'var(--foreground)',
        fontSize: '13px',
        cursor: busy ? 'not-allowed' : 'pointer',
      }}
    >
      Stop teaching
    </button>
  );
}
