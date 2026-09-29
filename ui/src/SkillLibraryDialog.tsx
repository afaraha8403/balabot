import {useCallback, useEffect, useState} from 'react';
import {HStack, StackItem} from '@astryxdesign/core/Stack';
import {VStack} from '@astryxdesign/core/VStack';
import {Text} from '@astryxdesign/core/Text';
import {Button} from '@astryxdesign/core/Button';
import {List, ListItem} from '@astryxdesign/core/List';
import {Token} from '@astryxdesign/core/Token';
import {TabList, Tab} from '@astryxdesign/core/TabList';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {IconButton} from '@astryxdesign/core/IconButton';
import {IconError, IconApply, IconInfo, IconUpload, IconWarning} from './icons';
import {
  getSkillLibrary,
  postSkillPin,
  postSkillPromote,
  type Bot,
  type SkillEntry,
  type SkillLibraryResponse,
} from './api';

type Group = 'learned' | 'brought';

type Props = {
  /** The fleet's bots — the real share targets. */
  bots: Bot[];
  /** Which bot's skill tree to show. The library is per-profile. */
  activeBotId: string | null;
  onClose: () => void;
};

/** An /api/org/* stub response: HTTP 200 with {available:false, reason}. */
type StubRejection = {available?: boolean; reason?: string};

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

export function SkillLibraryDialog({bots, activeBotId, onClose}: Props) {
  // Classification comes straight from GET /api/skills/library: `learned` and
  // `brought` are server-reported, never inferred client-side.
  const [group, setGroup] = useState<Group>('brought');
  const [library, setLibrary] = useState<SkillLibraryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<SkillEntry | null>(null);
  const [promoteTarget, setPromoteTarget] = useState<{name: string; share: string} | null>(null);
  const [actionNotice, setActionNotice] = useState('');

  const reload = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const lib = await getSkillLibrary(activeBotId ?? undefined);
      setLibrary(lib);
    } catch (e) {
      setError((e as Error).message);
      setLibrary(null);
    } finally {
      setIsLoading(false);
    }
  }, [activeBotId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const available = library?.available ?? true;
  const entries: SkillEntry[] =
    library?.[group] ?? [];

  /**
   * Honest action handling: /api/org/skills/{pin,promote} currently answer
   * {available:false, reason} with HTTP 200. We detect that and surface the
   * reason instead of pretending the action happened.
   */
  const runAction = async (
    call: () => Promise<unknown>,
    what: string,
    okThen: () => void,
  ) => {
    setError('');
    setActionNotice('');
    try {
      const res = (await call()) as StubRejection;
      if (res && res.available === false) {
        setError(`${what} is not available: ${res.reason ?? 'no backend'}`);
        return;
      }
      okThen();
    } catch (e) {
      setError(`${what} failed: ${(e as Error).message}`);
    }
  };

  const togglePin = (entry: SkillEntry) =>
    runAction(
      () => postSkillPin({name: entry.name, pinned: entry.state !== 'pinned'}),
      'Pin',
      () => void reload(),
    );

  const promote = (name: string, share: string | string[]) =>
    runAction(
      () => postSkillPromote({name, share}),
      'Promote',
      () => {
        setPromoteTarget(null);
        void reload();
      },
    );

  return (
    <Dialog isOpen onOpenChange={open => !open && onClose()} purpose="info">
      <DialogHeader title="Skill library" onOpenChange={onClose} />
      <VStack gap={3} padding={4} height="fill" minHeight={0}>
        <TabList value={group} onChange={v => setGroup(v as Group)}>
          <Tab value="learned" label="Learned" />
          <Tab value="brought" label="Brought" />
        </TabList>

        {/* Scroll region: StackItem with size="fill" + isScrollable is a
            complete bounded scroll region (flex min-height reset + overflow:
            auto), so the header/tabs stay usable and the list scrolls. */}
        <StackItem size="fill" isScrollable className="rk-scroll">
        {error ? (
          <HStack gap={2} vAlign="center">
            <IconError color="red" />
            <Text type="supporting">{error}</Text>
          </HStack>
        ) : null}
        {actionNotice ? (
          <Text type="supporting">{actionNotice}</Text>
        ) : null}

        {isLoading && library === null ? (
          <Text type="supporting">Loading skills…</Text>
        ) : null}

        {!isLoading && library !== null && !available ? (
          <EmptyState
            isCompact
            title="Skill library unavailable"
            description={library.reason ?? 'no reason given'}
            icon={<IconWarning />}
          />
        ) : null}

        {library !== null && available && entries.length === 0 ? (
          library.note ? (
            <EmptyState
              isCompact
              title="Nothing here yet"
              description={library.note}
              icon={<IconInfo />}
            />
          ) : (
            <EmptyState
              isCompact
              title={`No ${group} skills`}
              description={
                group === 'learned'
                  ? 'Skills attributed to the self-improvement loop will appear here once curator state exists.'
                  : 'Skills installed from outside will appear here.'
              }
              icon={<IconInfo />}
            />
          )
        ) : null}

        {library !== null && available && entries.length > 0 ? (
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
                    {/* Pin is wired, but honestly reports the backend's
                        `available:false` instead of pretending to succeed. */}
                    <IconButton
                      label={entry.state === 'pinned' ? `Unpin ${entry.name}` : `Pin ${entry.name}`}
                      size="sm"
                      variant="ghost"
                      icon={<IconApply />}
                      onClick={() => togglePin(entry)}
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
            <Text type="supporting">
              Promote {promoteTarget.name} — pick a share scope.
            </Text>
            <Text type="supporting" color="secondary">
              All bots, or one bot from the fleet. Cross-bot sharing goes
              through /api/org/skills/promote.
            </Text>
            <HStack gap={2} hAlign="end">
              <Button
                label="Cancel"
                variant="ghost"
                size="sm"
                onClick={() => setPromoteTarget(null)}
              />
              <Button
                label="Promote to all bots"
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
          </VStack>
        ) : null}
        </StackItem>
      </VStack>
    </Dialog>
  );
}
