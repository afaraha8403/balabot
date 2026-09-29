import {getGovernance} from '../api';
import {useApiData} from '../useApiData';
import {ApiNotice} from './ApiNotice';

/**
 * Polaris GovernanceScreen:
 * Full-page OKF governance record displaying decision statements,
 * rationale, rollback plans, deciders, and timestamps, styled with
 * Polaris card items and .rk-scroll.
 */
export function GovernanceScreen() {
  const state = useApiData(getGovernance);
  const ledger = state.phase === 'ready' ? state.data.ledger ?? [] : [];

  return (
    <div style={{display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, backgroundColor: 'var(--background)', color: 'var(--foreground)'}}>
      {/* Header */}
      <div
        style={{
          padding: '16px 24px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          flexShrink: 0,
        }}
      >
        <h2 style={{margin: 0, fontSize: '18px', fontWeight: 600, color: 'var(--foreground)'}}>
          Governance Ledger
        </h2>
        <p style={{margin: 0, fontSize: '13px', color: 'var(--muted-foreground)'}}>
          {state.phase === 'ready'
            ? `The OKF decision record — ${ledger.length} entr${ledger.length === 1 ? 'y' : 'ies'}.`
            : 'The OKF decision record — what was decided, by whom, why, and the rollback path.'}
        </p>
      </div>

      {/* Body */}
      {state.phase === 'ready' && ledger.length > 0 ? (
        <div className="rk-scroll" style={{flex: 1, overflowY: 'auto', padding: '24px'}}>
          <div style={{display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '860px'}}>
            {ledger.map(e => (
              <div
                key={e.id}
                style={{
                  borderRadius: 'var(--radius-lg, 12px)',
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--card)',
                  padding: '18px 20px',
                  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                <div style={{display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px'}}>
                  <h4 style={{margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--foreground)', lineHeight: 1.4}}>
                    {e.what}
                  </h4>
                  <div style={{display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0}}>
                    <span
                      style={{
                        backgroundColor: 'rgba(59, 130, 246, 0.12)',
                        color: 'var(--link)',
                        padding: '2px 8px',
                        borderRadius: '9999px',
                        fontSize: '11px',
                        fontWeight: 600,
                      }}
                    >
                      {e.who}
                    </span>
                    <span style={{fontSize: '11.5px', color: 'var(--muted-foreground)'}}>
                      {new Date(e.at).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                <div style={{display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', lineHeight: 1.5}}>
                  <div style={{display: 'flex', gap: '8px'}}>
                    <span style={{fontWeight: 600, color: 'var(--muted-foreground)', minWidth: '65px'}}>Why:</span>
                    <span style={{color: 'var(--foreground)'}}>{e.why}</span>
                  </div>
                  <div style={{display: 'flex', gap: '8px'}}>
                    <span style={{fontWeight: 600, color: 'var(--muted-foreground)', minWidth: '65px'}}>Rollback:</span>
                    <span style={{color: 'var(--foreground)'}}>{e.rollback}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <ApiNotice state={state} />
      )}
    </div>
  );
}