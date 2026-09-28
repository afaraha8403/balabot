import {useMemo} from 'react';
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
import {IconConceal, IconGroupChat, IconPin} from '../icons';
import type {Bot, Group, Session, SubAgent} from '../api';

export type RosterEntry = {
  bot: Bot;
  preview: string;
  when: string;
  isTyping: boolean;
  hasMessages: boolean;
  isPinned: boolean;
  isHidden: boolean;
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
  groups = [],
  activeGroupId = null,
  onSelect,
  onSelectGroup,
  onTogglePin,
  onToggleHide,
  onDuplicateBot,
  onEditBot,
  onDeleteBot,
}: {
  bots: Bot[];
  activeBotId: string | null;
  sessions: Session[];
  isStreaming: boolean;
  subagents?: SubAgent[];
  pinnedBotIds?: string[];
  hiddenBotIds?: string[];
  groups?: Group[];
  activeGroupId?: string | null;
  onSelect: (id: string) => void;
  onSelectGroup?: (gid: string) => void;
  onTogglePin?: (bot: Bot) => void;
  onToggleHide?: (bot: Bot) => void;
  onDuplicateBot?: (bot: Bot) => void;
  onEditBot?: (bot: Bot) => void;
  onDeleteBot?: (bot: Bot) => void;
}) {
  const pinnedSet = new Set(pinnedBotIds);
  const hiddenSet = new Set(hiddenBotIds);

  const makeEntry = (bot: Bot): RosterEntry => {
    const last = lastMessageFor(sessions, bot.id);
    const isTyping = isStreaming && activeBotId === bot.id;
    return {
      bot,
      isTyping,
      hasMessages: last !== null,
      isPinned: pinnedSet.has(bot.id),
      isHidden: hiddenSet.has(bot.id),
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

  const getCategory = (b: Bot): string => {
    if (b.category && b.category.trim()) return b.category.trim();
    const txt = `${b.name} ${b.title || ''} ${b.id}`.toLowerCase();
    if (txt.includes('cursor') || txt.includes('coder') || txt.includes('code') || txt.includes('dev')) {
      return 'Cursor';
    }
    if (txt.includes('governor') || txt.includes('policy') || txt.includes('safety') || txt.includes('audit')) {
      return 'Governance';
    }
    return 'Ops';
  };

  const categories = useMemo(() => {
    const map = new Map<string, RosterEntry[]>();
    for (const e of mainEntries) {
      const cat = getCategory(e.bot);
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(e);
    }
    return Array.from(map.entries());
  }, [mainEntries]);

  const renderBotItem = (e: RosterEntry) => (
    <ListItem
      key={e.bot.id}
      label={e.bot.name}
      isSelected={e.bot.id === activeBotId && !activeGroupId}
      onClick={() => onSelect(e.bot.id)}
      description={
        <VStack gap={1} align="start">
          <Text
            type="supporting"
            maxLines={1}
            color={e.isTyping ? 'accent' : 'secondary'}
          >
            {e.preview}
          </Text>
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
        <Avatar name={e.bot.name} size="md" tooltip={false} />
      }
      endContent={
        <VStack gap={1} align="end">
          <HStack gap={1} vAlign="center">
            {e.isPinned ? <IconPin size="sm" color="secondary" /> : null}
            <Text type="supporting" size="xsm">
              {e.when}
            </Text>
            <BotRowMenu
              bot={e.bot}
              isPinned={e.isPinned}
              isHidden={e.isHidden}
              onTogglePin={onTogglePin}
              onToggleHide={onToggleHide}
              onDuplicate={onDuplicateBot}
              onEdit={onEditBot}
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
  );

  return (
    <VStack gap={3} height="100%" justify="between">
      <VStack gap={2} style={{flex: 1, minHeight: 0, overflowY: 'auto'}}>
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

        {/* Collapsible Category Headings */}
        {categories.length > 0 ? (
          categories.map(([catName, catEntries]) => (
            <VStack key={catName} gap={1}>
              <Collapsible
                defaultIsOpen={true}
                trigger={
                  <HStack
                    gap={2}
                    vAlign="center"
                    justify="between"
                    width="100%"
                    paddingInline={2}
                    paddingBlock={1}
                    style={{cursor: 'pointer'}}
                  >
                    <Text type="supporting" size="xsm" weight="semibold" color="secondary">
                      {catName.toUpperCase()}
                    </Text>
                    <Badge label={`${catEntries.length}`} variant="neutral" />
                  </HStack>
                }
              >
                <List density="compact">
                  {catEntries.map(renderBotItem)}
                </List>
              </Collapsible>
            </VStack>
          ))
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
                      <Avatar name={g.name} size="md" tooltip={false} />
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
    </VStack>
  );
}

