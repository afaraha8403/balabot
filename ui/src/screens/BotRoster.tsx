import {Avatar} from '@astryxdesign/core/Avatar';
import {Badge} from '@astryxdesign/core/Badge';
import {HStack} from '@astryxdesign/core/Stack';
import {List} from '@astryxdesign/core/List';
import {ListItem} from '@astryxdesign/core/List';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/VStack';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import type {Bot} from '../api';

// Messenger-style roster rows: avatar · bold name · one-line preview ·
// right-aligned timestamp. Placeholder previews until the sessions feed is live.
export type RosterEntry = {
  bot: Bot;
  preview: string;
  when: string;
  isTyping: boolean;
  isGroup?: boolean;
  members?: string[];
};

const previewFor = (b: Bot, i: number): RosterEntry => {
  const canned = [
    {preview: 'Booked the venue and sent the confirmation around.', when: '3:51 AM', isTyping: false},
    {preview: 'Typing…', when: '11:51 PM', isTyping: true},
    {preview: 'Sent. Inbox at zero, 5 drafts parked for tomorrow.', when: '8:51 PM', isTyping: false},
    {preview: 'Found 3 flights under the budget cap.', when: '1:12 PM', isTyping: false},
    {preview: 'Ledger reconciled, 2 items flagged for review.', when: 'Tue', isTyping: false},
    {preview: 'Watching the tunnel — quiet night.', when: 'Mon', isTyping: false},
  ];
  return {bot: b, ...canned[i % canned.length]};
};

export function BotRoster({
  bots,
  activeBotId,
  onSelect,
}: {
  bots: Bot[];
  activeBotId: string | null;
  onSelect: (id: string) => void;
}) {
  const entries: RosterEntry[] = bots.map((b, i) => previewFor(b, i));

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
                <StatusDot variant="accent" label="Typing" isPulsing />
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
