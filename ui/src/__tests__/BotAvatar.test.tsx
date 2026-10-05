import {describe, expect, it, vi, beforeEach} from 'vitest';
import {render, screen} from '@testing-library/react';
import {BotAvatar} from '../BotAvatar';

describe('BotAvatar Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('accessibility and state attributes', () => {
    it('renders role="img" with name and resolved state in aria-label', () => {
      render(<BotAvatar identity="bot-1" name="Maya" state="thinking" />);
      const avatar = screen.getByRole('img');
      expect(avatar).toHaveAttribute('data-state', 'thinking');
      expect(avatar).toHaveAttribute('aria-label', 'Maya — thinking');
    });

    it('defaults to idle state and Agent name when omitted', () => {
      render(<BotAvatar identity="bot-1" />);
      const avatar = screen.getByRole('img');
      expect(avatar).toHaveAttribute('data-state', 'idle');
      expect(avatar).toHaveAttribute('aria-label', 'bot-1 — idle');
    });

    it('supports legacy status prop mapped to MascotState', () => {
      render(<BotAvatar identity="bot-1" name="Bala" status="working" />);
      const avatar = screen.getByRole('img');
      expect(avatar).toHaveAttribute('data-state', 'working');
      expect(avatar).toHaveAttribute('aria-label', 'Bala — working');
    });

    it('marks all inner decorative SVGs and glyphs as aria-hidden', () => {
      const {container} = render(<BotAvatar identity="bot-1" name="Maya" state="needs_you" />);
      const innerSvgs = container.querySelectorAll('svg');
      expect(innerSvgs.length).toBeGreaterThan(0);
      innerSvgs.forEach(svg => {
        expect(svg).toHaveAttribute('aria-hidden', 'true');
      });
    });
  });

  describe('state glyph above the head', () => {
    it('does not render glyph when idle or sleeping', () => {
      const {rerender} = render(<BotAvatar state="idle" />);
      expect(screen.queryByTestId('mascot-glyph')).not.toBeInTheDocument();

      rerender(<BotAvatar state="sleeping" />);
      expect(screen.queryByTestId('mascot-glyph')).not.toBeInTheDocument();
    });

    it('renders thought dots glyph when working or thinking', () => {
      const {rerender} = render(<BotAvatar state="working" />);
      const workingGlyph = screen.getByTestId('mascot-glyph');
      expect(workingGlyph).toBeInTheDocument();
      expect(workingGlyph).toHaveAttribute('data-glyph-type', 'dots');

      rerender(<BotAvatar state="thinking" />);
      const thinkingGlyph = screen.getByTestId('mascot-glyph');
      expect(thinkingGlyph).toHaveAttribute('data-glyph-type', 'dots');
    });

    it('renders OrbState tool family searching with orbiting ring and dots glyph', () => {
      render(<BotAvatar identity="maya" name="Maya" state="searching" />);
      const avatar = screen.getByRole('img');
      expect(avatar).toHaveAttribute('data-state', 'searching');
      expect(avatar).toHaveAttribute('aria-label', 'Maya — searching');
      expect(screen.getByTestId('mascot-ring')).toHaveAttribute('data-mode', 'orbit');
      expect(screen.getByTestId('mascot-glyph')).toHaveAttribute('data-glyph-type', 'dots');
    });

    it('renders question mark glyph for needs_you state', () => {
      render(<BotAvatar state="needs_you" />);
      const glyph = screen.getByTestId('mascot-glyph');
      expect(glyph).toHaveAttribute('data-glyph-type', 'needs_you');
      expect(glyph.textContent).toContain('?');
    });

    it('renders exclamation glyph for error state', () => {
      render(<BotAvatar state="error" />);
      const glyph = screen.getByTestId('mascot-glyph');
      expect(glyph).toHaveAttribute('data-glyph-type', 'error');
      expect(glyph.textContent).toContain('!');
    });

    it('renders checkmark/sparkle glyph for finished state', () => {
      render(<BotAvatar state="finished" />);
      const glyph = screen.getByTestId('mascot-glyph');
      expect(glyph).toHaveAttribute('data-glyph-type', 'finished');
    });
  });

  describe('status ring behavior', () => {
    it('does not render status ring when idle or sleeping', () => {
      const {rerender} = render(<BotAvatar state="idle" />);
      expect(screen.queryByTestId('mascot-ring')).not.toBeInTheDocument();

      rerender(<BotAvatar state="sleeping" />);
      expect(screen.queryByTestId('mascot-ring')).not.toBeInTheDocument();
    });

    it('renders orbiting arc ring while busy (working, tool, thinking)', () => {
      const {rerender} = render(<BotAvatar state="working" />);
      let ring = screen.getByTestId('mascot-ring');
      expect(ring).toHaveAttribute('data-mode', 'orbit');

      rerender(<BotAvatar state="tool" />);
      ring = screen.getByTestId('mascot-ring');
      expect(ring).toHaveAttribute('data-mode', 'orbit');

      rerender(<BotAvatar state="thinking" />);
      ring = screen.getByTestId('mascot-ring');
      expect(ring).toHaveAttribute('data-mode', 'orbit');
    });

    it('renders steady soft ring for needs_you, error, and finished', () => {
      const {rerender} = render(<BotAvatar state="needs_you" />);
      let ring = screen.getByTestId('mascot-ring');
      expect(ring).toHaveAttribute('data-mode', 'steady');

      rerender(<BotAvatar state="error" />);
      ring = screen.getByTestId('mascot-ring');
      expect(ring).toHaveAttribute('data-mode', 'steady');

      rerender(<BotAvatar state="finished" />);
      ring = screen.getByTestId('mascot-ring');
      expect(ring).toHaveAttribute('data-mode', 'steady');
    });
  });

  describe('photo profile image branch (data:image/...)', () => {
    const mockPhoto = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    it('renders photo image while applying state attributes, ring, and glyph', () => {
      render(<BotAvatar color={mockPhoto} name="Custom Agent" state="needs_you" />);
      const avatar = screen.getByRole('img');
      expect(avatar).toHaveAttribute('data-state', 'needs_you');
      expect(avatar).toHaveAttribute('aria-label', 'Custom Agent — needs your input');

      const img = avatar.querySelector('img');
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute('src', mockPhoto);

      // Steady ring and needs_you glyph are overlaid on photo
      expect(screen.getByTestId('mascot-ring')).toHaveAttribute('data-mode', 'steady');
      expect(screen.getByTestId('mascot-glyph')).toHaveAttribute('data-glyph-type', 'needs_you');
    });

    it('omits ring and glyph when photo avatar is idle', () => {
      render(<BotAvatar color={mockPhoto} name="Custom Agent" state="idle" />);
      expect(screen.queryByTestId('mascot-ring')).not.toBeInTheDocument();
      expect(screen.queryByTestId('mascot-glyph')).not.toBeInTheDocument();
    });
  });

  describe('prefers-reduced-motion handling', () => {
    it('sets data-reduced-motion="true" when prefers-reduced-motion matches', () => {
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('prefers-reduced-motion: reduce'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      render(<BotAvatar name="Maya" state="working" />);
      const avatar = screen.getByRole('img');
      expect(avatar).toHaveAttribute('data-reduced-motion', 'true');
      // State is still legible via aria-label, glyph and ring
      expect(avatar).toHaveAttribute('aria-label', 'Maya — working');
      expect(screen.getByTestId('mascot-ring')).toBeInTheDocument();
      expect(screen.getByTestId('mascot-glyph')).toBeInTheDocument();
    });
  });
});
