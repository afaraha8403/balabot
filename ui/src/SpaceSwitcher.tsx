import {useState, useMemo} from 'react';
import {Popover} from '@astryxdesign/core/Popover';
import {Button} from '@astryxdesign/core/Button';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {Icon} from '@astryxdesign/core/Icon';
import {VStack} from '@astryxdesign/core/VStack';
import {HStack, StackItem} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {Token} from '@astryxdesign/core/Token';
import {
  CheckIcon,
  ChevronDownIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import type {Session} from './api';
import {topicSpanLabel} from './sessions';

export {topicSpanLabel};

type Space = {
  id: string;
  name: string;
  description?: string;
};

const DEFAULT_SPACES: Space[] = [
  {id: 'default', name: 'Personal Space', description: 'Your private workspace and bots'},
  {id: 'team', name: 'Team Fleet', description: 'Shared fleet and operations'},
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
 * Astryx SpaceSwitcher at the top of the sidebar.
 *
 * The popover is the Astryx `Popover` primitive (anchored, light-dismiss,
 * escape-to-close, viewport-fitted) so the menu floats over the sidebar
 * instead of expanding document flow. Rows and sections are composed from
 * Astryx layout/action components (`Button`, `HStack`/`VStack`, `Text`,
 * `Token`) so every dimension is owned by the framework's token system —
 * no Tailwind utilities, no hand-rolled px.
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

  const activeSpace = DEFAULT_SPACES.find(s => s.id === selectedId) ?? DEFAULT_SPACES[0];

  const botSessions = useMemo(() => {
    if (!activeBotId) return [];
    return sessions.filter(s => s.botId === activeBotId);
  }, [sessions, activeBotId]);

  return (
    <>
      <Popover
        data-testid="space-switcher-popover"
        isOpen={open}
        onOpenChange={setOpen}
        placement="below"
        alignment="start"
        width={288}
        content={
          <VStack gap={1} padding={2}>
            <Text type="label" color="secondary" size="2xs">
              Spaces
            </Text>

            {DEFAULT_SPACES.map(space => {
              const isSelected = space.id === selectedId;
              return (
                <Button
                  key={space.id}
                  label={space.name}
                  variant={isSelected ? 'secondary' : 'ghost'}
                  size="sm"
                  width="100%"
                  tooltip={space.description}
                  endContent={
                    isSelected ? (
                      <Icon icon={CheckIcon} size="sm" color="primary" />
                    ) : undefined
                  }
                  onClick={() => {
                    setSelectedId(space.id);
                    onSelectSpace?.(space.id);
                  }}
                />
              );
            })}

            {activeBotId ? (
              <VStack gap={1}>
                <HStack gap={1} justify="between" vAlign="center">
                  <Text weight="medium" size="sm">
                    Chats · {activeBotName || 'Bot'}
                  </Text>
                  {onNewSession ? (
                    <Button
                      label="New conversation"
                      size="sm"
                      variant="ghost"
                      icon={<Icon icon={PlusIcon} size="sm" />}
                      onClick={() => {
                        onNewSession();
                        setOpen(false);
                      }}
                    />
                  ) : null}
                </HStack>

                {botSessions.length === 0 ? (
                  <Text type="supporting" color="secondary" size="2xs">
                    No previous conversations for this bot.
                  </Text>
                ) : (
                  <VStack gap={0.5}>
                    {botSessions.map(session => {
                      const isCurrent = session.id === activeSessionId;
                      const spans = topicSpanLabel(session.topicSpans);
                      return (
                        <HStack key={session.id} gap={1} vAlign="center">
                          <StackItem size="fill">
                            <Button
                              label={session.title}
                              size="sm"
                              width="100%"
                              variant={isCurrent ? 'secondary' : 'ghost'}
                              endContent={
                                <Text type="supporting" color="secondary" size="2xs">
                                  {`${session.messages.length} msgs${spans ? ` · ${spans}` : ''}`}
                                </Text>
                              }
                              onClick={() => {
                                onSelectSession?.(session.id);
                                setOpen(false);
                              }}
                            />
                          </StackItem>
                          {onDeleteSession ? (
                            <IconButton
                              label={`Delete ${session.title}`}
                              size="sm"
                              variant="ghost"
                              icon={<Icon icon={TrashIcon} size="sm" />}
                              onClick={() => setPendingDeleteSession(session)}
                            />
                          ) : null}
                        </HStack>
                      );
                    })}
                  </VStack>
                )}

                {botSessions.some(s => s.purpose) ? (
                  <VStack gap={0.5}>
                    <Text type="label" color="secondary" size="2xs">
                      Purpose records
                    </Text>
                    {botSessions.filter(s => s.purpose).map(s => (
                      <Text key={s.id} type="supporting" color="secondary" size="2xs">
                        <Text weight="semibold" size="2xs">
                          {`${s.title}: `}
                        </Text>
                        {s.purpose}
                      </Text>
                    ))}
                  </VStack>
                ) : null}
              </VStack>
            ) : null}
          </VStack>
        }
      >
        <Button
          data-testid="space-switcher-trigger"
          label={activeSpace.name}
          variant="ghost"
          size="sm"
          width="100%"
          icon={
            <Token label={activeSpace.name.slice(0, 1)} size="sm" color="purple" />
          }
          endContent={
            <Icon icon={ChevronDownIcon} size="sm" color="secondary" />
          }
        />
      </Popover>

      <Dialog
        isOpen={pendingDeleteSession !== null}
        onOpenChange={next => {
          if (!next) setPendingDeleteSession(null);
        }}
        width={400}
      >
        <DialogHeader
          title={pendingDeleteSession ? `Delete "${pendingDeleteSession.title}"?` : 'Delete conversation?'}
          onOpenChange={next => {
            if (!next) setPendingDeleteSession(null);
          }}
          subtitle={pendingDeleteSession?.purpose}
        />
        <VStack gap={2} padding={3}>
          <Text type="supporting" color="secondary">
            This conversation and its message records will be permanently removed.
          </Text>
          <HStack gap={2} justify="end">
            <Button
              label="Cancel"
              variant="ghost"
              size="sm"
              onClick={() => setPendingDeleteSession(null)}
            />
            <Button
              label="Delete"
              variant="destructive"
              size="sm"
              onClick={() => {
                onDeleteSession?.(pendingDeleteSession!.id);
                setPendingDeleteSession(null);
              }}
            />
          </HStack>
        </VStack>
      </Dialog>
    </>
  );
}