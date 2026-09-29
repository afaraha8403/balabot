import {useEffect, useRef, useState} from 'react';
import {isShippedBot, type Bot} from './api';
import type {BotSection} from './sections';

export type ContextMenuPosition = { x: number; y: number };

export type ChatMenuTarget = Pick<Bot, 'id' | 'name'> & {
  pinned?: boolean;
  unread?: boolean;
  sectionId?: string | null;
  color?: string;
  title?: string;
};

export function BotContextMenu({
  bot,
  position,
  sections = [],
  onClose,
  onTogglePinned,
  onMoveToSection,
  onCreateSection,
  onRenameSection,
  onToggleUnread,
  onEdit,
  onDuplicate,
  onClear,
  onArchive,
  onDelete,
}: {
  bot: ChatMenuTarget;
  position: ContextMenuPosition;
  sections?: BotSection[];
  onClose: () => void;
  onTogglePinned?: () => void;
  onMoveToSection?: (sectionId: string | null) => void;
  onCreateSection?: () => void;
  onRenameSection?: (sectionId: string) => void;
  onToggleUnread?: () => void;
  onEdit?: () => void;
  onDuplicate?: () => void;
  onClear?: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [showMoveSubmenu, setShowMoveSubmenu] = useState(false);
  const shipped = isShippedBot(bot);

  // Position calculation with window boundary clamping
  const [adjustedPos, setAdjustedPos] = useState<ContextMenuPosition>(position);

  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let x = position.x;
    let y = position.y;

    if (x + rect.width > vw - 12) {
      x = Math.max(12, vw - rect.width - 12);
    }
    if (y + rect.height > vh - 12) {
      y = Math.max(12, vh - rect.height - 12);
    }

    setAdjustedPos({ x, y });
  }, [position]);

  // Click outside and escape key handling
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="polaris-context-menu"
      data-testid="bot-context-menu"
      style={{
        left: adjustedPos.x,
        top: adjustedPos.y,
      }}
      role="menu"
      aria-label={`Actions for ${bot.name}`}
    >
      {/* Pin / Unpin */}
      {onTogglePinned ? (
        <button
          type="button"
          className="polaris-menu-item"
          role="menuitem"
          onClick={() => {
            onTogglePinned();
            onClose();
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="17" x2="12" y2="22" />
            <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.89A2 2 0 0 1 15 10.77V6h1a1 1 0 0 0 0-2H8a1 1 0 0 0 0 2h1v4.77a2 2 0 0 1-1.11 1.79l-1.78.89A2 2 0 0 0 5 15.24Z" />
          </svg>
          <span>{bot.pinned ? 'Unpin' : 'Pin'}</span>
        </button>
      ) : null}

      {/* Move to section */}
      {onMoveToSection ? (
        <div style={{position: 'relative'}}>
          <button
            type="button"
            className="polaris-menu-item"
            role="menuitem"
            style={{justifyContent: 'space-between'}}
            onClick={() => setShowMoveSubmenu(prev => !prev)}
          >
            <span style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
              </svg>
              Move to
            </span>
            <span style={{fontSize: '11px', opacity: 0.6}}>{showMoveSubmenu ? '▲' : '▶'}</span>
          </button>
          {showMoveSubmenu ? (
            <div
              style={{
                marginLeft: '12px',
                paddingLeft: '6px',
                borderLeft: '2px solid var(--border)',
                marginTop: '2px',
                marginBottom: '4px',
              }}
            >
              {sections.map(sec => (
                <button
                  key={sec.id}
                  type="button"
                  className="polaris-menu-item"
                  style={{fontSize: '12.5px', padding: '4px 8px'}}
                  onClick={() => {
                    onMoveToSection(sec.id);
                    onClose();
                  }}
                >
                  <span style={{flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                    {sec.name}
                  </span>
                  {bot.sectionId === sec.id ? (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : null}
                </button>
              ))}
              <button
                type="button"
                className="polaris-menu-item"
                style={{fontSize: '12.5px', padding: '4px 8px'}}
                onClick={() => {
                  onMoveToSection(null);
                  onClose();
                }}
              >
                <span style={{flex: 1}}>Unassigned</span>
                {bot.sectionId === null || !bot.sectionId ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : null}
              </button>
              <div className="polaris-menu-separator" />
              {onCreateSection ? (
                <button
                  type="button"
                  className="polaris-menu-item"
                  style={{fontSize: '12.5px', padding: '4px 8px'}}
                  onClick={() => {
                    onCreateSection();
                    onClose();
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  <span>New section</span>
                </button>
              ) : null}
              {bot.sectionId && onRenameSection ? (
                <button
                  type="button"
                  className="polaris-menu-item"
                  style={{fontSize: '12.5px', padding: '4px 8px'}}
                  onClick={() => {
                    onRenameSection(bot.sectionId!);
                    onClose();
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                  </svg>
                  <span>Rename section</span>
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Mark as Read / Unread */}
      {onToggleUnread ? (
        <button
          type="button"
          className="polaris-menu-item"
          role="menuitem"
          onClick={() => {
            onToggleUnread();
            onClose();
          }}
        >
          {bot.unread ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
              <circle cx="18" cy="8" r="3" fill="currentColor" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
          )}
          <span>{bot.unread ? 'Mark as Read' : 'Mark as Unread'}</span>
        </button>
      ) : null}

      <div className="polaris-menu-separator" />

      {/* Edit Profile — Shipped bots excluded! */}
      {!shipped && onEdit ? (
        <button
          type="button"
          className="polaris-menu-item"
          role="menuitem"
          onClick={() => {
            onEdit();
            onClose();
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          </svg>
          <span>Edit Profile</span>
        </button>
      ) : null}

      {/* Duplicate */}
      {onDuplicate ? (
        <button
          type="button"
          className="polaris-menu-item"
          role="menuitem"
          onClick={() => {
            onDuplicate();
            onClose();
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
          </svg>
          <span>Duplicate</span>
        </button>
      ) : null}

      <div className="polaris-menu-separator" />

      {/* Clear conversation */}
      {onClear ? (
        <button
          type="button"
          className="polaris-menu-item"
          role="menuitem"
          onClick={() => {
            onClear();
            onClose();
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
            <path d="M22 21H7" />
            <path d="m5 11 9 9" />
          </svg>
          <span>Clear conversation</span>
        </button>
      ) : null}

      {/* Archive */}
      {onArchive ? (
        <button
          type="button"
          className="polaris-menu-item"
          role="menuitem"
          onClick={() => {
            onArchive();
            onClose();
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect width="20" height="5" x="2" y="3" rx="1" />
            <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
            <path d="M10 12h4" />
          </svg>
          <span>Archive</span>
        </button>
      ) : null}

      {/* Delete — Shipped bots excluded! */}
      {!shipped && onDelete ? (
        <button
          type="button"
          className="polaris-menu-item"
          data-variant="destructive"
          role="menuitem"
          onClick={() => {
            onDelete();
            onClose();
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18" />
            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
          </svg>
          <span>Delete</span>
        </button>
      ) : null}
    </div>
  );
}
