import {useState, useRef, useEffect} from 'react';
import {resetComputer} from './api';

type Props = {
  botId: string;
  onChanged?: () => Promise<void> | void;
};

export function ComputerMaintenanceActions({botId, onChanged}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [menuOpen]);

  const handleRunReset = async () => {
    setIsResetting(true);
    setError(null);
    try {
      await resetComputer(botId);
      setConfirmReset(false);
      setMenuOpen(false);
      if (onChanged) await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset computer');
    } finally {
      setIsResetting(false);
    }
  };

  const handleRunRecover = async () => {
    setIsResetting(true);
    setError(null);
    try {
      await resetComputer(botId);
      setMenuOpen(false);
      if (onChanged) await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not recover computer');
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div style={{position: 'relative'}} ref={menuRef}>
      <button
        type="button"
        data-testid="computer-more-button"
        aria-label="More computer actions"
        onClick={() => {
          setError(null);
          setMenuOpen(prev => !prev);
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '28px',
          height: '28px',
          borderRadius: 'var(--radius-sm)',
          border: 'none',
          backgroundColor: 'transparent',
          color: 'var(--muted-foreground)',
          cursor: 'pointer',
          transition: 'background-color 150ms ease, color 150ms ease',
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
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="1" fill="currentColor" />
          <circle cx="19" cy="12" r="1" fill="currentColor" />
          <circle cx="5" cy="12" r="1" fill="currentColor" />
        </svg>
      </button>

      {menuOpen ? (
        <div
          data-testid="computer-more-menu"
          style={{
            position: 'absolute',
            right: 0,
            top: '100%',
            marginTop: '4px',
            minWidth: '176px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)',
            backgroundColor: 'var(--popover, var(--card))',
            color: 'var(--foreground)',
            padding: '4px',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)',
            zIndex: 50,
          }}
        >
          <button
            type="button"
            onClick={() => void handleRunRecover()}
            disabled={isResetting}
            style={{
              width: '100%',
              textAlign: 'left',
              padding: '6px 10px',
              fontSize: '13px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              backgroundColor: 'transparent',
              color: 'var(--foreground)',
              cursor: 'pointer',
            }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--accent)')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            Recover computer
          </button>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setConfirmReset(true);
            }}
            disabled={isResetting}
            style={{
              width: '100%',
              textAlign: 'left',
              padding: '6px 10px',
              fontSize: '13px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              backgroundColor: 'transparent',
              color: 'var(--foreground)',
              cursor: 'pointer',
            }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--accent)')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            Reset computer
          </button>
          {error ? (
            <p style={{padding: '4px 8px', margin: 0, fontSize: '12px', color: 'var(--destructive)'}}>{error}</p>
          ) : null}
        </div>
      ) : null}

      {/* Polaris AlertDialog for Reset Computer confirmation */}
      {confirmReset ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            backgroundColor: 'var(--overlay)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
          onClick={() => setConfirmReset(false)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '400px',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--card)',
              color: 'var(--foreground)',
              padding: '20px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{margin: '0 0 8px 0', fontSize: '16px', fontWeight: 600}}>Reset computer?</h3>
            <p style={{margin: '0 0 16px 0', fontSize: '13.5px', color: 'var(--muted-foreground)'}}>
              Restore the last saved workspace. Unsaved work on the computer is lost.
            </p>
            {error ? (
              <p style={{margin: '0 0 12px 0', fontSize: '12.5px', color: 'var(--destructive)'}}>{error}</p>
            ) : null}
            <div style={{display: 'flex', justifyContent: 'flex-end', gap: '8px'}}>
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border)',
                  backgroundColor: 'transparent',
                  color: 'var(--foreground)',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleRunReset()}
                disabled={isResetting}
                style={{
                  padding: '6px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: 'none',
                  backgroundColor: 'var(--destructive)',
                  color: 'var(--destructive-foreground)',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                {isResetting ? 'Resetting…' : 'Reset'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
