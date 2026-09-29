import {useEffect, useRef, useState} from 'react';

type Space = {
  id: string;
  name: string;
  description?: string;
};

const DEFAULT_SPACES: Space[] = [
  {id: 'default', name: 'Personal Space', description: 'Your private workspace and bots'},
  {id: 'team', name: 'Team Fleet', description: 'Shared fleet and operations'},
];

type Props = {
  activeSpaceId?: string;
  onSelectSpace?: (spaceId: string) => void;
};

/**
 * Polaris Space switcher popover at the top of the sidebar.
 */
export function SpaceSwitcher({activeSpaceId = 'default', onSelectSpace}: Props) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(activeSpaceId);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeSpace = DEFAULT_SPACES.find(s => s.id === selectedId) ?? DEFAULT_SPACES[0];

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
    <div ref={containerRef} style={{position: 'relative', width: '100%'}}>
      <button
        type="button"
        data-testid="space-switcher-trigger"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen(prev => !prev)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          padding: '6px 10px',
          borderRadius: 'var(--radius-md, 8px)',
          border: '1px solid transparent',
          backgroundColor: open ? 'var(--accent)' : 'transparent',
          color: 'var(--foreground)',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: '13px',
          fontWeight: 600,
          transition: 'background-color 120ms ease, border-color 120ms ease',
          boxSizing: 'border-box',
        }}
        onMouseEnter={e => {
          if (!open) e.currentTarget.style.backgroundColor = 'var(--muted)';
        }}
        onMouseLeave={e => {
          if (!open) e.currentTarget.style.backgroundColor = 'transparent';
        }}
      >
        <span style={{display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0}}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '20px',
              height: '20px',
              borderRadius: '4px',
              backgroundColor: 'var(--primary)',
              color: 'var(--primary-foreground)',
              fontSize: '11px',
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {activeSpace.name[0]}
          </span>
          <span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
            {activeSpace.name}
          </span>
        </span>
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{
            flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 150ms ease',
            color: 'var(--muted-foreground)',
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open ? (
        <div
          data-testid="space-switcher-popover"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            width: '240px',
            backgroundColor: 'var(--popover)',
            color: 'var(--popover-foreground)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg, 12px)',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.4), 0 4px 6px -4px rgba(0, 0, 0, 0.3)',
            padding: '6px',
            zIndex: 100,
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              padding: '6px 8px 4px 8px',
              fontSize: '11px',
              fontWeight: 600,
              color: 'var(--muted-foreground)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            Spaces
          </div>
          {DEFAULT_SPACES.map(space => {
            const isSelected = space.id === selectedId;
            return (
              <button
                key={space.id}
                type="button"
                onClick={() => {
                  setSelectedId(space.id);
                  onSelectSpace?.(space.id);
                  setOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '7px 8px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: isSelected ? 'var(--accent)' : 'transparent',
                  color: isSelected ? 'var(--foreground)' : 'var(--muted-foreground)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: '12.5px',
                  fontWeight: isSelected ? 600 : 400,
                }}
              >
                <div>
                  <div style={{color: 'var(--foreground)'}}>{space.name}</div>
                  {space.description ? (
                    <div style={{fontSize: '11px', color: 'var(--muted-foreground)'}}>
                      {space.description}
                    </div>
                  ) : null}
                </div>
                {isSelected ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
