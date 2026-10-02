import {useMemo, useState} from 'react';
import {Avatar} from '@astryxdesign/core/Avatar';
import {Badge} from '@astryxdesign/core/Badge';
import {Collapsible} from '@astryxdesign/core/Collapsible';
import {Divider} from '@astryxdesign/core/Divider';
import {HStack} from '@astryxdesign/core/Stack';
import {List} from '@astryxdesign/core/List';
import {ListItem} from '@astryxdesign/core/List';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';
import {ThinkingOrb} from 'thinking-orbs';
import {BotRowMenu} from '../BotRowMenu';
import {BotContextMenu, type ContextMenuPosition} from '../BotContextMenu';
import {BotAvatar} from '../BotAvatar';
import {GroupAvatar} from '../GroupAvatar';
import {IconConceal, IconGroupChat, IconPin} from '../icons';
import type {Bot, Group, Session, SubAgent} from '../api';
import {isShippedBot} from '../api';
import {type BotSection, DEFAULT_BOT_SECTIONS} from '../sections';

export type RosterEntry = {
  bot: Bot;
  preview: string;
  when: string;
  isTyping: boolean;
  hasMessages: boolean;
  isPinned: boolean;
  isHidden: boolean;
  isUnread: boolean;
};

/** Compact recency label: time today, "Yesterday", weekday this week, else a date. */
function formatWhen(at: number): string {
  const d = new Date(at);
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(d, now)) {
    return d.toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'});
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return 'Yesterday';

  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days < 7) return d.toLocaleDateString(undefined, {weekday: 'short'});
  return d.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}

/** The bot's most recent real message across all of its sessions, if any. */
function lastMessageFor(sessions: Session[], botId: string) {
  let last: {content: string; at: number} | null = null;
  for (const s of sessions) {
    if (s.botId !== botId) continue;
    for (const m of s.messages) {
      if (m.role !== 'user' && m.role !== 'assistant') continue;
      if (m.content.trim() === '') continue;
      if (!last || m.at > last.at) last = {content: m.content, at: m.at};
    }
  }
  return last;
}

export function BotRoster({
  bots,
  activeBotId,
  sessions,
  isStreaming,
  subagents,
  pinnedBotIds = [],
  hiddenBotIds = [],
  unreadBotIds = [],
  groups = [],
  activeGroupId = null,
  sections = DEFAULT_BOT_SECTIONS,
  sectionAssignments = {},
  collapsedSections = [],
  onSelect,
  onSelectGroup,
  onTogglePin,
  onToggleHide,
  onToggleUnread,
  onMoveToSection,
  onCreateSection,
  onDuplicateBot,
  onEditBot,
  onClearConversation,
  onArchiveBot,
  onDeleteBot,
  onToggleSection,
  onRenameSection,
}: {
  bots: Bot[];
  activeBotId: string | null;
  sessions: Session[];
  isStreaming: boolean;
  subagents?: SubAgent[];
  pinnedBotIds?: string[];
  hiddenBotIds?: string[];
  unreadBotIds?: string[];
  groups?: Group[];
  activeGroupId?: string | null;
  sections?: BotSection[];
  sectionAssignments?: Record<string, string | null>;
  collapsedSections?: string[];
  onSelect: (id: string) => void;
  onSelectGroup?: (gid: string) => void;
  onTogglePin?: (bot: Bot) => void;
  onToggleHide?: (bot: Bot) => void;
  onToggleUnread?: (bot: Bot) => void;
  onMoveToSection?: (botId: string, sectionId: string | null) => void;
  onCreateSection?: (bot: Bot) => void;
  onDuplicateBot?: (bot: Bot) => void;
  onEditBot?: (bot: Bot) => void;
  onClearConversation?: (bot: Bot) => void;
  onArchiveBot?: (bot: Bot) => void;
  onDeleteBot?: (bot: Bot) => void;
  onToggleSection?: (sectionId: string) => void;
  onRenameSection?: (section: BotSection) => void;
}) {
  const pinnedSet = new Set(pinnedBotIds);
  const hiddenSet = new Set(hiddenBotIds);
  const unreadSet = new Set(unreadBotIds);
  const collapsedSet = useMemo(() => new Set(collapsedSections), [collapsedSections]);
  const [contextBot, setContextBot] = useState<{ bot: Bot; pos: ContextMenuPosition } | null>(null);

  const makeEntry = (bot: Bot): RosterEntry => {
    const last = lastMessageFor(sessions, bot.id);
    const isTyping = isStreaming && activeBotId === bot.id;
    return {
      bot,
      isTyping,
      hasMessages: last !== null,
      isPinned: pinnedSet.has(bot.id),
      isHidden: hiddenSet.has(bot.id),
      isUnread: unreadSet.has(bot.id),
      preview: isTyping
        ? 'Typing…'
        : last
          ? last.content.replace(/\s+/g, ' ').trim().slice(0, 90)
          : 'No messages yet',
      when: last ? formatWhen(last.at) : '',
    };
  };

  const pinnedEntries = bots.filter(b => pinnedSet.has(b.id) && !hiddenSet.has(b.id)).map(makeEntry);
  const mainEntries = bots.filter(b => !pinnedSet.has(b.id) && !hiddenSet.has(b.id)).map(makeEntry);
  const hiddenEntries = bots.filter(b => hiddenSet.has(b.id)).map(makeEntry);

  const getBotSectionId = (b: Bot): string => {
    if (sectionAssignments[b.id]) return sectionAssignments[b.id]!;
    if (b.category && b.category.trim()) {
      const match = sections.find(s => s.name.toLowerCase() === b.category!.toLowerCase());
      if (match) return match.id;
    }
    const txt = `${b.name} ${b.title || ''} ${b.id}`.toLowerCase();
    if (txt.includes('cursor') || txt.includes('coder') || txt.includes('code') || txt.includes('dev')) {
      const dev = sections.find(s => s.name.toLowerCase() === 'dev' || s.name.toLowerCase() === 'cursor');
      if (dev) return dev.id;
    }
    if (txt.includes('governor') || txt.includes('policy') || txt.includes('safety') || txt.includes('audit')) {
      const gov = sections.find(s => s.name.toLowerCase() === 'governance');
      if (gov) return gov.id;
    }
    const ops = sections.find(s => s.name.toLowerCase() === 'ops');
    if (ops) return ops.id;
    return sections[0]?.id || 'sec-ops';
  };

  const sectionGroups = useMemo(() => {
    const map = new Map<string, { section: BotSection; entries: RosterEntry[] }>();
    for (const sec of sections) {
      map.set(sec.id, { section: sec, entries: [] });
    }
    const unassigned: RosterEntry[] = [];
    for (const e of mainEntries) {
      const secId = getBotSectionId(e.bot);
      if (map.has(secId)) {
        map.get(secId)!.entries.push(e);
      } else {
        unassigned.push(e);
      }
    }
    const result = Array.from(map.values()).filter(g => g.entries.length > 0);
    if (unassigned.length > 0) {
      result.push({
        section: { id: 'unassigned', name: 'Unassigned' },
        entries: unassigned,
      });
    }
    return result;
  }, [sections, mainEntries, sectionAssignments]);

  const renderBotItem = (e: RosterEntry) => (
    <div
      key={e.bot.id}
      onContextMenu={event => {
        event.preventDefault();
        setContextBot({
          bot: e.bot,
          pos: { x: event.clientX, y: event.clientY },
        });
      }}
      style={{ width: '100%' }}
    >
      <ListItem
        label={e.bot.name}
        isSelected={e.bot.id === activeBotId && !activeGroupId}
        onClick={() => onSelect(e.bot.id)}
        description={
          <VStack gap={1} align="start">
            <Text
              type="supporting"
              maxLines={1}
              color={e.isTyping ? 'accent' : e.isUnread ? 'primary' : 'secondary'}
              weight={e.isUnread ? 'semibold' : undefined}
            >
              {e.preview}
            </Text>
            {isShippedBot(e.bot) ? (
              <Text
                type="supporting"
                size="xsm"
                color="secondary"
                aria-label="Shipped · locked"
                role="status"
              >
                Shipped · locked
              </Text>
            ) : null}
            {(subagents ?? [])
              .filter(s => s.parent === e.bot.id)
              .map(s => (
                <HStack key={s.id} gap={2} vAlign="center">
                  <ThinkingOrb
                    state="working"
                    size={20}
                    theme="dark"
                    aria-label={`${s.title} is working`}
                  />
                  <Text type="supporting" size="xsm" color="accent">
                    sub-agent · {s.title}
                    {s.age ? ` · up ${s.age}` : ''}
                  </Text>
                </HStack>
              ))}
          </VStack>
        }
        startContent={
          <BotAvatar
            identity={e.bot.id}
            color={e.bot.color}
            size={38}
            status={e.isTyping ? 'working' : undefined}
          />
        }
        endContent={
          <VStack gap={1} align="end">
            <HStack gap={1} vAlign="center">
              {e.isUnread ? (
                <span
                  aria-hidden="true"
                  className="polaris-unread-dot"
                  title="Unread"
                  style={{
                    display: 'inline-block',
                    width: '8px',
                    height: '8px',
                    borderRadius: '9999px',
                    backgroundColor: 'var(--foreground)',
                    marginRight: '2px',
                  }}
                />
              ) : null}
              {e.isPinned ? <IconPin size="sm" color="secondary" /> : null}
              <Text type="supporting" size="xsm">
                {e.when}
              </Text>
              <BotRowMenu
                bot={e.bot}
                isPinned={e.isPinned}
                isHidden={e.isHidden}
                isUnread={e.isUnread}
                sections={sections}
                onTogglePin={onTogglePin}
                onToggleHide={onToggleHide}
                onToggleUnread={onToggleUnread}
                onMoveToSection={secId => onMoveToSection?.(e.bot.id, secId)}
                onCreateSection={() => onCreateSection?.(e.bot)}
                onRenameSection={
                  onRenameSection
                    ? secId => {
                        const sec = sections.find(s => s.id === secId);
                        if (sec) onRenameSection(sec);
                      }
                    : undefined
                }
                onDuplicate={onDuplicateBot}
                onEdit={onEditBot}
                onClear={onClearConversation}
                onArchive={onArchiveBot}
                onDelete={onDeleteBot}
              />
            </HStack>
            {e.isTyping ? (
              <ThinkingOrb
                state="working"
                size={20}
                theme="dark"
                aria-label={`${e.bot.name} is working`}
              />
            ) : null}
          </VStack>
        }
      />
    </div>
  );

  return (
    <VStack gap={3} height="100%" justify="between">
      <VStack className="rk-scroll" gap={2} style={{flex: 1, minHeight: 0, overflowY: 'auto'}}>
        {/* Pinned Bots */}
        {pinnedEntries.length > 0 ? (
          <VStack gap={1}>
            <HStack paddingInline={2} paddingBlock={1}>
              <Text type="supporting" size="xsm" weight="semibold" color="secondary">
                PINNED
              </Text>
            </HStack>
            <List density="compact">
              {pinnedEntries.map(renderBotItem)}
            </List>
            <Divider />
          </VStack>
        ) : null}

        {/* Collapsible Section Headings */}
        {sectionGroups.length > 0 ? (
          sectionGroups.map(group => {
            const isCollapsed = collapsedSet.has(group.section.id);
            return (
              <VStack key={group.section.id} gap={1} data-sidebar-group={group.section.id}>
                <Collapsible
                  defaultIsOpen={!isCollapsed}
                  onOpenChange={() => onToggleSection?.(group.section.id)}
                  trigger={
                    <HStack
                      gap={2}
                      vAlign="center"
                      justify="between"
                      width="100%"
                      paddingInline={2}
                      paddingBlock={1}
                      style={{cursor: 'pointer'}}
                      onContextMenu={e => {
                        if (group.section.id !== 'unassigned') {
                          e.preventDefault();
                          onRenameSection?.(group.section);
                        }
                      }}
                    >
                      <Text type="supporting" size="xsm" weight="semibold" color="secondary">
                        {group.section.name.toUpperCase()}
                      </Text>
                      <Badge label={`${group.entries.length}`} variant="neutral" />
                    </HStack>
                  }
                >
                  <List density="compact">
                    {group.entries.map(renderBotItem)}
                  </List>
                </Collapsible>
              </VStack>
            );
          })
        ) : pinnedEntries.length === 0 ? (
          <HStack gap={2} padding={2}>
            <Text type="supporting">
              {hiddenEntries.length > 0
                ? 'All bots are currently hidden.'
                : 'No bots in the roster yet.'}
            </Text>
          </HStack>
        ) : null}

        {/* Group Chats */}
        {groups.length > 0 ? (
          <VStack gap={1}>
            <Divider />
            <HStack paddingInline={2} paddingBlock={1}>
              <Text type="supporting" size="xsm" weight="semibold" color="secondary">
                GROUP CHATS
              </Text>
            </HStack>
            <List density="compact">
              {groups.map(g => {
                const last = g.transcript?.[g.transcript.length - 1];
                const preview = last ? `${last.from}: ${last.text}` : 'Group created';
                const when = last?.at ? formatWhen(new Date(last.at).getTime()) : '';
                return (
                  <ListItem
                    key={g.id}
                    label={g.name}
                    isSelected={activeGroupId === g.id}
                    onClick={() => onSelectGroup?.(g.id)}
                    description={
                      <Text type="supporting" maxLines={1} color="secondary">
                        {preview}
                      </Text>
                    }
                    startContent={
                      <GroupAvatar
                        members={g.members.map(m => {
                          const b = bots.find(bot => bot.id === m || bot.name === m);
                          return {
                            botId: b?.id ?? m,
                            name: b?.name ?? m,
                            color: b?.color ?? '#3B82F6',
                          };
                        })}
                        size={38}
                      />
                    }
                    endContent={
                      <VStack gap={1} align="end">
                        <Text type="supporting" size="xsm">
                          {when}
                        </Text>
                        <Badge label={`${g.members.length} bots`} variant="neutral" />
                      </VStack>
                    }
                  />
                );
              })}
            </List>
          </VStack>
        ) : null}
      </VStack>

      {/* Hidden Bots Drawer */}
      <VStack gap={1} paddingBlock={2}>
        <Divider />
        <Collapsible
          defaultIsOpen={false}
          trigger={
            <HStack
              gap={2}
              vAlign="center"
              justify="between"
              width="100%"
              paddingBlock={1}
              paddingInline={2}
              style={{cursor: 'pointer'}}
            >
              <HStack gap={1} vAlign="center">
                <IconConceal size="sm" color="secondary" />
                <Text type="supporting" size="sm" weight="medium">
                  Hidden Bots
                </Text>
              </HStack>
              <Badge label={`${hiddenEntries.length}`} variant="neutral" />
            </HStack>
          }
        >
          <List density="compact">
            {hiddenEntries.length > 0 ? (
              hiddenEntries.map(renderBotItem)
            ) : (
              <HStack padding={2}>
                <Text type="supporting" size="xsm" color="secondary">
                  No hidden bots. Use &quot;Manage &lt;Bot&gt;&quot; &rarr; &quot;Hide from sidebar&quot; to hide a bot.
                </Text>
              </HStack>
            )}
          </List>
        </Collapsible>
      </VStack>

      {contextBot ? (
        <BotContextMenu
          bot={{
            ...contextBot.bot,
            pinned: pinnedSet.has(contextBot.bot.id),
            unread: unreadSet.has(contextBot.bot.id),
          }}
          position={contextBot.pos}
          sections={sections}
          onClose={() => setContextBot(null)}
          onTogglePinned={onTogglePin ? () => onTogglePin(contextBot.bot) : undefined}
          onMoveToSection={secId => onMoveToSection?.(contextBot.bot.id, secId)}
          onCreateSection={() => onCreateSection?.(contextBot.bot)}
          onRenameSection={
            onRenameSection
              ? secId => {
                  const sec = sections.find(s => s.id === secId);
                  if (sec) onRenameSection(sec);
                }
              : undefined
          }
          onToggleUnread={onToggleUnread ? () => onToggleUnread(contextBot.bot) : undefined}
          onEdit={onEditBot ? () => onEditBot(contextBot.bot) : undefined}
          onDuplicate={onDuplicateBot ? () => onDuplicateBot(contextBot.bot) : undefined}
          onClear={onClearConversation ? () => onClearConversation(contextBot.bot) : undefined}
          onArchive={onArchiveBot ? () => onArchiveBot(contextBot.bot) : undefined}
          onDelete={onDeleteBot ? () => onDeleteBot(contextBot.bot) : undefined}
        />
      ) : null}
    </VStack>
  );
}

