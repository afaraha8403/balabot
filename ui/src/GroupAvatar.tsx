import {memo, type CSSProperties} from 'react';
import {BotAvatar} from './BotAvatar';

export interface GroupAvatarMember {
  botId?: string;
  name?: string;
  color?: string;
  status?: string;
}

export interface GroupAvatarProps {
  members: GroupAvatarMember[];
  size?: number;
  className?: string;
}

export const GroupAvatar = memo(function GroupAvatar({
  members = [],
  size = 38,
  className = '',
}: GroupAvatarProps) {
  const firstMember = members[0];
  if (!firstMember) {
    return (
      <div
        className={`rakazo-group-avatar ${className}`}
        style={{
          width: size,
          height: size,
          borderRadius: '9999px',
          border: '1px solid var(--border)',
          backgroundColor: 'var(--muted)',
          color: 'var(--muted-foreground)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 'none',
        }}
      >
        <svg
          aria-hidden="true"
          width={Math.round(size * 0.48)}
          height={Math.round(size * 0.48)}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      </div>
    );
  }

  if (members.length === 1) {
    return (
      <BotAvatar
        color={firstMember.color}
        identity={firstMember.botId ?? firstMember.name}
        size={size}
        status={firstMember.status}
        className={`rakazo-group-avatar ${className}`}
      />
    );
  }

  const pair = members.length === 2;
  const miniSize = Math.round(size * (pair ? 0.65 : 0.54));
  const positions: CSSProperties[] = pair
    ? [
        { top: 0, left: 0 },
        { right: 0, bottom: 0 },
      ]
    : [
        { top: 0, left: (size - miniSize) / 2 },
        { bottom: 0, left: 0 },
        { right: 0, bottom: 0 },
      ];
  const visibleMembers = members.slice(0, pair || members.length === 3 ? members.length : 3);

  return (
    <div
      className={`rakazo-group-avatar ${className}`}
      style={{
        position: 'relative',
        width: size,
        height: size,
        borderRadius: '9999px',
        userSelect: 'none',
        flex: 'none',
      }}
    >
      {visibleMembers.map((member, index) => (
        <div
          key={member.botId ?? member.name ?? index}
          style={{
            position: 'absolute',
            ...positions[index],
            zIndex: index + 1,
            filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))',
          }}
        >
          <BotAvatar
            color={member.color}
            identity={member.botId ?? member.name}
            size={miniSize}
            status={member.status}
          />
        </div>
      ))}
    </div>
  );
});
