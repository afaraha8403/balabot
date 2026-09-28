import type {ReactNode} from 'react';

type Props = {
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
export function MessageHoverMetadata({side, pinned = false, children}: Props) {
  return (
    <div
      data-testid="message-hover-rail"
      data-side={side}
      data-pinned={pinned ? 'true' : 'false'}
      className="message-hover-rail"
    >
      {children}
    </div>
  );
}
