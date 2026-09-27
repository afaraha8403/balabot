import {Avatar} from '@astryxdesign/core/Avatar';
import {Badge} from '@astryxdesign/core/Badge';
import {HStack} from '@astryxdesign/core/Stack';
import {List} from '@astryxdesign/core/List';
import {ListItem} from '@astryxdesign/core/List';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';
import {ThinkingOrb} from 'thinking-orbs';
import type {Bot, Session} from '../api';

// Messenger-style roster rows: avatar · bold name · one-line preview · timestamp.
//
// Every field here is derived from real state — this roster previously rendered
// a hardcoded `canned` array indexed by position, so bot #2 read "Typing…"
// forever and each bot showed a conversation that did not exist. A preview you
// can click through to but never find is worse than no preview: it reads as a
// broken feature rather than absent data. So: the preview is the bot's actual
// last message, the timestamp is that message's real time, and "typing" appears
// only while a stream for that bot is genuinely in flight.
export type RosterEntry = {
  bot: Bot;
  preview: string;
  when: string;
  isTyping: boolean;
  hasMessages: boolean;
  isGroup?: boolean;
  members?: string[];
};

/** Compact recency label: time today, "Yesterday", weekday this week, else a date. */
function formatWhen(at: number): string {
  const d = new Date(at);
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

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
  onSelect,
}: {
  bots: Bot[];
  activeBotId: string | null;
  sessions: Session[];
  /** True while the active bot is streaming — the only honest source of "typing". */
  isStreaming: boolean;
  onSelect: (id: string) => void;
}) {
  const entries: RosterEntry[] = bots.map(bot => {
    const last = lastMessageFor(sessions, bot.id);
    const isTyping = isStreaming && activeBotId === bot.id;
    return {
      bot,
      isTyping,
      hasMessages: last !== null,
      preview: isTyping
        ? 'Typing…'
        : last
          ? last.content.replace(/\s+/g, ' ').trim().slice(0, 90)
          : 'No messages yet',
      when: last ? formatWhen(last.at) : '',
    };
  });

  return (
    <List density="compact">
      {entries.map(e => (
        <ListItem
          key={e.bot.id}
          label={e.bot.name}
          isSelected={e.bot.id === activeBotId}
          onClick={() => onSelect(e.bot.id)}
          description={
            <Text
              type="supporting"
              maxLines={1}
              color={e.isTyping ? 'accent' : 'secondary'}
            >
              {e.preview}
            </Text>
          }
          startContent={
            <Avatar name={e.bot.name} size="md" tooltip={false} />
          }
          endContent={
            <VStack gap={1} align="end">
              <Text type="supporting" size="xsm">
                {e.when}
              </Text>
              {e.isTyping ? (
                // Same signal as the in-thread orb, at the inline-text preset.
                // Replaces a pulsing StatusDot: the roster and the thread now
                // speak the same visual language for "this bot is working".
                <ThinkingOrb
                  state="working"
                  size={20}
                  theme="dark"
                  aria-label={`${e.bot.name} is working`}
                />
              ) : e.isGroup ? (
                <Badge label={`${e.members?.length ?? 2}`} variant="neutral" />
              ) : null}
            </VStack>
          }
        />
      ))}
      {entries.length === 0 ? (
        <HStack gap={2} padding={2}>
          <Text type="supporting">No bots in the roster yet.</Text>
        </HStack>
      ) : null}
    </List>
  );
}
