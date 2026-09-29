import {getCost, type CostRow} from '../api';
import {useApiData} from '../useApiData';
import {ApiNotice} from './ApiNotice';

const usd = (n: number) =>
  n.toLocaleString('en-US', {style: 'currency', currency: 'USD', maximumFractionDigits: 4});

/**
 * Polaris CostScreen:
 * Full-page accounting table displaying token consumption, call counts,
 * and dollar spend broken down by provider and model, styled with Polaris
 * table grammar, .rk-scroll, and tabular figures.
 */
export function CostScreen() {
  const state = useApiData(getCost);
  const rows = state.phase === 'ready' ? state.data.rows ?? [] : [];
  const total = rows.reduce((s, r) => s + r.spend, 0);

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
          Cost & Usage
        </h2>
        <p style={{margin: 0, fontSize: '13px', color: 'var(--muted-foreground)'}}>
          {state.phase === 'ready'
            ? `${usd(total)} month-to-date across ${rows.length} model${rows.length === 1 ? '' : 's'}, from the agents' own usage tables.`
            : 'Token and spend accounting for every agent.'}
        </p>
      </div>

      {/* Body */}
      {state.phase === 'ready' && rows.length > 0 ? (
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
                    Provider
                  </th>
                  <th style={{padding: '10px 16px', fontWeight: 600, color: 'var(--muted-foreground)', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.05em'}}>
                    Model
                  </th>
                  <th style={{padding: '10px 16px', fontWeight: 600, color: 'var(--muted-foreground)', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right'}}>
                    Spend (MTD)
                  </th>
                  <th style={{padding: '10px 16px', fontWeight: 600, color: 'var(--muted-foreground)', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right'}}>
                    Calls
                  </th>
                  <th style={{padding: '10px 16px', fontWeight: 600, color: 'var(--muted-foreground)', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right'}}>
                    Tokens
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={r.id || `${r.provider}-${r.model}-${i}`}
                    style={{
                      borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : 'none',
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
                          backgroundColor: 'rgba(59, 130, 246, 0.12)',
                          color: 'var(--link)',
                          padding: '2px 8px',
                          borderRadius: '9999px',
                          fontSize: '11.5px',
                          fontWeight: 500,
                        }}
                      >
                        {r.provider}
                      </span>
                    </td>
                    <td style={{padding: '12px 16px', fontWeight: 500, color: 'var(--foreground)'}}>
                      {r.model}
                    </td>
                    <td
                      style={{
                        padding: '12px 16px',
                        textAlign: 'right',
                        fontWeight: 600,
                        color: 'var(--foreground)',
                        fontFamily: 'var(--font-family-code, monospace)',
                      }}
                    >
                      {usd(Number(r.spend))}
                    </td>
                    <td
                      style={{
                        padding: '12px 16px',
                        textAlign: 'right',
                        color: 'var(--muted-foreground)',
                        fontFamily: 'var(--font-family-code, monospace)',
                      }}
                    >
                      {Number(r.calls).toLocaleString('en-US')}
                    </td>
                    <td
                      style={{
                        padding: '12px 16px',
                        textAlign: 'right',
                        color: 'var(--muted-foreground)',
                        fontFamily: 'var(--font-family-code, monospace)',
                      }}
                    >
                      {Number(r.tokens).toLocaleString('en-US')}
                    </td>
                  </tr>
                ))}
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