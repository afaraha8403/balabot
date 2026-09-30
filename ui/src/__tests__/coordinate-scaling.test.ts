import { describe, it, expect } from 'vitest';
import {
  mapTeachPointer,
  teachCaptureKey,
  computerInputForDomKey,
} from '../coordinate-scaling';

describe('coordinate-scaling', () => {
  describe('mapTeachPointer aspect ratio scaling and letterboxing', () => {
    it('maps coordinates accurately on 16:9 screen in matching container', () => {
      const rect = { left: 100, top: 50, width: 960, height: 540 };
      const screen = { width: 1920, height: 1080 };

      // Top-left corner
      expect(mapTeachPointer(100, 50, rect, screen)).toEqual({ x: 0, y: 0 });

      // Center
      expect(mapTeachPointer(100 + 480, 50 + 270, rect, screen)).toEqual({ x: 960, y: 540 });

      // Arbitrary point: quarter way across
      expect(mapTeachPointer(100 + 240, 50 + 135, rect, screen)).toEqual({ x: 480, y: 270 });

      // Bottom-right corner (clamped to max source pixels: width - 1, height - 1)
      expect(mapTeachPointer(100 + 960, 50 + 540, rect, screen)).toEqual({ x: 1919, y: 1079 });
    });

    it('accounts for top and bottom letterboxing on 16:9 screen in taller container', () => {
      // 960x800 container for 1920x1080 screen -> scale = 0.5, offsetY = 130px, offsetX = 0px
      const rect = { left: 0, top: 0, width: 960, height: 800 };
      const screen = { width: 1920, height: 1080 };

      // Active display area starts at y = 130 and ends at y = 670 (height 540)
      expect(mapTeachPointer(0, 130, rect, screen)).toEqual({ x: 0, y: 0 });
      expect(mapTeachPointer(480, 130 + 270, rect, screen)).toEqual({ x: 960, y: 540 });
      expect(mapTeachPointer(960, 130 + 540, rect, screen)).toEqual({ x: 1919, y: 1079 });

      // Clicking in the top letterbox zone clamps to y = 0
      expect(mapTeachPointer(480, 40, rect, screen)).toEqual({ x: 960, y: 0 });

      // Clicking in the bottom letterbox zone clamps to y = 1079
      expect(mapTeachPointer(480, 750, rect, screen)).toEqual({ x: 960, y: 1079 });
    });

    it('accounts for pillarbox side offsets on 4:3 screen in wider container', () => {
      // 1600x768 container for 1024x768 screen -> scale = 1.0, offsetX = (1600 - 1024)/2 = 288px, offsetY = 0px
      const rect = { left: 50, top: 50, width: 1600, height: 768 };
      const screen = { width: 1024, height: 768 };

      // Active display area begins at x = 50 + 288 = 338
      expect(mapTeachPointer(338, 50, rect, screen)).toEqual({ x: 0, y: 0 });
      expect(mapTeachPointer(338 + 512, 50 + 384, rect, screen)).toEqual({ x: 512, y: 384 });
      expect(mapTeachPointer(338 + 1024, 50 + 768, rect, screen)).toEqual({ x: 1023, y: 767 });

      // Clicking in the left pillarbox zone clamps to x = 0
      expect(mapTeachPointer(100, 50 + 384, rect, screen)).toEqual({ x: 0, y: 384 });

      // Clicking in the right pillarbox zone clamps to x = 1023
      expect(mapTeachPointer(1500, 50 + 384, rect, screen)).toEqual({ x: 1023, y: 384 });
    });

    it('maps 21:9 ultrawide screen in standard 16:9 container', () => {
      // 1920x1080 container for 2560x1080 screen -> scale = 1920 / 2560 = 0.75, offsetY = (1080 - 810)/2 = 135px
      const rect = { left: 0, top: 0, width: 1920, height: 1080 };
      const screen = { width: 2560, height: 1080 };

      // Active area center (960, 540)
      expect(mapTeachPointer(960, 540, rect, screen)).toEqual({ x: 1280, y: 540 });

      // Active top-left (0, 135)
      expect(mapTeachPointer(0, 135, rect, screen)).toEqual({ x: 0, y: 0 });

      // Outside top letterbox
      expect(mapTeachPointer(960, 50, rect, screen)).toEqual({ x: 1280, y: 0 });

      // Outside bottom letterbox
      expect(mapTeachPointer(960, 1020, rect, screen)).toEqual({ x: 1280, y: 1079 });
    });

    it('maps 1:1 square screen with pillarbox offsets', () => {
      // 800x400 container for 1000x1000 screen -> scale = 400 / 1000 = 0.4, offsetX = (800 - 400)/2 = 200px
      const rect = { left: 0, top: 0, width: 800, height: 400 };
      const screen = { width: 1000, height: 1000 };

      // Center
      expect(mapTeachPointer(400, 200, rect, screen)).toEqual({ x: 500, y: 500 });

      // Left pillarbox clamp
      expect(mapTeachPointer(50, 200, rect, screen)).toEqual({ x: 0, y: 500 });

      // Right pillarbox clamp
      expect(mapTeachPointer(750, 200, rect, screen)).toEqual({ x: 999, y: 500 });
    });

    it('clamps negative and out-of-bounds pointer coordinates safely', () => {
      const rect = { left: 100, top: 100, width: 500, height: 500 };
      const screen = { width: 1000, height: 1000 };

      expect(mapTeachPointer(-1000, -1000, rect, screen)).toEqual({ x: 0, y: 0 });
      expect(mapTeachPointer(5000, 5000, rect, screen)).toEqual({ x: 999, y: 999 });
    });
  });

  describe('teachCaptureKey', () => {
    it('returns null when modifier keys (meta, ctrl, alt) are held', () => {
      expect(teachCaptureKey('a', { metaKey: true })).toBeNull();
      expect(teachCaptureKey('Enter', { ctrlKey: true })).toBeNull();
      expect(teachCaptureKey('Tab', { altKey: true })).toBeNull();
    });

    it('captures printable single characters', () => {
      expect(teachCaptureKey('a')).toBe('a');
      expect(teachCaptureKey('Z')).toBe('Z');
      expect(teachCaptureKey(' ')).toBe(' ');
      expect(teachCaptureKey('1')).toBe('1');
      expect(teachCaptureKey('$')).toBe('$');
    });

    it('captures recognized special keys', () => {
      expect(teachCaptureKey('Enter')).toBe('Enter');
      expect(teachCaptureKey('Tab')).toBe('Tab');
      expect(teachCaptureKey('Backspace')).toBe('Backspace');
      expect(teachCaptureKey('Escape')).toBe('Escape');
      expect(teachCaptureKey('ArrowLeft')).toBe('ArrowLeft');
      expect(teachCaptureKey('ArrowDown')).toBe('ArrowDown');
    });

    it('ignores unsupported special keys', () => {
      expect(teachCaptureKey('CapsLock')).toBeNull();
      expect(teachCaptureKey('F1')).toBeNull();
      expect(teachCaptureKey('PageUp')).toBeNull();
    });
  });

  describe('computerInputForDomKey', () => {
    it('maps single characters to clipboard kind', () => {
      expect(computerInputForDomKey('a')).toEqual({ kind: 'clipboard', text: 'a' });
      expect(computerInputForDomKey('!')).toEqual({ kind: 'clipboard', text: '!' });
    });

    it('maps known special DOM keys to X11 keysyms', () => {
      expect(computerInputForDomKey('Enter')).toEqual({ kind: 'key', key: 'Return' });
      expect(computerInputForDomKey('Backspace')).toEqual({ kind: 'key', key: 'BackSpace' });
      expect(computerInputForDomKey('ArrowLeft')).toEqual({ kind: 'key', key: 'Left' });
      expect(computerInputForDomKey('ArrowRight')).toEqual({ kind: 'key', key: 'Right' });
      expect(computerInputForDomKey('ArrowUp')).toEqual({ kind: 'key', key: 'Up' });
      expect(computerInputForDomKey('ArrowDown')).toEqual({ kind: 'key', key: 'Down' });
    });

    it('passes unmapped special keys through as key name', () => {
      expect(computerInputForDomKey('F5')).toEqual({ kind: 'key', key: 'F5' });
    });
  });
});
