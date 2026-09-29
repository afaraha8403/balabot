import {useEffect, useRef, useState} from 'react';
import {
  pauseBot,
  resolveIntervention,
  type InterventionPayload,
} from './api';

type Props = {
  botId: string;
  botName: string;
  isStreaming: boolean;
  onStopStreaming: () => void;
  activeIntervention: InterventionPayload | null;
  onInterventionChange: (iv: InterventionPayload | null) => void;
  onNotify: (msg: string) => void;
  onOpenComputer?: () => void;
};

/**
 * Polaris HoldEverythingControl:
 * Restyled to a Polaris warning pill button and popover.
 * Allows pausing a running turn, entering owner steering guidance,
 * approving running turns, or denying and terminating turns.
 */
export function HoldEverythingControl({
  botId,
  botName,
  isStreaming,
  onStopStreaming,
  activeIntervention,
  onInterventionChange,
  onNotify,
  onOpenComputer,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [steerNote, setSteerNote] = useState('');
  const [showSteerInput, setShowSteerInput] = useState(false);
  const [busy, setBusy] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isPending =
    activeIntervention &&
    (activeIntervention.state === 'pending' || activeIntervention.status === 'pending');

  const isExpired = activeIntervention?.state === 'expired';
  const isAccepted =
    activeIntervention?.state === 'accepted' || activeIntervention?.status === 'approved';
  const isRejected =
    activeIntervention?.state === 'rejected' || activeIntervention?.status === 'denied';

  // Close dropdown on outside click or escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setShowSteerInput(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
        setShowSteerInput(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleHold = async () => {
    setBusy(true);
    try {
      const res = await pauseBot(botId, 'Owner requested hold');
      if (res.ok && res.record) {
        onInterventionChange(res.record);
        onNotify(`Hold active: ${botName}'s turn paused by owner.`);
      }
    } catch (err) {
      onNotify(`Could not pause ${botName}: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleResolve = async (action: 'approve' | 'deny', note = '') => {
    if (!activeIntervention?.resume_token) return;
    setBusy(true);
    try {
      const res = await resolveIntervention(
        activeIntervention.resume_token,
        action,
        note,
      );
      const rec = res.record;
      if (rec.state === 'expired') {
        onNotify('Intervention expired: this turn has already ended.');
        onInterventionChange(rec);
      } else if (rec.state === 'accepted') {
        onNotify(`Intervention accepted: ${botName} resumed.`);
        onInterventionChange(null);
        setIsOpen(false);
        setShowSteerInput(false);
      } else if (rec.state === 'rejected') {
        onNotify(`Intervention declined: ${botName} turn ended.`);
        onInterventionChange(null);
        onStopStreaming();
        setIsOpen(false);
        setShowSteerInput(false);
      } else {
        onInterventionChange(rec);
      }
    } catch (err) {
      onNotify(`Resolve failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={dropdownRef} style={{position: 'relative', display: 'inline-block'}}>
      {/* Polaris warning pill button reachable in accessibility tree */}
      <button
        type="button"
        data-testid="hold-everything-control"
        aria-label="Hold everything"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(prev => !prev)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          borderRadius: '9999px',
          border: '1px solid rgba(233, 196, 106, 0.4)',
          backgroundColor: isPending
            ? 'rgba(233, 196, 106, 0.25)'
            : isStreaming
              ? 'rgba(233, 196, 106, 0.15)'
              : 'rgba(233, 196, 106, 0.08)',
          color: 'var(--warning)',
          padding: '4px 12px',
          fontSize: '12px',
          fontWeight: 500,
          cursor: 'pointer',
          transition: 'all 150ms ease',
          fontFamily: 'inherit',
          outline: 'none',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.backgroundColor = 'rgba(233, 196, 106, 0.2)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.backgroundColor = isPending
            ? 'rgba(233, 196, 106, 0.25)'
            : isStreaming
              ? 'rgba(233, 196, 106, 0.15)'
              : 'rgba(233, 196, 106, 0.08)';
        }}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <span>
          {isPending ? 'Hold everything (Paused)' : 'Hold everything'}
        </span>
      </button>

      {/* Polaris DropdownMenuContent popover */}
      {isOpen ? (
        <div
          role="menu"
          aria-label="Hold everything options"
          style={{
            position: 'absolute',
            top: 'calc(100% + var(--spacing-1, 4px))',
            right: 0,
            zIndex: 1000,
            minWidth: '280px',
            maxWidth: '360px',
            backgroundColor: 'var(--popover)',
            color: 'var(--popover-foreground)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg, 12px)',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.4), 0 4px 6px -4px rgba(0, 0, 0, 0.3)',
            padding: '12px',
            boxSizing: 'border-box',
          }}
        >
          <div style={{display: 'flex', flexDirection: 'column', gap: '10px'}}>
            <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
              <span style={{fontSize: '13px', fontWeight: 600, color: 'var(--foreground)'}}>
                Hold & Intervention
              </span>
              {isPending ? (
                <span
                  style={{
                    backgroundColor: 'rgba(233, 196, 106, 0.2)',
                    color: 'var(--warning)',
                    border: '1px solid rgba(233, 196, 106, 0.4)',
                    padding: '2px 8px',
                    borderRadius: '9999px',
                    fontSize: '11px',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                  }}
                >
                  PAUSED
                </span>
              ) : isStreaming ? (
                <span
                  style={{
                    backgroundColor: 'var(--muted)',
                    color: 'var(--muted-foreground)',
                    border: '1px solid var(--border)',
                    padding: '2px 8px',
                    borderRadius: '9999px',
                    fontSize: '11px',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                  }}
                >
                  RUNNING
                </span>
              ) : (
                <span
                  style={{
                    backgroundColor: 'var(--muted)',
                    color: 'var(--muted-foreground)',
                    border: '1px solid var(--border)',
                    padding: '2px 8px',
                    borderRadius: '9999px',
                    fontSize: '11px',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                  }}
                >
                  IDLE
                </span>
              )}
            </div>

            {/* Current State Details */}
            {isPending ? (
              <div
                style={{
                  backgroundColor: 'var(--muted)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md, 8px)',
                  padding: '10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                }}
              >
                <div style={{display: 'flex', alignItems: 'center', gap: '6px'}}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="2">
                    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <span style={{fontSize: '12.5px', fontWeight: 500, color: 'var(--foreground)'}}>
                    {activeIntervention.reason || 'Bot paused — awaiting human decision'}
                  </span>
                </div>
                {activeIntervention.hint ? (
                  <p style={{margin: 0, fontSize: '11.5px', color: 'var(--muted-foreground)'}}>
                    Hint: {activeIntervention.hint}
                  </p>
                ) : null}
                {activeIntervention.expires_at ? (
                  <p style={{margin: 0, fontSize: '11.5px', color: 'var(--muted-foreground)'}}>
                    Expires: {new Date(activeIntervention.expires_at).toLocaleTimeString()}
                  </p>
                ) : null}
              </div>
            ) : null}

            {isExpired ? (
              <div
                style={{
                  backgroundColor: 'var(--muted)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md, 8px)',
                  padding: '8px 10px',
                  fontSize: '12px',
                  color: 'var(--muted-foreground)',
                }}
              >
                Intervention expired: the targeted turn has ended.
              </div>
            ) : null}

            {isAccepted ? (
              <div
                style={{
                  backgroundColor: 'rgba(78, 203, 113, 0.1)',
                  border: '1px solid rgba(78, 203, 113, 0.3)',
                  borderRadius: 'var(--radius-md, 8px)',
                  padding: '8px 10px',
                  fontSize: '12px',
                  color: 'var(--success)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>Intervention was accepted. Bot resumed.</span>
              </div>
            ) : null}

            {isRejected ? (
              <div
                style={{
                  backgroundColor: 'var(--muted)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md, 8px)',
                  padding: '8px 10px',
                  fontSize: '12px',
                  color: 'var(--muted-foreground)',
                }}
              >
                Intervention was declined. Turn ended.
              </div>
            ) : null}

            {/* Action buttons */}
            {!isPending ? (
              <button
                type="button"
                disabled={busy || !isStreaming}
                onClick={() => void handleHold()}
                style={{
                  width: '100%',
                  padding: '7px 12px',
                  borderRadius: '9999px',
                  border: '1px solid rgba(233, 196, 106, 0.5)',
                  backgroundColor: 'rgba(233, 196, 106, 0.15)',
                  color: 'var(--warning)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: busy || !isStreaming ? 'not-allowed' : 'pointer',
                  opacity: busy || !isStreaming ? 0.5 : 1,
                  transition: 'background-color 120ms ease',
                  fontFamily: 'inherit',
                }}
                onMouseEnter={e => {
                  if (!busy && isStreaming) e.currentTarget.style.backgroundColor = 'rgba(233, 196, 106, 0.25)';
                }}
                onMouseLeave={e => {
                  if (!busy && isStreaming) e.currentTarget.style.backgroundColor = 'rgba(233, 196, 106, 0.15)';
                }}
              >
                {busy ? 'Pausing…' : 'Pause turn (Hold everything)'}
              </button>
            ) : (
              <div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
                <div style={{display: 'flex', gap: '8px'}}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleResolve('approve')}
                    style={{
                      flex: 1,
                      padding: '6px 12px',
                      borderRadius: '9999px',
                      border: 'none',
                      backgroundColor: 'var(--primary)',
                      color: 'var(--primary-foreground)',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: busy ? 'not-allowed' : 'pointer',
                      opacity: busy ? 0.6 : 1,
                      fontFamily: 'inherit',
                    }}
                  >
                    Approve & Continue
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleResolve('deny')}
                    style={{
                      flex: 1,
                      padding: '6px 12px',
                      borderRadius: '9999px',
                      border: '1px solid var(--border)',
                      backgroundColor: 'transparent',
                      color: 'var(--foreground)',
                      fontSize: '12px',
                      fontWeight: 500,
                      cursor: busy ? 'not-allowed' : 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    Deny & Halt
                  </button>
                </div>

                {onOpenComputer ? (
                  <button
                    type="button"
                    onClick={() => {
                      setIsOpen(false);
                      onOpenComputer();
                    }}
                    style={{
                      width: '100%',
                      padding: '6px 12px',
                      borderRadius: '9999px',
                      border: '1px solid var(--border)',
                      backgroundColor: 'var(--muted)',
                      color: 'var(--foreground)',
                      fontSize: '12px',
                      fontWeight: 500,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    Open Agent Computer
                  </button>
                ) : null}

                {/* Steering flow */}
                {!showSteerInput ? (
                  <button
                    type="button"
                    onClick={() => setShowSteerInput(true)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--muted-foreground)',
                      fontSize: '12px',
                      cursor: 'pointer',
                      textAlign: 'center',
                      padding: '4px',
                      textDecoration: 'underline',
                      fontFamily: 'inherit',
                    }}
                  >
                    Steer turn with guidance…
                  </button>
                ) : (
                  <div style={{display: 'flex', flexDirection: 'column', gap: '6px'}}>
                    <input
                      type="text"
                      aria-label="Steering note"
                      placeholder="Instructions for the paused bot…"
                      value={steerNote}
                      onChange={e => setSteerNote(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        borderRadius: 'var(--radius-md, 8px)',
                        border: '1px solid var(--border)',
                        backgroundColor: 'var(--input)',
                        color: 'var(--foreground)',
                        fontSize: '12px',
                        outline: 'none',
                        boxSizing: 'border-box',
                        fontFamily: 'inherit',
                      }}
                    />
                    <div style={{display: 'flex', gap: '6px'}}>
                      <button
                        type="button"
                        disabled={busy || !steerNote.trim()}
                        onClick={() => void handleResolve('approve', steerNote.trim())}
                        style={{
                          flex: 1,
                          padding: '5px 10px',
                          borderRadius: '9999px',
                          border: 'none',
                          backgroundColor: 'var(--primary)',
                          color: 'var(--primary-foreground)',
                          fontSize: '11.5px',
                          fontWeight: 600,
                          cursor: busy || !steerNote.trim() ? 'not-allowed' : 'pointer',
                          opacity: busy || !steerNote.trim() ? 0.5 : 1,
                          fontFamily: 'inherit',
                        }}
                      >
                        Resume with guidance
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowSteerInput(false)}
                        style={{
                          padding: '5px 10px',
                          borderRadius: '9999px',
                          border: '1px solid var(--border)',
                          backgroundColor: 'transparent',
                          color: 'var(--muted-foreground)',
                          fontSize: '11.5px',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {(isExpired || isAccepted || isRejected) && (
              <button
                type="button"
                onClick={() => {
                  onInterventionChange(null);
                  setIsOpen(false);
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--muted-foreground)',
                  fontSize: '12px',
                  cursor: 'pointer',
                  padding: '4px',
                  textAlign: 'center',
                  fontFamily: 'inherit',
                }}
              >
                Dismiss status
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
