import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Transcript } from '../Transcript';
import {
  transcriptIsNearEnd,
  transcriptMovedDown,
  transcriptCanSnapAfterFrame,
} from '../transcript-scroll';

describe('transcript-scroll helpers', () => {
  describe('transcriptIsNearEnd', () => {
    it('returns true when remaining scroll distance to bottom is less than 80px', () => {
      // scrollHeight: 1000, scrollTop: 600, clientHeight: 350 -> remaining: 50px (< 80)
      expect(
        transcriptIsNearEnd({
          scrollHeight: 1000,
          scrollTop: 600,
          clientHeight: 350,
        }),
      ).toBe(true);

      // exactly at the bottom (0px remaining)
      expect(
        transcriptIsNearEnd({
          scrollHeight: 1000,
          scrollTop: 650,
          clientHeight: 350,
        }),
      ).toBe(true);

      // 79px remaining (< 80)
      expect(
        transcriptIsNearEnd({
          scrollHeight: 1000,
          scrollTop: 571,
          clientHeight: 350,
        }),
      ).toBe(true);
    });

    it('returns false when remaining scroll distance to bottom is 80px or greater', () => {
      // exactly 80px remaining
      expect(
        transcriptIsNearEnd({
          scrollHeight: 1000,
          scrollTop: 570,
          clientHeight: 350,
        }),
      ).toBe(false);

      // scrolled high up: 400px remaining
      expect(
        transcriptIsNearEnd({
          scrollHeight: 1000,
          scrollTop: 250,
          clientHeight: 350,
        }),
      ).toBe(false);
    });
  });

  describe('transcriptMovedDown', () => {
    it('returns false when previous scroll position is null', () => {
      expect(transcriptMovedDown(null, 100)).toBe(false);
    });

    it('returns true when scrollTop is greater than or equal to previousScrollTop', () => {
      expect(transcriptMovedDown(100, 150)).toBe(true);
      expect(transcriptMovedDown(100, 100)).toBe(true);
    });

    it('returns false when scrollTop is less than previousScrollTop (scrolling up)', () => {
      expect(transcriptMovedDown(200, 150)).toBe(false);
    });
  });

  describe('transcriptCanSnapAfterFrame', () => {
    it('returns true only when element and queued scrollTop match', () => {
      const el = { scrollTop: 500 };
      expect(transcriptCanSnapAfterFrame(el, el, 500)).toBe(true);
      expect(transcriptCanSnapAfterFrame(el, el, 490)).toBe(false);
      expect(transcriptCanSnapAfterFrame({ scrollTop: 500 }, el, 500)).toBe(false);
      expect(transcriptCanSnapAfterFrame(null, el, 500)).toBe(false);
    });
  });
});

describe('Transcript Component - jumpToLatest Visibility & Behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders jumpToLatest button hidden by default when initially at the tail', () => {
    render(
      <Transcript>
        <div style={{ height: '2000px' }}>Long conversation content</div>
      </Transcript>,
    );

    const jumpButton = screen.getByTestId('jump-to-latest');
    expect(jumpButton).toBeInTheDocument();
    expect(jumpButton).toHaveAttribute('aria-hidden', 'true');
    expect(jumpButton).toHaveAttribute('tabIndex', '-1');
    expect(jumpButton.style.opacity).toBe('0');
  });

  it('reveals jumpToLatest when scrolled away from tail, and scrolls to bottom when clicked', async () => {
    const user = userEvent.setup();

    render(
      <Transcript>
        <div style={{ height: '2000px' }}>Long conversation content</div>
      </Transcript>,
    );

    const transcriptEl = screen.getByTestId('transcript');
    const jumpButton = screen.getByTestId('jump-to-latest');

    // Mock scroll dimensions on transcript element
    Object.defineProperty(transcriptEl, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(transcriptEl, 'clientHeight', { value: 500, configurable: true });
    Object.defineProperty(transcriptEl, 'scrollTop', { value: 500, configurable: true, writable: true });

    // Mock scrollTo on the element
    const scrollToMock = vi.fn();
    transcriptEl.scrollTo = scrollToMock;

    // Remaining distance = 2000 - 500 - 500 = 1000px (well over 80px)
    fireEvent.scroll(transcriptEl);

    // Button should now be visible
    expect(jumpButton).toHaveAttribute('aria-hidden', 'false');
    expect(jumpButton).toHaveAttribute('tabIndex', '0');
    expect(jumpButton.style.opacity).toBe('1');

    // Click jumpToLatest
    await user.click(jumpButton);

    expect(scrollToMock).toHaveBeenCalledTimes(1);
    expect(scrollToMock).toHaveBeenCalledWith(
      expect.objectContaining({
        top: 2000,
      }),
    );
  });

  it('hides jumpToLatest again when scrolled back near bottom', () => {
    render(
      <Transcript>
        <div style={{ height: '2000px' }}>Long conversation content</div>
      </Transcript>,
    );

    const transcriptEl = screen.getByTestId('transcript');
    const jumpButton = screen.getByTestId('jump-to-latest');

    Object.defineProperty(transcriptEl, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(transcriptEl, 'clientHeight', { value: 500, configurable: true });

    // 1. Scroll away from bottom -> visible
    Object.defineProperty(transcriptEl, 'scrollTop', { value: 1000, configurable: true, writable: true });
    fireEvent.scroll(transcriptEl);
    expect(jumpButton).toHaveAttribute('aria-hidden', 'false');
    expect(jumpButton.style.opacity).toBe('1');

    // 2. Scroll near bottom (2000 - 1460 - 500 = 40px < 80px) -> hidden
    Object.defineProperty(transcriptEl, 'scrollTop', { value: 1460, configurable: true, writable: true });
    fireEvent.scroll(transcriptEl);
    expect(jumpButton).toHaveAttribute('aria-hidden', 'true');
    expect(jumpButton.style.opacity).toBe('0');
  });
});
