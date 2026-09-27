import {useCallback, useEffect, useState} from 'react';
import {HStack} from '@astryxdesign/core/Stack';
import {VStack} from '@astryxdesign/core/VStack';
import {Text} from '@astryxdesign/core/Text';
import {Icon} from '@astryxdesign/core/Icon';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Button} from '@astryxdesign/core/Button';
import {List, ListItem} from '@astryxdesign/core/List';
import {Token} from '@astryxdesign/core/Token';
import {TabList, Tab} from '@astryxdesign/core/TabList';
import {Selector} from '@astryxdesign/core/Selector';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {
  getSkillLibrary,
  postSkillPin,
  postSkillPromote,
  type Bot,
  type SkillEntry,
  type SkillLibrary,
} from './api';

import {
  IconAdd,
  IconError,
  IconApply,
  IconInfo,
  IconUpload,
  IconWarning,
} from './icons';

type Group = 'learned' | 'brought';
type Detail = SkillEntry | null;

type Props = {
  /** The fleet's bots — the real share targets now that there is no org layer. */
  bots: Bot[];
  onClose: () => void;
};

function grantsLabel(entry: SkillEntry): string {
  const g = entry.grants;
  if (g === undefined || g === null) return 'not shared';
  if (g === 'all' || (Array.isArray(g) && g.includes('all'))) return 'all bots';
  if (Array.isArray(g)) return g.length > 0 ? g.join(', ') : 'not shared';
  return String(g);
}

function stateToken(entry: SkillEntry) {
  const state = entry.state ?? '';
  const color =
    state === 'quarantine' ? 'orange' : state === 'active' ? 'green' : 'gray';
  return <Token label={state || 'unknown'} size="sm" color={color} />;
}

export function SkillLibraryDialog({bots, onClose}: Props) {
  const [group, setGroup] = useState<Group>('learned');
  const [library, setLibrary] = useState<SkillLibrary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<Detail>(null);
  const [promoteTarget, setPromoteTarget] = useState<{name: string; share: string} | null>(null);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const lib = await getSkillLibrary();
      setLibrary({
        learned: lib.learned ?? [],
        brought: lib.brought ?? [],
        note: lib.note,
      });
    } catch (e) {
      setError((e as Error).message);
      setLibrary(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const entries: SkillEntry[] = library ? library[group] : [];
  const note = library?.note;

  const togglePin = async (entry: SkillEntry) => {
    const pinned = entry.state === 'pinned';
    try {
      await postSkillPin({name: entry.name, pinned: !pinned});
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const promote = async (name: string, share: string | string[]) => {
    try {
      await postSkillPromote({name, share});
      setPromoteTarget(null);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Dialog isOpen onOpenChange={open => !open && onClose()} purpose="info">
      <DialogHeader title="Skill library" onOpenChange={onClose} />
      <VStack gap={3} padding={4}>
        <TabList value={group} onChange={v => setGroup(v as Group)}>
          <Tab value="learned" label="Learned" />
          <Tab value="brought" label="Brought" />
        </TabList>

        {error ? (
          <HStack gap={2} vAlign="center">
            <IconError color="red" />
            <Text type="supporting">{error}</Text>
          </HStack>
        ) : null}

        {isLoading && library === null ? (
          <Text type="supporting">Loading skills…</Text>
        ) : null}

        {library !== null && entries.length === 0 ? (
          note ? (
            <EmptyState
              isCompact
              title="Nothing here yet"
              description={note}
              icon={<IconInfo />}
            />
          ) : (
            <EmptyState
              isCompact
              title={`No ${group} skills`}
              description={
                group === 'learned'
                  ? 'Skills this org taught its bots will appear here.'
                  : 'Skills installed from outside will appear here.'
              }
              icon={<IconInfo />}
            />
          )
        ) : null}

        {entries.length > 0 ? (
          <List hasDividers density="compact">
            {entries.map(entry => (
              <ListItem
                key={entry.name}
                label={entry.name}
                description={
                  <HStack gap={2} vAlign="center" wrap="wrap">
                    <Token label={entry.source} size="sm" color="teal" />
                    {stateToken(entry)}
                    <Text type="supporting">{grantsLabel(entry)}</Text>
                  </HStack>
                }
                endContent={
                  <HStack gap={1} vAlign="center">
                    <IconButton
                      label={entry.state === 'pinned' ? `Unpin ${entry.name}` : `Pin ${entry.name}`}
                      size="sm"
                      variant="ghost"
                      icon={entry.state === 'pinned' ? <IconApply /> : <IconAdd />}
                      onClick={() => void togglePin(entry)}
                    />
                    <IconButton
                      label={`Promote ${entry.name}`}
                      size="sm"
                      variant="ghost"
                      icon={<IconUpload />}
                      onClick={() => setPromoteTarget({name: entry.name, share: 'all'})}
                    />
                    <IconButton
                      label={`Details for ${entry.name}`}
                      size="sm"
                      variant="ghost"
                      icon={<IconInfo />}
                      onClick={() => setDetail(entry)}
                    />
                  </HStack>
                }
              />
            ))}
          </List>
        ) : null}

        {promoteTarget ? (
          <VStack gap={2}>
            <Selector
              label={`Promote ${promoteTarget.name} to`}
              value={promoteTarget.share}
              onChange={v => setPromoteTarget({...promoteTarget, share: v ?? 'all'})}
              size="sm"
              options={[
                {value: 'all', label: 'All bots'},
                ...bots.map(b => ({value: b.id, label: b.name})),
              ]}
            />
            <HStack gap={2} hAlign="end">
              <Button
                label="Cancel"
                variant="ghost"
                size="sm"
                onClick={() => setPromoteTarget(null)}
              />
              <Button
                label="Promote"
                variant="primary"
                size="sm"
                onClick={() =>
                  void promote(promoteTarget.name, promoteTarget.share)
                }
              />
            </HStack>
          </VStack>
        ) : null}

        {detail ? (
          <VStack gap={2}>
            <Text weight="semibold">{detail.name}</Text>
            {detail.description ? (
              <Text type="supporting">{detail.description}</Text>
            ) : null}
            <HStack gap={2} wrap="wrap">
              <Token label={detail.source} size="sm" color="teal" />
              {stateToken(detail)}
              <Token label={grantsLabel(detail)} size="sm" color="gray" />
              {detail.org ? <Token label={detail.org} size="sm" color="blue" /> : null}
            </HStack>
            <HStack hAlign="end">
              <Button label="Close" variant="ghost" size="sm" onClick={() => setDetail(null)} />
            </HStack>
          </VStack>
        ) : null}
      </VStack>
    </Dialog>
  );
}
