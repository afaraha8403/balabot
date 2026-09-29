import {useState, useRef, useEffect} from 'react';

type Props = {
  botId: string;
  busy?: boolean;
  onStartRecording: (goal: string) => void | Promise<void>;
};

export function TeachComputerOverlayControl({
  botId: _botId,
  busy,
  onStartRecording,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [goal, setGoal] = useState('');
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const handleStart = async () => {
    if (!goal.trim() || busy) return;
    const reqGoal = goal.trim();
    setIsOpen(false);
    setGoal('');
    await onStartRecording(reqGoal);
  };

  return (
    <div style={{position: 'relative'}} ref={popoverRef}>
      <button
        type="button"
        data-testid="teach-start-button"
        aria-label="Teach a task"
        disabled={busy}
        onClick={() => setIsOpen(prev => !prev)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 12px',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
          backgroundColor: 'transparent',
          color: 'var(--foreground)',
          fontSize: '13px',
          fontWeight: 500,
          cursor: busy ? 'not-allowed' : 'pointer',
          opacity: busy ? 0.6 : 1,
          transition: 'background-color 150ms ease, border-color 150ms ease',
        }}
        onMouseEnter={e => {
          if (!busy) e.currentTarget.style.backgroundColor = 'var(--accent)';
        }}
        onMouseLeave={e => {
          if (!busy) e.currentTarget.style.backgroundColor = 'transparent';
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block',
            width: '8px',
            height: '8px',
            borderRadius: '9999px',
            border: '1.5px solid currentColor',
          }}
        />
        <span>Teach a task</span>
      </button>

      {isOpen ? (
        <div
          data-testid="teach-chrome-popover"
          style={{
            position: 'absolute',
            right: 0,
            top: '100%',
            marginTop: '8px',
            width: 'min(360px, calc(100vw - 2rem))',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border)',
            backgroundColor: 'var(--popover, var(--card))',
            color: 'var(--foreground)',
            padding: '16px',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)',
            zIndex: 60,
          }}
        >
          <label
            htmlFor="teach-goal-input"
            style={{
              display: 'block',
              marginBottom: '6px',
              fontSize: '13px',
              color: 'var(--muted-foreground)',
              fontWeight: 400,
            }}
          >
            What result will you demonstrate?
          </label>
          <textarea
            id="teach-goal-input"
            data-testid="teach-goal-input"
            rows={3}
            value={goal}
            onChange={e => setGoal(e.target.value)}
            placeholder="Export this week's list from the CRM and drop it in the shared folder"
            style={{
              width: '100%',
              padding: '8px 10px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--input, var(--muted))',
              color: 'var(--foreground)',
              fontSize: '13px',
              boxSizing: 'border-box',
              outline: 'none',
              fontFamily: 'inherit',
              resize: 'vertical',
            }}
          />
          <div style={{display: 'flex', gap: '8px', marginTop: '12px'}}>
            <button
              type="button"
              disabled={busy || !goal.trim()}
              onClick={() => void handleStart()}
              style={{
                padding: '6px 14px',
                borderRadius: 'var(--radius-md)',
                border: 'none',
                backgroundColor: 'var(--primary)',
                color: 'var(--primary-foreground)',
                fontSize: '13px',
                fontWeight: 500,
                cursor: busy || !goal.trim() ? 'not-allowed' : 'pointer',
                opacity: busy || !goal.trim() ? 0.6 : 1,
              }}
            >
              Start recording
            </button>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
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
          </div>
        </div>
      ) : null}
    </div>
  );
}
