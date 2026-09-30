import {useState, useRef, useCallback, type ReactNode} from 'react';

type App = 'terminal' | 'files';
type Position = {x: number; y: number};

const WINDOW_WIDTH = 560;

function defaultPosition(app: App, desktop: HTMLDivElement | null): Position {
  if (app === 'terminal') return {x: 32, y: 24};
  const width = desktop?.clientWidth ?? 0;
  return {x: Math.max(48, width - WINDOW_WIDTH - 32), y: 56};
}

export function ComputerWorkspace({
  botId: _botId,
  hasControl: _hasControl,
  dock = true,
  children,
  terminalContent,
  filesContent,
  onLaunchBrowser,
}: {
  botId: string;
  hasControl: boolean;
  dock?: boolean;
  children: ReactNode;
  terminalContent?: ReactNode;
  filesContent?: ReactNode;
  onLaunchBrowser?: () => void;
}) {
  const desktop = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<App[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [positions, setPositions] = useState<Partial<Record<App, Position>>>({});

  const screenVisible = collapsed || open.length === 0;

  const toggle = (app: App) => {
    if (collapsed) {
      setCollapsed(false);
      setOpen(current => [...current.filter(item => item !== app), app]);
      return;
    }
    setOpen(current =>
      current.includes(app) ? current.filter(item => item !== app) : [...current, app]
    );
  };

  const focus = (app: App) =>
    setOpen(current => [...current.filter(item => item !== app), app]);

  const move = useCallback(
    (app: App, position: Position) => setPositions(current => ({...current, [app]: position})),
    []
  );

  if (!dock) {
    return (
      <div className="relative h-full min-h-0" style={{position: 'relative', height: '100%', minHeight: 0}}>
        {children}
      </div>
    );
  }

  return (
    <div
      ref={desktop}
      data-testid="computer-desktop"
      className="relative h-full min-h-0 overflow-hidden"
      style={{
        position: 'relative',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        backgroundColor: '#000000',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Remote screen framebuffer body */}
      <div style={{position: 'relative', flex: 1, minHeight: 0, width: '100%', height: '100%'}}>
        {children}
      </div>

      {/* Floating Draggable WorkspaceWindows */}
      {open.includes('terminal') ? (
        <WorkspaceWindow
          title="Terminal"
          hidden={collapsed}
          bounds={desktop}
          position={positions['terminal'] ?? defaultPosition('terminal', desktop.current)}
          zIndex={10 + open.indexOf('terminal')}
          onMove={pos => move('terminal', pos)}
          onFocus={() => focus('terminal')}
          onClose={() => toggle('terminal')}
        >
          {terminalContent}
        </WorkspaceWindow>
      ) : null}

      {open.includes('files') ? (
        <WorkspaceWindow
          title="Files"
          hidden={collapsed}
          bounds={desktop}
          position={positions['files'] ?? defaultPosition('files', desktop.current)}
          zIndex={10 + open.indexOf('files')}
          onMove={pos => move('files', pos)}
          onFocus={() => focus('files')}
          onClose={() => toggle('files')}
        >
          {filesContent}
        </WorkspaceWindow>
      ) : null}

      {/* Polaris Floating Bottom Dock */}
      <nav
        data-testid="computer-workspace-dock"
        style={{
          position: 'absolute',
          bottom: '16px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 40,
          display: 'flex',
          gap: '4px',
          borderRadius: '16px',
          border: '1px solid var(--border)',
          backgroundColor: 'var(--card)',
          padding: '6px',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
          backdropFilter: 'blur(8px)',
        }}
      >
        <button
          type="button"
          aria-label="Browser"
          aria-pressed={screenVisible}
          onClick={() => {
            onLaunchBrowser?.();
            setCollapsed(false);
            setOpen([]);
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '40px',
            height: '40px',
            borderRadius: '12px',
            border: 'none',
            backgroundColor: screenVisible ? 'var(--accent)' : 'transparent',
            color: 'var(--foreground)',
            cursor: 'pointer',
            transition: 'background-color 150ms ease',
          }}
          title="Open Browser"
        >
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
        </button>

        <button
          type="button"
          aria-label="Terminal"
          aria-pressed={!collapsed && open.includes('terminal')}
          onClick={() => toggle('terminal')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '40px',
            height: '40px',
            borderRadius: '12px',
            border: 'none',
            backgroundColor: !collapsed && open.includes('terminal') ? 'var(--accent)' : 'transparent',
            color: 'var(--foreground)',
            cursor: 'pointer',
            transition: 'background-color 150ms ease',
          }}
          title="Toggle Terminal"
        >
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
        </button>

        <button
          type="button"
          aria-label="Files"
          aria-pressed={!collapsed && open.includes('files')}
          onClick={() => toggle('files')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '40px',
            height: '40px',
            borderRadius: '12px',
            border: 'none',
            backgroundColor: !collapsed && open.includes('files') ? 'var(--accent)' : 'transparent',
            color: 'var(--foreground)',
            cursor: 'pointer',
            transition: 'background-color 150ms ease',
          }}
          title="Toggle Files"
        >
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      </nav>
    </div>
  );
}

function WorkspaceWindow({
  title,
  hidden,
  bounds,
  position,
  zIndex,
  onMove,
  onFocus,
  onClose,
  children,
}: {
  title: string;
  hidden: boolean;
  bounds: React.RefObject<HTMLDivElement | null>;
  position: Position;
  zIndex: number;
  onMove: (position: Position) => void;
  onFocus: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const drag = useRef<{dx: number; dy: number} | null>(null);

  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('button')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {dx: event.clientX - position.x, dy: event.clientY - position.y};
  }

  function dragTo(event: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const area = bounds.current?.getBoundingClientRect();
    const x = event.clientX - drag.current.dx;
    const y = event.clientY - drag.current.dy;
    onMove({
      x: area ? Math.min(Math.max(x, -200), area.width - 120) : x,
      y: area ? Math.min(Math.max(y, 0), area.height - 40) : y,
    });
  }

  return (
    <section
      aria-label={title}
      hidden={hidden}
      style={{
        position: 'absolute',
        left: `${position.x}px`,
        top: `${position.y}px`,
        zIndex,
        width: 'min(560px, calc(100% - 32px))',
        height: 'min(420px, 70%)',
        display: hidden ? 'none' : 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderRadius: '12px',
        border: '1px solid var(--border)',
        backgroundColor: 'var(--card)',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6)',
      }}
      onPointerDownCapture={onFocus}
    >
      <div
        style={{
          display: 'flex',
          cursor: 'grab',
          touchAction: 'none',
          alignItems: 'center',
          gap: '8px',
          borderBottom: '1px solid var(--border)',
          padding: '4px 4px 4px 12px',
          userSelect: 'none',
          backgroundColor: 'var(--muted, var(--card))',
        }}
        onPointerDown={startDrag}
        onPointerMove={dragTo}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        <span style={{flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '13px', fontWeight: 500, color: 'var(--foreground)'}}>
          {title}
        </span>
        <button
          type="button"
          aria-label={`Close ${title}`}
          onClick={onClose}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '24px',
            height: '24px',
            borderRadius: 'var(--radius-sm)',
            border: 'none',
            backgroundColor: 'transparent',
            color: 'var(--muted-foreground)',
            cursor: 'pointer',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.backgroundColor = 'var(--accent)';
            e.currentTarget.style.color = 'var(--foreground)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.color = 'var(--muted-foreground)';
          }}
        >
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div style={{minHeight: 0, flex: 1, overflow: 'hidden'}}>
        {children}
      </div>
    </section>
  );
}
