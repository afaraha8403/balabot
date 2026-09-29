import type {ApiState} from '../useApiData';

/**
 * Polaris ApiNotice:
 * Renders loading / unavailable / error phases of deep data screens honestly
 * with the API's own reason shown, consuming Polaris design tokens.
 */
export function ApiNotice({state}: {state: ApiState<unknown>}) {
  if (state.phase === 'loading') {
    return (
      <div style={{padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px', width: '100%', boxSizing: 'border-box'}}>
        {/* Skeleton loading lines */}
        <div
          style={{
            height: '24px',
            width: '40%',
            borderRadius: 'var(--radius-md, 8px)',
            backgroundColor: 'var(--muted)',
            opacity: 0.7,
            animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
          }}
        />
        <div
          style={{
            height: '16px',
            width: '100%',
            borderRadius: 'var(--radius-sm, 6px)',
            backgroundColor: 'var(--muted)',
            opacity: 0.5,
            animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
          }}
        />
        <div
          style={{
            height: '16px',
            width: '92%',
            borderRadius: 'var(--radius-sm, 6px)',
            backgroundColor: 'var(--muted)',
            opacity: 0.5,
            animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
          }}
        />
        <div
          style={{
            height: '16px',
            width: '96%',
            borderRadius: 'var(--radius-sm, 6px)',
            backgroundColor: 'var(--muted)',
            opacity: 0.5,
            animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
          }}
        />
        <div
          style={{
            height: '16px',
            width: '70%',
            borderRadius: 'var(--radius-sm, 6px)',
            backgroundColor: 'var(--muted)',
            opacity: 0.5,
            animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
          }}
        />
      </div>
    );
  }

  if (state.phase === 'unavailable') {
    return (
      <div
        style={{
          padding: '48px 24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          color: 'var(--muted-foreground)',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '40px',
            height: '40px',
            borderRadius: '9999px',
            backgroundColor: 'var(--muted)',
            color: 'var(--foreground)',
            marginBottom: '12px',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </span>
        <h4 style={{margin: '0 0 6px 0', fontSize: '15px', fontWeight: 600, color: 'var(--foreground)'}}>
          Nothing to show yet
        </h4>
        <p style={{margin: 0, fontSize: '13px', maxWidth: '380px', lineHeight: 1.5}}>
          {state.reason || 'No records returned by the store.'}
        </p>
      </div>
    );
  }

  if (state.phase === 'error') {
    return (
      <div
        style={{
          padding: '48px 24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          color: 'var(--muted-foreground)',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '40px',
            height: '40px',
            borderRadius: '9999px',
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            color: 'var(--destructive)',
            marginBottom: '12px',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </span>
        <h4 style={{margin: '0 0 6px 0', fontSize: '15px', fontWeight: 600, color: 'var(--foreground)'}}>
          Could not reach the API
        </h4>
        <p style={{margin: 0, fontSize: '13px', maxWidth: '380px', lineHeight: 1.5, color: 'var(--destructive)'}}>
          {state.message}
        </p>
      </div>
    );
  }

  return null;
}
