/**
 * Coordinate mapping and key capture helpers mirrored from Polaris.
 * Ensures clicks on letterboxed or scaled remote screens map exactly
 * to the source framebuffer coordinates.
 */

function clamp(value: number, max: number): number {
  return Math.min(Math.max(value, 0), max);
}

export function mapTeachPointer(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  screen: { width: number; height: number },
): { x: number; y: number } {
  const width = rect.width || 1;
  const height = rect.height || 1;
  const scale = Math.min(width / screen.width, height / screen.height) || 1;
  const offsetX = (width - screen.width * scale) / 2;
  const offsetY = (height - screen.height * scale) / 2;
  return {
    x: clamp(Math.round((clientX - rect.left - offsetX) / scale), screen.width - 1),
    y: clamp(Math.round((clientY - rect.top - offsetY) / scale), screen.height - 1),
  };
}

const SPECIAL_TEACH_KEYS = new Set([
  'Enter',
  'Tab',
  'Backspace',
  'Escape',
  'Delete',
  'Home',
  'End',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
]);

export function teachCaptureKey(
  key: string,
  modifiers?: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean },
): string | null {
  if (modifiers?.metaKey || modifiers?.ctrlKey || modifiers?.altKey) return null;
  if (key.length === 1) return key;
  return SPECIAL_TEACH_KEYS.has(key) ? key : null;
}

const X11_KEYSYM_BY_DOM_KEY: Record<string, string> = {
  Enter: 'Return',
  Backspace: 'BackSpace',
  Escape: 'Escape',
  Tab: 'Tab',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
};

export function computerInputForDomKey(
  key: string,
): { kind: 'clipboard'; text: string } | { kind: 'key'; key: string } {
  if (key.length === 1) return { kind: 'clipboard', text: key };
  return { kind: 'key', key: X11_KEYSYM_BY_DOM_KEY[key] ?? key };
}
