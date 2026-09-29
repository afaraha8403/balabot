import {useEffect, useRef} from 'react';
import {mapTeachPointer, teachCaptureKey, computerInputForDomKey} from './coordinate-scaling';
import {sendComputerAction} from './api';

const DEFAULT_SCREEN = {width: 1280, height: 800};

type Props = {
  botId: string;
  enabled: boolean;
  screenWidth?: number;
  screenHeight?: number;
  onActionCaptured?: (description: string) => void;
};

export function TeachCaptureOverlay({
  botId,
  enabled,
  screenWidth,
  screenHeight,
  onActionCaptured,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputChainRef = useRef(Promise.resolve());
  const width = screenWidth ?? DEFAULT_SCREEN.width;
  const height = screenHeight ?? DEFAULT_SCREEN.height;

  useEffect(() => {
    if (!enabled) return;
    const overlay = rootRef.current;
    if (!overlay) return;
    const target: HTMLDivElement = overlay;

    function enqueueInput(task: () => Promise<void>) {
      inputChainRef.current = inputChainRef.current.then(task).catch(() => undefined);
    }

    function pointerAt(event: PointerEvent) {
      return mapTeachPointer(event.clientX, event.clientY, target.getBoundingClientRect(), {
        width,
        height,
      });
    }

    async function sendPointer(
      type: 'move' | 'down' | 'up' | 'click',
      x: number,
      y: number,
      button: 'left' | 'right' = 'left',
    ) {
      try {
        await sendComputerAction(botId, {action: 'click', x, y});
      } catch {
        /* transient */
      }
    }

    async function sendKey(key: string) {
      const input = computerInputForDomKey(key);
      try {
        if (input.kind === 'clipboard') {
          await sendComputerAction(botId, {action: 'type', text: input.text});
        } else {
          await sendComputerAction(botId, {action: 'key', key: input.key});
        }
      } catch {
        /* transient */
      }
    }

    async function sendScroll(direction: 'up' | 'down', amount: number) {
      try {
        await sendComputerAction(botId, {action: 'scroll', amount: direction === 'down' ? amount : -amount});
      } catch {
        /* transient */
      }
    }

    function buttonFor(event: PointerEvent): 'left' | 'right' {
      return event.button === 2 ? 'right' : 'left';
    }

    function onPointerDown(event: PointerEvent) {
      event.preventDefault();
      target.setPointerCapture(event.pointerId);
      const {x, y} = pointerAt(event);
      enqueueInput(() => sendPointer('down', x, y, buttonFor(event)));
    }

    let pendingMove: {x: number; y: number; button: 'left' | 'right'} | null = null;
    let moveInFlight = false;

    function pumpMove() {
      if (moveInFlight || !pendingMove) return;
      const move = pendingMove;
      pendingMove = null;
      moveInFlight = true;
      enqueueInput(async () => {
        try {
          await sendPointer('move', move.x, move.y, move.button);
        } finally {
          moveInFlight = false;
          pumpMove();
        }
      });
    }

    function onPointerMove(event: PointerEvent) {
      if (!event.buttons) return;
      event.preventDefault();
      const {x, y} = pointerAt(event);
      pendingMove = {x, y, button: event.buttons === 2 ? 'right' : 'left'};
      pumpMove();
    }

    function onPointerUp(event: PointerEvent) {
      event.preventDefault();
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
      const {x, y} = pointerAt(event);
      const button = buttonFor(event);
      const dragged = pendingMove !== null;
      pendingMove = null;
      if (dragged) enqueueInput(() => sendPointer('move', x, y, button));
      enqueueInput(async () => {
        await sendPointer('up', x, y, button);
        onActionCaptured?.(`Click at (${x}, ${y})`);
      });
    }

    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const direction = event.deltaY < 0 ? 'up' : 'down';
      const amount = Math.min(20, Math.max(1, Math.round(Math.abs(event.deltaY) / 80) || 1));
      enqueueInput(async () => {
        await sendScroll(direction, amount);
        onActionCaptured?.(`Scroll ${direction}`);
      });
    }

    function onKeyDown(event: KeyboardEvent) {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('button, input, textarea, select, a, [contenteditable]')
      ) {
        return;
      }
      const key = teachCaptureKey(event.key, event);
      if (!key) return;
      event.preventDefault();
      enqueueInput(async () => {
        await sendKey(key);
        onActionCaptured?.(key.length === 1 ? `Type "${key}"` : `Press key "${key}"`);
      });
    }

    function onContextMenu(event: Event) {
      event.preventDefault();
    }

    target.addEventListener('pointerdown', onPointerDown);
    target.addEventListener('pointermove', onPointerMove);
    target.addEventListener('pointerup', onPointerUp);
    target.addEventListener('pointercancel', onPointerUp);
    target.addEventListener('wheel', onWheel, {passive: false});
    target.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      target.removeEventListener('pointerdown', onPointerDown);
      target.removeEventListener('pointermove', onPointerMove);
      target.removeEventListener('pointerup', onPointerUp);
      target.removeEventListener('pointercancel', onPointerUp);
      target.removeEventListener('wheel', onWheel);
      target.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [botId, enabled, height, onActionCaptured, width]);

  if (!enabled) return null;

  return (
    <div
      ref={rootRef}
      data-testid="teach-capture-overlay"
      role="presentation"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 20,
        cursor: 'crosshair',
        backgroundColor: 'transparent',
      }}
    />
  );
}
