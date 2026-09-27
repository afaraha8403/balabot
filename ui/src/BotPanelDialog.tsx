import {useCallback, useEffect, useState} from 'react';
import {HStack} from '@astryxdesign/core/Stack';
import {VStack} from '@astryxdesign/core/VStack';
import {Text} from '@astryxdesign/core/Text';
import {Icon} from '@astryxdesign/core/Icon';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Button} from '@astryxdesign/core/Button';
import {List, ListItem} from '@astryxdesign/core/List';
import {TabList, Tab} from '@astryxdesign/core/TabList';
import {TextInput} from '@astryxdesign/core/TextInput';
import {TextArea} from '@astryxdesign/core/TextArea';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {IconClose, IconInfo} from './icons';
import {api, type MemoryItem, type KbDoc, type Bot} from './api';

type PanelKind = 'memory' | 'kb';

type Props = {
  bot: Bot;
  onClose: () => void;
};

export function BotPanelDialog({bot, onClose}: Props) {
  const [kind, setKind] = useState<PanelKind>('memory');
  const [memory, setMemory] = useState<MemoryItem[]>([]);
  const [docs, setDocs] = useState<KbDoc[]>([]);
  const [textValue, setTextValue] = useState('');
  const [titleValue, setTitleValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const base =
    kind === 'memory'
      ? `/api/bots/${bot.id}/memory`
      : `/api/bots/${bot.id}/kb`;

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      if (kind === 'memory') {
        const r = await api<{memory: MemoryItem[]}>(base);
        setMemory(r.memory ?? []);
      } else {
        const r = await api<{docs: KbDoc[]}>(base);
        setDocs(r.docs ?? []);
      }
    } catch {
      setMemory([]);
      setDocs([]);
    } finally {
      setIsLoading(false);
    }
  }, [base, kind]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const add = async () => {
    if (!textValue.trim()) return;
    setIsLoading(true);
    try {
      if (kind === 'memory') {
        await api(base, {method: 'POST', body: JSON.stringify({content: textValue})});
      } else {
        await api(base, {
          method: 'POST',
          body: JSON.stringify({
            title: titleValue || textValue.slice(0, 40),
            content: textValue,
          }),
        });
      }
      setTextValue('');
      setTitleValue('');
      await reload();
    } finally {
      setIsLoading(false);
    }
  };

  const remove = async (id: string) => {
    setIsLoading(true);
    try {
      await api(`${base}/${id}`, {method: 'DELETE'});
      await reload();
    } finally {
      setIsLoading(false);
    }
  };

  const itemCount = kind === 'memory' ? memory.length : docs.length;

  return (
    <Dialog isOpen onOpenChange={open => !open && onClose()} purpose="info">
      <DialogHeader
        title={`${bot.name} — ${kind === 'memory' ? 'Memory' : 'Knowledge Base'}`}
        onOpenChange={onClose}
      />
      <VStack gap={3} padding={4}>
        <TabList value={kind} onChange={v => setKind(v as PanelKind)}>
          <Tab value="memory" label="Memory" />
          <Tab value="kb" label="Knowledge base" />
        </TabList>

        {kind === 'kb' ? (
          <TextInput
            label="Title"
            value={titleValue}
            onChange={setTitleValue}
            placeholder="Document title"
            size="sm"
          />
        ) : null}

        {kind === 'memory' ? (
          <TextInput
            label="New memory"
            value={textValue}
            onChange={setTextValue}
            placeholder={`Something ${bot.name} should remember`}
            size="sm"
          />
        ) : (
          <TextArea
            label="New document"
            value={textValue}
            onChange={setTextValue}
            placeholder="Paste knowledge content"
            rows={3}
            size="sm"
          />
        )}

        <HStack gap={2} hAlign="end">
          <Button
            label={kind === 'memory' ? 'Add memory' : 'Add document'}
            variant="primary"
            size="sm"
            isLoading={isLoading}
            onClick={() => void add()}
          />
        </HStack>

        {itemCount === 0 ? (
          <EmptyState
            isCompact
            title="Nothing here yet"
            description={
              kind === 'memory'
                ? 'Add a memory to persist context for this bot.'
                : 'Add knowledge documents for this bot.'
            }
            icon={<IconInfo />}
          />
        ) : (
          <List hasDividers density="compact">
            {kind === 'memory'
              ? memory.map(m => (
                  <ListItem
                    key={m.id}
                    label={m.content}
                    description={m.category}
                    endContent={
                      <IconButton
                        label={`Delete memory ${m.id}`}
                        size="sm"
                        variant="ghost"
                        icon={<IconClose />}
                        onClick={() => void remove(m.id)}
                      />
                    }
                  />
                ))
              : docs.map(d => (
                  <ListItem
                    key={d.id}
                    label={d.title}
                    description={<Text type="supporting" maxLines={2}>{d.content}</Text>}
                    endContent={
                      <IconButton
                        label={`Delete document ${d.title}`}
                        size="sm"
                        variant="ghost"
                        icon={<IconClose />}
                        onClick={() => void remove(d.id)}
                      />
                    }
                  />
                ))}
          </List>
        )}
      </VStack>
    </Dialog>
  );
}