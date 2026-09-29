import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { ArrowDown } from 'lucide-react';
import { transcriptIsNearEnd, transcriptMovedDown } from './transcript-scroll';

type TranscriptProps = {
  children: ReactNode;
  scrollRef?: RefObject<HTMLDivElement | null>;
  trackDep?: unknown;
  isStreaming?: boolean;
};

/**
 * Rebuilt Transcript container mirroring Polaris Shell.tsx:4506-4963.
 * Features:
 * - High-frequency streaming tail-following.
 * - Scroll-lock release on upward wheel / pointer gesture.
 * - Resumes following when scrolled back near bottom.
 * - Floating jumpToLatest button (with ArrowDown icon) appearing when scrolled away.
 * - Standard Polaris padding and .rk-scroll custom scrollbar.
 */
export const Transcript = memo(function Transcript({
  children,
  scrollRef: externalScrollRef,
  trackDep,
  isStreaming = false,
}: TranscriptProps) {
  const internalScrollRef = useRef<HTMLDivElement>(null);
  const scrollRef = externalScrollRef || internalScrollRef;

  const [atEnd, setAtEnd] = useState(true);
  const following = useRef(true);
  const autoScrolling = useRef(false);
  const lastScrollTop = useRef<number | null>(null);
  const autoScrollTimer = useRef<number | undefined>(undefined);
  const jumpButtonRef = useRef<HTMLButtonElement>(null);

  const snapToEnd = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    following.current = true;
    autoScrolling.current = false;
    setAtEnd(true);
    element.scrollTo({ top: element.scrollHeight, behavior: 'auto' });
  }, [scrollRef]);

  const jumpToLatest = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    following.current = true;
    autoScrolling.current = !reducedMotion;
    setAtEnd(true);
    element.scrollTo({
      top: element.scrollHeight,
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
    window.clearTimeout(autoScrollTimer.current);
    autoScrollTimer.current = window.setTimeout(
      () => {
        autoScrolling.current = false;
      },
      reducedMotion ? 0 : 2_000,
    );
  }, [scrollRef]);

  useLayoutEffect(() => {
    if (following.current) {
      snapToEnd();
    }
  }, [trackDep, isStreaming, snapToEnd]);

  useLayoutEffect(() => {
    const button = jumpButtonRef.current;
    if (atEnd && button && document.activeElement === button) {
      button.blur();
    }
  }, [atEnd]);

  useEffect(
    () => () => {
      window.clearTimeout(autoScrollTimer.current);
    },
    [],
  );

  return (
    <div className="relative flex min-h-0 flex-1" style={{ position: 'relative', flex: 1, minHeight: 0 }}>
      <div
        ref={scrollRef}
        data-testid="transcript"
        onPointerDown={(event) => {
          lastScrollTop.current = event.currentTarget.scrollTop;
          autoScrolling.current = false;
          following.current = false;
        }}
        onTouchStart={(event) => {
          lastScrollTop.current = event.currentTarget.scrollTop;
          autoScrolling.current = false;
          following.current = false;
        }}
        onWheel={(event) => {
          if (event.deltaY < 0) {
            lastScrollTop.current = event.currentTarget.scrollTop;
            autoScrolling.current = false;
            following.current = false;
          }
        }}
        onScroll={(event) => {
          const scrolledDown = transcriptMovedDown(
            lastScrollTop.current,
            event.currentTarget.scrollTop,
          );
          lastScrollTop.current = event.currentTarget.scrollTop;
          const nearEnd = transcriptIsNearEnd(event.currentTarget);
          setAtEnd(nearEnd);
          if (nearEnd) {
            if (scrolledDown) following.current = true;
            if (autoScrolling.current) {
              autoScrolling.current = false;
              window.clearTimeout(autoScrollTimer.current);
            }
          } else if (!autoScrolling.current) {
            following.current = false;
          }
        }}
        className="rk-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-5 md:px-7 md:py-6"
        style={{
          display: 'flex',
          flex: 1,
          minHeight: 0,
          flexDirection: 'column',
          gap: 'var(--spacing-2, 0.5rem)',
          overflowY: 'auto',
          padding: '1.25rem 1rem',
        }}
      >
        {children}
      </div>

      <button
        ref={jumpButtonRef}
        type="button"
        aria-label="Jump to latest"
        data-testid="jump-to-latest"
        aria-hidden={atEnd}
        tabIndex={atEnd ? -1 : 0}
        onClick={jumpToLatest}
        style={{
          position: 'absolute',
          bottom: '1rem',
          left: '50%',
          zIndex: 20,
          display: 'grid',
          width: '2.25rem',
          height: '2.25rem',
          transform: atEnd ? 'translate(-50%, 0.5rem)' : 'translate(-50%, 0)',
          placeItems: 'center',
          borderRadius: '9999px',
          border: '1px solid var(--border)',
          backgroundColor: 'color-mix(in srgb, var(--muted) 95%, transparent)',
          color: 'var(--foreground)',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
          backdropFilter: 'blur(8px)',
          transition: 'opacity 200ms ease, transform 200ms ease, background-color 200ms ease',
          opacity: atEnd ? 0 : 1,
          pointerEvents: atEnd ? 'none' : 'auto',
          cursor: 'pointer',
        }}
      >
        <ArrowDown size={17} strokeWidth={1.8} />
      </button>
    </div>
  );
});
