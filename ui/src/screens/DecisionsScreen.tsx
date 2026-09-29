import {getDecisions, type TypedDecision} from '../api';
import {useApiData} from '../useApiData';
import {ApiNotice} from './ApiNotice';

const kindColor = (k: TypedDecision['kind']) => {
  if (k === 'noul') return {bg: 'rgba(168, 85, 247, 0.15)', text: '#c084fc'};
  if (k === 'choice') return {bg: 'rgba(59, 130, 246, 0.15)', text: 'var(--link)'};
  return {bg: 'rgba(20, 184, 166, 0.15)', text: '#2dd4bf'};
};

/**
 * Polaris DecisionsScreen:
 * Full-page ledger of TypeSafe typed decisions (noul, choice, score)
 * with confidence progress bars and shadow-mode status badges, styled
 * with Polaris design tokens and .rk-scroll.
 */
export function DecisionsScreen() {
  const state = useApiData(getDecisions);
  const decisions = state.phase === 'ready' ? state.data.decisions ?? [] : [];

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
          Decisions Ledger
        </h2>
        <p style={{margin: 0, fontSize: '13px', color: 'var(--muted-foreground)'}}>
          {state.phase === 'ready'
            ? `Jev / TypeSafe typed decisions — ${decisions.length} recorded.`
            : 'Jev / TypeSafe typed decisions — noul, choice, score — with confidence and shadow mode.'}
        </p>
      </div>

      {/* Body */}
      {state.phase === 'ready' && decisions.length > 0 ? (
        <div className="rk-scroll" style={{flex: 1, overflowY: 'auto', padding: '24px'}}>
          <div
            style={{
              borderRadius: 'var(--radius-lg, 12px)',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--card)',
              overflow: 'hidden',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
            }}
          >
            <table style={{width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px'}}>
              <thead>
                <tr style={{borderBottom: '1px solid var(--border)', backgroundColor: 'var(--muted)'}}>
                  <th style={{padding: '10px 16px', fontWeight: 600, color: 'var(--muted-foreground)', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.05em'}}>
                    Type
                  </th>
                  <th style={{padding: '10px 16px', fontWeight: 600, color: 'var(--muted-foreground)', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.05em'}}>
                    Decision Statement
                  </th>
                  <th style={{padding: '10px 16px', fontWeight: 600, color: 'var(--muted-foreground)', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.05em', width: '180px'}}>
                    Confidence
                  </th>
                  <th style={{padding: '10px 16px', fontWeight: 600, color: 'var(--muted-foreground)', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.05em'}}>
                    Mode
                  </th>
                  <th style={{padding: '10px 16px', fontWeight: 600, color: 'var(--muted-foreground)', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.05em'}}>
                    Decider
                  </th>
                  <th style={{padding: '10px 16px', fontWeight: 600, color: 'var(--muted-foreground)', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.05em'}}>
                    When
                  </th>
                </tr>
              </thead>
              <tbody>
                {decisions.map((d, i) => {
                  const kc = kindColor(d.kind);
                  const confPct = Math.round(Number(d.confidence) * 100);
                  return (
                    <tr
                      key={d.id || i}
                      style={{
                        borderBottom: i < decisions.length - 1 ? '1px solid var(--border)' : 'none',
                        transition: 'background-color 100ms ease',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.backgroundColor = 'var(--accent)';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                    >
                      <td style={{padding: '12px 16px'}}>
                        <span
                          style={{
                            backgroundColor: kc.bg,
                            color: kc.text,
                            padding: '2px 8px',
                            borderRadius: '9999px',
                            fontSize: '11px',
                            fontWeight: 600,
                            textTransform: 'uppercase',
                          }}
                        >
                          {d.kind}
                        </span>
                      </td>
                      <td style={{padding: '12px 16px', fontWeight: 500, color: 'var(--foreground)', lineHeight: 1.4}}>
                        {d.statement}
                      </td>
                      <td style={{padding: '12px 16px'}}>
                        <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                          <div
                            style={{
                              flex: 1,
                              height: '6px',
                              borderRadius: '9999px',
                              backgroundColor: 'var(--muted)',
                              overflow: 'hidden',
                            }}
                          >
                            <div
                              style={{
                                height: '100%',
                                width: `${confPct}%`,
                                backgroundColor: 'var(--primary)',
                                borderRadius: '9999px',
                                transition: 'width 200ms ease',
                              }}
                            />
                          </div>
                          <span style={{fontSize: '11.5px', color: 'var(--muted-foreground)', width: '32px', textAlign: 'right', fontFamily: 'var(--font-family-code, monospace)'}}>
                            {confPct}%
                          </span>
                        </div>
                      </td>
                      <td style={{padding: '12px 16px'}}>
                        {d.shadow ? (
                          <span
                            style={{
                              backgroundColor: 'rgba(233, 196, 106, 0.15)',
                              color: 'var(--warning)',
                              border: '1px solid rgba(233, 196, 106, 0.3)',
                              padding: '2px 8px',
                              borderRadius: '9999px',
                              fontSize: '11px',
                              fontWeight: 500,
                            }}
                          >
                            shadow
                          </span>
                        ) : (
                          <span
                            style={{
                              backgroundColor: 'rgba(78, 203, 113, 0.15)',
                              color: 'var(--success)',
                              border: '1px solid rgba(78, 203, 113, 0.3)',
                              padding: '2px 8px',
                              borderRadius: '9999px',
                              fontSize: '11px',
                              fontWeight: 500,
                            }}
                          >
                            live
                          </span>
                        )}
                      </td>
                      <td style={{padding: '12px 16px', color: 'var(--muted-foreground)'}}>
                        {d.decidedBy}
                      </td>
                      <td style={{padding: '12px 16px', color: 'var(--muted-foreground)', fontSize: '12px'}}>
                        {d.at}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <ApiNotice state={state} />
      )}
    </div>
  );
}