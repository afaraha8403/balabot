import React from 'react';

/**
 * ShellSkeleton component mirroring Polaris (apps/web/src/App.tsx:190-219).
 * Renders during initial hydration / session pending state to eliminate layout shift.
 */
export function ShellSkeleton() {
  return (
    <div
      className="polaris-shell"
      data-testid="shell-skeleton"
      style={{
        display: 'flex',
        height: '100%',
        width: '100%',
        overflow: 'hidden',
        backgroundColor: 'var(--background)',
      }}
    >
      <aside
        style={{
          width: '316px',
          minWidth: '316px',
          maxWidth: '316px',
          flexShrink: 0,
          borderRight: '1px solid var(--sidebar-border)',
          backgroundColor: 'var(--sidebar)',
          padding: '64px 14px 16px 14px',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        <div
          style={{
            height: '40px',
            borderRadius: 'var(--radius-xl)',
            backgroundColor: 'var(--muted)',
            opacity: 0.6,
            animation: 'polaris-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
          }}
        />
        <div style={{display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 4px', marginTop: '12px'}}>
          {[0, 1, 2, 3].map(row => (
            <div
              key={row}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                borderRadius: 'var(--radius-xl)',
                padding: '10px 8px',
              }}
            >
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--muted)',
                  opacity: 0.6,
                  flexShrink: 0,
                  animation: 'polaris-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                }}
              />
              <div style={{flex: 1, display: 'flex', flexDirection: 'column', gap: '8px'}}>
                <div
                  style={{
                    height: '12px',
                    width: '40%',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--muted)',
                    opacity: 0.6,
                    animation: 'polaris-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                  }}
                />
                <div
                  style={{
                    height: '10px',
                    width: '80%',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--muted)',
                    opacity: 0.6,
                    animation: 'polaris-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </aside>
      <main
        style={{
          display: 'flex',
          flex: 1,
          flexDirection: 'column',
          minWidth: 0,
          backgroundColor: 'var(--background)',
        }}
      >
        <div
          style={{
            height: '74px',
            borderBottom: '1px solid var(--sidebar-border)',
            flexShrink: 0,
          }}
        />
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '14px',
            color: 'var(--muted-foreground)',
          }}
        >
          Opening your Space…
        </div>
        <div
          style={{
            margin: '0 24px 24px 24px',
            height: '54px',
            borderRadius: '9999px',
            border: '1px solid var(--border)',
            backgroundColor: 'var(--background)',
          }}
        />
      </main>
    </div>
  );
}
