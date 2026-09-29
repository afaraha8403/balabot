import { useEffect, useRef, useState, useMemo } from 'react';
import { Check, MessageSquare, Plus, Trash2 } from 'lucide-react';
import type { Session } from './api';
import { topicSpanLabel } from './sessions';

export { topicSpanLabel };

type Space = {
  id: string;
  name: string;
  description?: string;
};

const DEFAULT_SPACES: Space[] = [
  { id: 'default', name: 'Personal Space', description: 'Your private workspace and bots' },
  { id: 'team', name: 'Team Fleet', description: 'Shared fleet and operations' },
];

export type SpaceSwitcherProps = {
  activeSpaceId?: string;
  onSelectSpace?: (spaceId: string) => void;
  activeBotId?: string;
  activeBotName?: string;
  sessions?: Session[];
  activeSessionId?: string | null;
  onSelectSession?: (sessionId: string) => void;
  onNewSession?: () => void;
  onDeleteSession?: (sessionId: string) => void;
};

/**
 * Polaris SpaceSwitcher component at the top of the sidebar.
 * Integrates workspace switching and per-bot conversation management
 * (conversation history, topic spans, purpose records, and creation/deletion).
 */
export function SpaceSwitcher({
  activeSpaceId = 'default',
  onSelectSpace,
  activeBotId,
  activeBotName,
  sessions = [],
  activeSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
}: SpaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(activeSpaceId);
  const [pendingDeleteSession, setPendingDeleteSession] = useState<Session | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeSpace = DEFAULT_SPACES.find(s => s.id === selectedId) ?? DEFAULT_SPACES[0];

  const botSessions = useMemo(() => {
    if (!activeBotId) return [];
    return sessions.filter(s => s.botId === activeBotId);
  }, [sessions, activeBotId]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pendingDeleteSession) {
          setPendingDeleteSession(null);
        } else {
          setOpen(false);
        }
      }
    };

    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, pendingDeleteSession]);

  return (
    <div ref={containerRef} className="relative w-full select-none">
      <button
        type="button"
        data-testid="space-switcher-trigger"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen(prev => !prev)}
        className="flex w-full items-center justify-between rounded-lg border border-transparent px-2.5 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted/80"
        style={{
          backgroundColor: open ? 'var(--accent)' : 'transparent',
        }}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary text-[11px] font-bold text-primary-foreground shadow-sm">
            {activeSpace.name[0]}
          </span>
          <span className="truncate">{activeSpace.name}</span>
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`shrink-0 text-muted-foreground transition-transform duration-150 ${
            open ? 'rotate-180' : ''
          }`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          data-testid="space-switcher-popover"
          className="absolute left-0 top-[calc(100%+4px)] z-50 w-72 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl animate-in fade-in zoom-in-95 duration-100 max-h-[460px] overflow-y-auto"
        >
          {/* Workspace Spaces Section */}
          <div className="px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            Spaces
          </div>
          {DEFAULT_SPACES.map(space => {
            const isSelected = space.id === selectedId;
            return (
              <button
                key={space.id}
                type="button"
                onClick={() => {
                  setSelectedId(space.id);
                  onSelectSpace?.(space.id);
                }}
                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                  isSelected
                    ? 'bg-accent font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'
                }`}
              >
                <div>
                  <div className="text-foreground">{space.name}</div>
                  {space.description && (
                    <div className="text-[10.5px] text-muted-foreground">{space.description}</div>
                  )}
                </div>
                {isSelected && <Check size={14} className="text-primary shrink-0 ms-2" />}
              </button>
            );
          })}

          {/* Bot Conversations Section */}
          {activeBotId && (
            <div className="mt-2 pt-2 border-t border-border/60">
              <div className="flex items-center justify-between px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                <span className="truncate">Chats · {activeBotName || 'Bot'}</span>
                {onNewSession && (
                  <button
                    type="button"
                    title="New conversation"
                    onClick={() => {
                      onNewSession();
                      setOpen(false);
                    }}
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/10 transition-colors"
                  >
                    <Plus size={11} strokeWidth={2.5} />
                    <span>New</span>
                  </button>
                )}
              </div>

              {botSessions.length === 0 ? (
                <div className="px-2.5 py-2 text-[11.5px] text-muted-foreground italic">
                  No previous conversations for this bot.
                </div>
              ) : (
                <div className="space-y-0.5 mt-0.5">
                  {botSessions.map(session => {
                    const isCurrent = session.id === activeSessionId;
                    const spans = topicSpanLabel(session.topicSpans);
                    return (
                      <div
                        key={session.id}
                        className={`group relative flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer ${
                          isCurrent
                            ? 'bg-accent/80 text-foreground font-medium'
                            : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'
                        }`}
                        onClick={() => {
                          onSelectSession?.(session.id);
                          setOpen(false);
                        }}
                      >
                        <div className="min-w-0 flex-1 pe-2">
                          <div className="flex items-center gap-1.5">
                            <MessageSquare size={12} className="shrink-0 text-muted-foreground" />
                            <span className="truncate">{session.title}</span>
                          </div>
                          <div className="text-[10px] text-muted-foreground truncate ps-4">
                            {session.messages.length} msgs
                            {spans ? ` · ${spans}` : ''}
                          </div>
                        </div>

                        {onDeleteSession && (
                          <button
                            type="button"
                            title="Delete conversation"
                            onClick={e => {
                              e.stopPropagation();
                              setPendingDeleteSession(session);
                            }}
                            className="opacity-0 group-hover:opacity-100 hover:text-destructive p-1 rounded transition-opacity"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Purpose Records Section */}
              {botSessions.some(s => s.purpose) && (
                <div className="mt-2 pt-2 border-t border-border/50 px-2 pb-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    Purpose records
                  </div>
                  {botSessions
                    .filter(s => s.purpose)
                    .map(s => (
                      <div key={s.id} className="text-[10.5px] text-muted-foreground truncate py-0.5">
                        <span className="font-medium text-foreground/80">{s.title}:</span>{' '}
                        {s.purpose}
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Delete Conversation Confirmation Modal */}
      {pendingDeleteSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-2xl space-y-3">
            <h3 className="text-base font-semibold text-foreground">
              Delete "{pendingDeleteSession.title}"?
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {pendingDeleteSession.purpose
                ? `“${pendingDeleteSession.purpose}” and its topic record will be removed from the server.`
                : 'This conversation and its message records will be permanently removed.'}
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPendingDeleteSession(null)}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteSession?.(pendingDeleteSession.id);
                  setPendingDeleteSession(null);
                }}
                className="rounded-lg bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors shadow-sm"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
