import type { ReactNode } from 'react';
import { useState, useRef, useEffect } from 'react';
import { Smile, Reply, MoreHorizontal, Copy } from 'lucide-react';

type MessageHoverMetadataProps = {
  side: 'start' | 'end';
  pinned?: boolean;
  children: ReactNode;
};

/**
 * MessageHoverMetadata: mirrors Polaris's MessageHoverMetadata component.
 * On desktop (pointer: fine), the action rail is hidden by default and reveals
 * beside the message bubble on hover or when focus-within / pinned.
 * On mobile/touch devices (hover: none), it remains in-flow below the bubble.
 */
export function MessageHoverMetadata({
  side,
  pinned = false,
  children,
}: MessageHoverMetadataProps) {
  return (
    <div
      data-testid="message-hover-rail"
      data-side={side}
      data-pinned={pinned ? 'true' : 'false'}
      style={{
        position: 'absolute',
        top: '50%',
        transform: 'translateY(-50%)',
        zIndex: 15,
        display: 'flex',
        alignItems: 'center',
        ...(side === 'end' ? { left: '100%', marginLeft: '6px' } : { right: '100%', marginRight: '6px' }),
      }}
    >
      {children}
    </div>
  );
}

type MessageHoverActionsProps = {
  content: string;
  side: 'start' | 'end';
  onReply: () => void;
  onReact: (emoji: string) => void;
  onCopy?: () => void;
};

/**
 * Polaris MessageHoverActions toolbar with ghost buttons:
 * - Emoji reaction trigger and picker popover (👍, ❤️, 🚀, 👀, 🎉)
 * - Reply trigger
 * - More dropdown with Copy action
 */
export function MessageHoverActions({
  content,
  side,
  onReply,
  onReact,
  onCopy,
}: MessageHoverActionsProps) {
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setReactionsOpen(false);
        setMoreOpen(false);
      }
    };
    if (reactionsOpen || moreOpen) {
      document.addEventListener('mousedown', handleDocumentClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
    };
  }, [reactionsOpen, moreOpen]);

  const copyMessage = () => {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(content).catch(() => undefined);
    setMoreOpen(false);
    onCopy?.();
  };

  const iconBtnStyle: React.CSSProperties = {
    display: 'grid',
    width: '1.75rem',
    height: '1.75rem',
    placeItems: 'center',
    background: 'transparent',
    border: 'none',
    borderRadius: 'var(--radius-sm, 6px)',
    color: 'var(--muted-foreground)',
    cursor: 'pointer',
    transition: 'color 150ms ease, background-color 150ms ease',
  };

  return (
    <MessageHoverMetadata pinned={reactionsOpen || moreOpen} side={side}>
      <div
        ref={containerRef}
        data-testid="message-hover-actions"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '2px',
          position: 'relative',
        }}
      >
        {/* Emoji reaction button & popover */}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            aria-label="React"
            title="React"
            style={iconBtnStyle}
            onClick={() => {
              setReactionsOpen(prev => !prev);
              setMoreOpen(false);
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--foreground)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted-foreground)')}
          >
            <Smile size={15} strokeWidth={1.7} />
          </button>
          {reactionsOpen && (
            <div
              style={{
                position: 'absolute',
                bottom: '100%',
                [side === 'end' ? 'left' : 'right']: 0,
                marginBottom: '6px',
                zIndex: 30,
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
                padding: '4px',
                borderRadius: 'var(--radius-lg, 12px)',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--popover)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
              }}
            >
              {['👍', '❤️', '🚀', '👀', '🎉'].map(emoji => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={emoji}
                  onClick={() => {
                    setReactionsOpen(false);
                    onReact(emoji);
                  }}
                  style={{
                    display: 'grid',
                    width: '2rem',
                    height: '2rem',
                    placeItems: 'center',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: 'var(--radius-sm, 6px)',
                    fontSize: '1.15rem',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--accent)')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Reply button */}
        <button
          type="button"
          aria-label="Reply"
          title="Reply"
          style={iconBtnStyle}
          onClick={onReply}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--foreground)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted-foreground)')}
        >
          <Reply size={15} strokeWidth={1.7} />
        </button>

        {/* More dropdown */}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            aria-label="More"
            title="More"
            style={iconBtnStyle}
            onClick={() => {
              setMoreOpen(prev => !prev);
              setReactionsOpen(false);
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--foreground)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted-foreground)')}
          >
            <MoreHorizontal size={15} strokeWidth={1.7} />
          </button>
          {moreOpen && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                [side === 'end' ? 'left' : 'right']: 0,
                marginTop: '4px',
                zIndex: 30,
                minWidth: '100px',
                borderRadius: 'var(--radius-md, 8px)',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--popover)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
                padding: '4px',
              }}
            >
              <button
                type="button"
                onClick={copyMessage}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '6px 10px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 'var(--radius-sm, 4px)',
                  color: 'var(--foreground)',
                  fontSize: '13px',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--accent)')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <Copy size={13} strokeWidth={1.7} />
                Copy
              </button>
            </div>
          )}
        </div>
      </div>
    </MessageHoverMetadata>
  );
}
