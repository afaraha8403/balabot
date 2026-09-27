import {useState} from 'react';
import {VStack} from '@astryxdesign/core/VStack';
import {HStack} from '@astryxdesign/core/Stack';
import {Button} from '@astryxdesign/core/Button';
import {List, ListItem} from '@astryxdesign/core/List';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {Icon} from '@astryxdesign/core/Icon';
import {IconButton} from '@astryxdesign/core/IconButton';
import {newSession} from './sessions';
import type {Session} from './api';

type Props = {
  sessions: Session[];
  activeId: string | null;
  onSwitch: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: (session: Session) => void;
  onClose: () => void;
};

export function SessionsDialog({sessions, activeId, onSwitch, onDelete, onNew, onClose}: Props) {
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
            icon={<Icon icon="arrowUp" />}
            onClick={() => {
              onNew(newSession('', 'New chat'));
              onClose();
            }}
          />
          {sessions.length === 0 ? (
            <List>
              <ListItem label="No conversations yet" description="Start chatting to create one." />
            </List>
          ) : (
            <List hasDividers density="compact">
              {sessions.map(s => (
                <ListItem
                  key={s.id}
                  label={s.title}
                  description={`${s.messages.length} messages`}
                  onClick={() => {
                    onSwitch(s.id);
                    onClose();
                  }}
                  endContent={
                    <IconButton
                      label={`Delete conversation ${s.title}`}
                      size="sm"
                      variant="ghost"
                      icon={<Icon icon="close" />}
                      onClick={e => {
                        e.stopPropagation();
                        setConfirmId(s.id);
                      }}
                    />
                  }
                />
              ))}
            </List>
          )}
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