import {useEffect, useRef, useState} from 'react';

type Props = {
  userName?: string;
  onNavigateArtifacts: () => void;
  onOpenSettings: (tab?: string) => void;
  onOpenUsage: () => void;
  onSignOut: () => void;
};

/**
 * Polaris footer user menu popover:
 * User avatar + name trigger opening popover with Artifacts, Settings, Usage, and Sign Out.
 */
export function UserMenuPopover({
  userName = 'Ali',
  onNavigateArtifacts,
  onOpenSettings,
  onOpenUsage,
  onSignOut,
}: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const initials = userName.slice(0, 1).toUpperCase();

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} style={{position: 'relative'}}>
      <button
        type="button"
        data-testid="user-menu-trigger"
        aria-label={`User menu for ${userName}`}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen(prev => !prev)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          background: 'transparent',
          border: 'none',
          padding: '6px 8px',
          borderRadius: 'var(--radius-md, 8px)',
          cursor: 'pointer',
          color: 'var(--foreground)',
          fontFamily: 'inherit',
          transition: 'background-color 120ms ease',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.backgroundColor = 'var(--muted)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.backgroundColor = 'transparent';
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '28px',
            height: '28px',
            borderRadius: '9999px',
            backgroundColor: 'var(--accent)',
            color: 'var(--foreground)',
            fontSize: '12px',
            fontWeight: 600,
          }}
        >
          {initials}
        </span>
        <span style={{fontSize: '13.5px', fontWeight: 500, color: 'var(--foreground)'}}>
          {userName}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{
            marginLeft: 'auto',
            color: 'var(--muted-foreground)',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 120ms ease',
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open ? (
        <div
          data-testid="user-menu-popover"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: 0,
            width: '210px',
            backgroundColor: 'var(--popover)',
            color: 'var(--popover-foreground)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg, 12px)',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.4), 0 4px 6px -4px rgba(0, 0, 0, 0.3)',
            padding: '4px',
            zIndex: 100,
            boxSizing: 'border-box',
          }}
        >
          <button
            type="button"
            data-testid="user-menu-artifacts"
            className="polaris-menu-item"
            onClick={() => {
              setOpen(false);
              onNavigateArtifacts();
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
            </svg>
            <span>Artifacts</span>
          </button>

          <button
            type="button"
            data-testid="user-menu-settings"
            className="polaris-menu-item"
            onClick={() => {
              setOpen(false);
              onOpenSettings('general');
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z" />
            </svg>
            <span>Settings</span>
          </button>

          <button
            type="button"
            className="polaris-menu-item"
            onClick={() => {
              setOpen(false);
              onOpenUsage();
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2v4" />
              <path d="m4.93 4.93 2.83 2.83" />
              <path d="M2 12h4" />
              <path d="m4.93 19.07 2.83-2.83" />
              <path d="M12 18v4" />
              <path d="m19.07 19.07-2.83-2.83" />
              <path d="M18 12h4" />
              <path d="m19.07 4.93-2.83 2.83" />
            </svg>
            <span>Usage</span>
          </button>

          <div className="polaris-menu-separator" />

          <button
            type="button"
            className="polaris-menu-item"
            data-variant="destructive"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span>Sign out</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
