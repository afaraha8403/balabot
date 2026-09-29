import {useState} from 'react';
import {getMemory, type MemoryFact} from '../api';
import {useApiData} from '../useApiData';
import {ApiNotice} from './ApiNotice';

const trustBadgeStyle = (t: number) => {
  if (t >= 0.95) return {bg: 'rgba(78, 203, 113, 0.15)', text: 'var(--success)', border: 'rgba(78, 203, 113, 0.3)'};
  if (t >= 0.8) return {bg: 'rgba(59, 130, 246, 0.15)', text: 'var(--link)', border: 'rgba(59, 130, 246, 0.3)'};
  return {bg: 'rgba(233, 196, 106, 0.15)', text: 'var(--warning)', border: 'rgba(233, 196, 106, 0.3)'};
};

/**
 * Polaris MemoryScreen:
 * Full-page holographic memory explorer displaying facts, trust scores,
 * entity resolutions, and sources with search filtering, styled with
 * Polaris design tokens and .rk-scroll.
 */
export function MemoryScreen() {
  const [query, setQuery] = useState('');
  const state = useApiData(getMemory);
  const all = state.phase === 'ready' ? state.data.facts ?? [] : [];
  const rows = all.filter(
    f =>
      f.content.toLowerCase().includes(query.toLowerCase()) ||
      (f.entity ?? '').toLowerCase().includes(query.toLowerCase()),
  );

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
          Holographic Memory Explorer
        </h2>
        <p style={{margin: 0, fontSize: '13px', color: 'var(--muted-foreground)'}}>
          {state.phase === 'ready'
            ? `Holographic store — ${all.length} fact${all.length === 1 ? '' : 's'} recorded${state.data.profile ? ` for ${state.data.profile}` : ''}.`
            : 'Holographic store — facts, trust scores, entity resolution.'}
        </p>
      </div>

      {/* Body */}
      {state.phase === 'ready' && all.length > 0 ? (
        <div className="rk-scroll" style={{flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px'}}>
          {/* Search filter input matching Polaris InputGroupInput */}
          <div style={{position: 'relative', maxWidth: '420px'}}>
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--muted-foreground)"
              strokeWidth="2"
              style={{position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)'}}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search facts, entities, resolutions…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px 8px 36px',
                borderRadius: 'var(--radius-md, 8px)',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--input)',
                color: 'var(--foreground)',
                fontSize: '13px',
                outline: 'none',
                boxSizing: 'border-box',
                fontFamily: 'inherit',
              }}
            />
          </div>

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
                    Fact
                  </th>
                  <th style={{padding: '10px 16px', fontWeight: 600, color: 'var(--muted-foreground)', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.05em'}}>
                    Entity
                  </th>
                  <th style={{padding: '10px 16px', fontWeight: 600, color: 'var(--muted-foreground)', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.05em'}}>
                    Resolved to
                  </th>
                  <th style={{padding: '10px 16px', fontWeight: 600, color: 'var(--muted-foreground)', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center'}}>
                    Trust
                  </th>
                  <th style={{padding: '10px 16px', fontWeight: 600, color: 'var(--muted-foreground)', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.05em'}}>
                    Sources
                  </th>
                  <th style={{padding: '10px 16px', fontWeight: 600, color: 'var(--muted-foreground)', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.05em'}}>
                    Updated
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f, i) => {
                  const tb = trustBadgeStyle(Number(f.trust));
                  return (
                    <tr
                      key={f.id || i}
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
                      <td style={{padding: '12px 16px', fontWeight: 500, color: 'var(--foreground)', lineHeight: 1.4}}>
                        {f.content}
                      </td>
                      <td style={{padding: '12px 16px', color: 'var(--muted-foreground)'}}>
                        {f.entity || '—'}
                      </td>
                      <td style={{padding: '12px 16px', color: 'var(--muted-foreground)'}}>
                        {f.resolvedTo || '—'}
                      </td>
                      <td style={{padding: '12px 16px', textAlign: 'center'}}>
                        <span
                          style={{
                            backgroundColor: tb.bg,
                            color: tb.text,
                            border: `1px solid ${tb.border}`,
                            padding: '2px 8px',
                            borderRadius: '9999px',
                            fontSize: '11.5px',
                            fontWeight: 600,
                            fontFamily: 'var(--font-family-code, monospace)',
                          }}
                        >
                          {Math.round(Number(f.trust) * 100)}%
                        </span>
                      </td>
                      <td style={{padding: '12px 16px', color: 'var(--muted-foreground)', fontSize: '12px'}}>
                        {f.sources}
                      </td>
                      <td style={{padding: '12px 16px', color: 'var(--muted-foreground)', fontSize: '12px'}}>
                        {f.updatedAt}
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