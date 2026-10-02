import {useState} from 'react';
import type {Bot} from './api';
import type {BotSection} from './sections';
import {BotContextMenu, type ContextMenuPosition} from './BotContextMenu';

type Props = {
  bot: Bot;
  isPinned?: boolean;
  isHidden?: boolean;
  isUnread?: boolean;
  sections?: BotSection[];
  onTogglePin?: (bot: Bot) => void;
  onToggleHide?: (bot: Bot) => void;
  onMoveToSection?: (sectionId: string | null) => void;
  onCreateSection?: () => void;
  onRenameSection?: (sectionId: string) => void;
  onToggleUnread?: (bot: Bot) => void;
  onDuplicate?: (bot: Bot) => void;
  onEdit?: (bot: Bot) => void;
  onClear?: (bot: Bot) => void;
  onArchive?: (bot: Bot) => void;
  onDelete?: (bot: Bot) => void;
};

/**
 * Per-bot action trigger in the roster:
 * Opens the position-anchored Polaris BotContextMenu with Pin, Move to section,
 * Unread, Edit, Duplicate, Clear, Archive, and Delete.
 */
export function BotRowMenu({
  bot,
  isPinned,
  isUnread,
  sections = [],
  onTogglePin,
  onMoveToSection,
  onCreateSection,
  onRenameSection,
  onToggleUnread,
  onDuplicate,
  onEdit,
  onClear,
  onArchive,
  onDelete,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<ContextMenuPosition>({ x: 0, y: 0 });

  return (
    <>
      <button
        type="button"
        aria-label={`Actions for ${bot.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="bot-menu-trigger"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '24px',
          height: '24px',
          borderRadius: '6px',
          border: 'none',
          background: 'transparent',
          color: 'var(--muted-foreground)',
          cursor: 'pointer',
          padding: 0,
          transition: 'color 120ms ease, background-color 120ms ease',
        }}
        onClick={e => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          setPos({ x: rect.left - 180, y: rect.bottom + 4 });
          setOpen(true);
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="1.2" fill="currentColor" />
          <circle cx="19" cy="12" r="1.2" fill="currentColor" />
          <circle cx="5" cy="12" r="1.2" fill="currentColor" />
        </svg>
      </button>

      {open ? (
        <BotContextMenu
          bot={{
            ...bot,
            pinned: isPinned,
            unread: isUnread,
          }}
          position={pos}
          sections={sections}
          onClose={() => setOpen(false)}
          onTogglePinned={onTogglePin ? () => onTogglePin(bot) : undefined}
          onMoveToSection={onMoveToSection}
          onCreateSection={onCreateSection}
          onRenameSection={onRenameSection}
          onToggleUnread={onToggleUnread ? () => onToggleUnread(bot) : undefined}
          onEdit={onEdit ? () => onEdit(bot) : undefined}
          onDuplicate={onDuplicate ? () => onDuplicate(bot) : undefined}
          onClear={onClear ? () => onClear(bot) : undefined}
          onArchive={onArchive ? () => onArchive(bot) : undefined}
          onDelete={onDelete ? () => onDelete(bot) : undefined}
        />
      ) : null}
    </>
  );
}
