import { memo, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TextQuote } from 'lucide-react';

/**
 * Floating Quote action anchored to the selection's bounding rect. Measures
 * itself after mount so it can flip below the selection when there is no room
 * above and stay clamped inside the viewport; re-anchors on scroll/resize.
 */
export const QuoteSelectionButton = memo(function QuoteSelectionButton({
  range,
  onQuote,
}: {
  range: Range;
  onQuote: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [placement, setPlacement] = useState<{
    top: number;
    left: number;
    above: boolean;
  } | null>(null);

  useLayoutEffect(() => {
    const update = () => {
      if (range.collapsed || !document.contains(range.commonAncestorContainer)) {
        setPlacement(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      const width = buttonRef.current?.offsetWidth ?? 80;
      const height = buttonRef.current?.offsetHeight ?? 32;
      const above = rect.top >= height + 8;
      setPlacement({
        top: above ? rect.top - 8 : rect.bottom + 8,
        left: Math.min(
          Math.max(rect.left + rect.width / 2, width / 2 + 8),
          window.innerWidth - width / 2 - 8,
        ),
        above,
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, { capture: true, passive: true });
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [range]);

  return createPortal(
    <button
      ref={buttonRef}
      type="button"
      data-quote-selection
      data-testid="quote-selection-button"
      onMouseDown={(event) => {
        // Keep the highlight alive until the click commits the quote.
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={onQuote}
      style={{
        position: 'fixed',
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        borderRadius: '9999px',
        border: '1px solid var(--border)',
        backgroundColor: 'var(--background)',
        color: 'var(--foreground)',
        padding: '6px 12px',
        fontSize: '13px',
        fontWeight: 500,
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
        cursor: 'pointer',
        transform: placement?.above === false ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
        transition: 'background-color 150ms ease',
        ...(placement
          ? { top: placement.top, left: placement.left }
          : { visibility: 'hidden' }),
      }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--muted)')}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--background)')}
    >
      <TextQuote size={13} strokeWidth={2} />
      Quote
    </button>,
    document.body,
  );
});
