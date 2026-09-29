import {getOps, type OpsService} from '../api';
import {useApiData} from '../useApiData';
import {ApiNotice} from './ApiNotice';

const stateColors = (state: OpsService['state']) => {
  switch (state) {
    case 'running':
      return {dot: 'var(--success, #10b981)', text: 'var(--success, #10b981)', bg: 'rgba(16, 185, 129, 0.1)'};
    case 'degraded':
      return {dot: 'var(--warning, #f59e0b)', text: 'var(--warning, #f59e0b)', bg: 'rgba(245, 158, 11, 0.1)'};
    case 'down':
      return {dot: 'var(--destructive, #ef4444)', text: 'var(--destructive, #ef4444)', bg: 'rgba(239, 68, 68, 0.1)'};
    default:
      return {dot: 'var(--muted-foreground, #888)', text: 'var(--muted-foreground, #888)', bg: 'var(--muted)'};
  }
};

/**
 * Polaris OpsScreen:
 * Supervised container services, gateway health, and tunnel state
 * rendered using Polaris tokens and .rk-scroll.
 */
export function OpsScreen() {
  const state = useApiData(getOps);
  const services = state.phase === 'ready' ? state.data.services ?? [] : [];
  const running = services.filter((s) => s.state === 'running').length;

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
          Ops
        </h2>
        <p style={{margin: 0, fontSize: '13px', color: 'var(--muted-foreground)'}}>
          {state.phase === 'ready'
            ? `Supervised services inside the container — ${running} of ${services.length} running.`
            : 'Supervision, gateway and tunnel health.'}
        </p>
      </div>

      {/* Body */}
      {state.phase === 'ready' && services.length > 0 ? (
        <div className="rk-scroll" style={{flex: 1, overflowY: 'auto', padding: '24px'}}>
          <div style={{display: 'flex', flexDirection: 'column', gap: '20px'}}>
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
                      Service
                    </th>
                    <th style={{padding: '10px 16px', fontWeight: 600, color: 'var(--muted-foreground)', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.05em'}}>
                      State
                    </th>
                    <th style={{padding: '10px 16px', fontWeight: 600, color: 'var(--muted-foreground)', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.05em'}}>
                      Detail
                    </th>
                    <th style={{padding: '10px 16px', fontWeight: 600, color: 'var(--muted-foreground)', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.05em'}}>
                      Uptime
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {services.map((svc, i) => {
                    const colors = stateColors(svc.state);
                    return (
                      <tr
                        key={svc.id || svc.name || i}
                        style={{
                          borderBottom: i < services.length - 1 ? '1px solid var(--border)' : 'none',
                          transition: 'background-color 100ms ease',
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.backgroundColor = 'var(--accent)';
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                      >
                        <td style={{padding: '12px 16px', fontWeight: 600, color: 'var(--foreground)'}}>
                          {svc.name}
                        </td>
                        <td style={{padding: '12px 16px'}}>
                          <div style={{display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '2px 8px', borderRadius: '9999px', backgroundColor: colors.bg}}>
                            <span
                              style={{
                                width: '7px',
                                height: '7px',
                                borderRadius: '50%',
                                backgroundColor: colors.dot,
                              }}
                            />
                            <span style={{fontSize: '11.5px', fontWeight: 500, color: colors.text}}>
                              {svc.state}
                            </span>
                          </div>
                        </td>
                        <td style={{padding: '12px 16px', color: 'var(--muted-foreground)', maxWidth: '400px'}}>
                          {svc.detail}
                        </td>
                        <td style={{padding: '12px 16px', color: 'var(--muted-foreground)', fontFamily: 'var(--font-family-code, monospace)', fontSize: '12px'}}>
                          {svc.uptime}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Read-only banner / note */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '10px 14px',
                borderRadius: 'var(--radius-md, 8px)',
                backgroundColor: 'var(--muted)',
                border: '1px solid var(--border)',
                fontSize: '12.5px',
                color: 'var(--muted-foreground)',
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 600,
                  backgroundColor: 'var(--background)',
                  border: '1px solid var(--border)',
                  color: 'var(--foreground)',
                }}
              >
                Read-only
              </span>
              <span>
                Service control (restart/stop) is not exposed by the adapter yet, so no action buttons
                are shown rather than shipping ones that do nothing.
              </span>
            </div>
          </div>
        </div>
      ) : (
        <ApiNotice state={state} />
      )}
    </div>
  );
}