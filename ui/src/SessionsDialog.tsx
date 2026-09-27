import {useState} from 'react';
import {VStack} from '@astryxdesign/core/VStack';
import {HStack} from '@astryxdesign/core/Stack';
import {Button} from '@astryxdesign/core/Button';
import {List, ListItem} from '@astryxdesign/core/List';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {Icon} from '@astryxdesign/core/Icon';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Text} from '@astryxdesign/core/Text';
import {newSession} from './sessions';
import {IconAdd, IconClose} from './icons';
import type {Session} from './api';

/**
 * "A: msgs 1-40 · B: 41-90" — the session's topic spans, rendered as one
 * compact line. Every session is responsible for something; this makes the
 * responsibility record visible instead of hiding it in the store.
 */
export function topicSpanLabel(
  spans: {topic: string; start_seq: number; end_seq: number}[] | undefined,
): string {
  if (!spans || spans.length === 0) return '';
  return spans.map(s => `${s.topic}: msgs ${s.start_seq}-${s.end_seq}`).join(' · ');
}

type Props = {
  /** Bot the new conversation belongs to. Without it the session is orphaned:
   *  the list filters on `s.botId === activeBotId`, so a session created with an
   *  empty botId exists in storage but can never be shown or deleted. */
  botId: string;
  sessions: Session[];
  activeId: string | null;
  onSwitch: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: (session: Session) => void;
  onClose: () => void;
};

export function SessionsDialog({botId, sessions, activeId, onSwitch, onDelete, onNew, onClose}: Props) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const target = sessions.find(s => s.id === confirmId);

  return (
    <>
      <Dialog isOpen onOpenChange={open => !open && onClose()} purpose="info">
        <DialogHeader title="Conversations" onOpenChange={onClose} />
        <VStack gap={3} padding={4}>
          <Button
            label="New conversation"
            variant="primary"
            icon={<IconAdd />}
            isDisabled={!botId}
            onClick={() => {
              if (!botId) return;
              onNew(newSession(botId, 'New chat'));
              onClose();
            }}
          />
          {sessions.length === 0 ? (
            <List>
              <ListItem label="No conversations yet" description="Start chatting to create one." />
            </List>
          ) : (
            <List hasDividers density="compact">
              {sessions.map(s => {
                const spans = topicSpanLabel(s.topicSpans);
                return (
                  <ListItem
                    key={s.id}
                    label={s.title}
                    description={
                      spans
                        ? `${s.messages.length} messages — ${spans}`
                        : `${s.messages.length} messages`
                    }
                    onClick={() => {
                      onSwitch(s.id);
                      onClose();
                    }}
                    endContent={
                      <IconButton
                        label={`Delete conversation ${s.title}`}
                        size="sm"
                        variant="ghost"
                        icon={<IconClose />}
                        onClick={e => {
                          e.stopPropagation();
                          setConfirmId(s.id);
                        }}
                      />
                    }
                  />
                );
              })}
            </List>
          )}
          {/* The purpose record: what this bot's conversations are FOR. Rendered
              once per bot — every session carries it server-side. */}
          {sessions.some(s => s.purpose) ? (
            <VStack gap={1} align="start">
              <Text type="supporting" weight="semibold">
                Purpose records
              </Text>
              {sessions
                .filter(s => s.purpose)
                .map(s => (
                  <Text key={s.id} type="supporting">
                    {s.title}: {s.purpose}
                  </Text>
                ))}
            </VStack>
          ) : null}
        </VStack>
      </Dialog>
      {target ? (
        <Dialog
          isOpen
          onOpenChange={open => !open && setConfirmId(null)}
          purpose="required"
        >
          <DialogHeader title="Delete conversation?" onOpenChange={() => setConfirmId(null)} />
          <VStack gap={4} padding={4}>
            {target.purpose ? (
              <Text type="supporting">
                “{target.purpose}” and its topic record will be removed from the server.
              </Text>
            ) : null}
            <HStack gap={2} hAlign="end">
              <Button
                label="Cancel"
                variant="secondary"
                onClick={() => setConfirmId(null)}
              />
              <Button
                label="Delete"
                variant="destructive"
                onClick={() => {
                  onDelete(target.id);
                  setConfirmId(null);
                }}
              />
            </HStack>
          </VStack>
        </Dialog>
      ) : null}
    </>
  );
}
