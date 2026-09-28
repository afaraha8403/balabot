import {useCallback, useEffect, useRef, useState} from 'react';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {VStack} from '@astryxdesign/core/VStack';
import {HStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {Button} from '@astryxdesign/core/Button';
import {Banner} from '@astryxdesign/core/Banner';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Token} from '@astryxdesign/core/Token';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Timestamp} from '@astryxdesign/core/Timestamp';
import {Spinner} from '@astryxdesign/core/Spinner';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {SegmentedControl} from '@astryxdesign/core/SegmentedControl';
import {SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {Tokenizer} from '@astryxdesign/core/Tokenizer';
import type {SearchableItem, SearchSource} from '@astryxdesign/core/Typeahead';
import {ThinkingOrb} from 'thinking-orbs';
import {
  createGroup,
  getGroup,
  getGroups,
  postGroupTurn,
  type Bot,
  type Group,
} from './api';
import {IconClose, IconWarning} from './icons';

const MIN_MEMBERS = 2;
const MAX_MEMBERS = 6;

type Props = {
  bots: Bot[];
  initialGroupId?: string | null;
  onClose: () => void;
  /** Fires after a group is created or a bot is added — lets App refresh. */
  onFleetsChanged?: () => void;
};

type ViewMode = 'chat' | 'setup';

const botSource = (bots: Bot[]): SearchSource =>
  ({
    search: (q: string) =>
      bots
        .filter(b => b.name.toLowerCase().includes(q.toLowerCase()))
        .map(b => ({id: b.id, label: `${b.icon} ${b.name}`})),
    bootstrap: () => bots.map(b => ({id: b.id, label: `${b.icon} ${b.name}`})),
  }) as unknown as SearchSource;

/**
 * Group chat (Wave 6 P3): 2–6 bots, SERIAL rounds, @mentions, per-member
 * sessions, one shared Agent Computer pane. Setup picks the members; the
 * chat view shows the shared transcript; the round counter and per-member
 * session sizes are read from the backend — never invented client-side.
 */
export function GroupChatDialog({bots, initialGroupId, onClose, onFleetsChanged}: Props) {
  const [mode, setMode] = useState<ViewMode>(initialGroupId ? 'chat' : 'setup');
  const [groups, setGroups] = useState<Group[]>([]);
  const [active, setActive] = useState<Group | null>(null);
  const [members, setMembers] = useState<SearchableItem[]>([]);
  const [groupName, setGroupName] = useState('');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const [turnBusy, setTurnBusy] = useState(false);
  const [banner, setBanner] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);

  const loadGroups = useCallback(async () => {
    const res = await getGroups();
    if (res.available !== false) {
      setGroups(res.groups ?? []);
      if (initialGroupId) {
        const found = (res.groups ?? []).find(g => g.id === initialGroupId);
        if (found) {
          try {
            const detail = await getGroup(initialGroupId);
            if (detail.available !== false && detail.group) {
              setActive(detail.group);
              setMode('chat');
            } else {
              setActive(found);
              setMode('chat');
            }
          } catch {
            setActive(found);
            setMode('chat');
          }
        }
      }
    }
  }, [initialGroupId]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [active?.transcript.length, turnBusy]);

  const selected = members.map(m => m.id);
  const canCreate = groupName.trim().length > 0 &&
    selected.length >= MIN_MEMBERS && selected.length <= MAX_MEMBERS;

  const create = async () => {
    if (!canCreate) return;
    setCreating(true);
    try {
      const r = await createGroup({name: groupName.trim(), members: selected});
      setActive(r.group);
      setMode('chat');
      setGroupName('');
      setMembers([]);
      setBanner('');
      void loadGroups();
    } catch (e) {
      setBanner((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const send = async () => {
    if (!active || !draft.trim() || turnBusy) return;
    const text = draft.trim();
    setDraft('');
    setTurnBusy(true);
    try {
      const r = await postGroupTurn(active.id, text);
      // The response is the fresh group state — adopt it wholesale, no
      // client-side synthesis of transcript rows.
      setActive(r.group);
      void loadGroups();
    } catch (e) {
      setBanner((e as Error).message);
    } finally {
      setTurnBusy(false);
    }
  };

  const openGroup = async (gid: string) => {
    try {
      const r = await getGroup(gid);
      if (r.group) {
        setActive(r.group);
        setMode('chat');
      }
    } catch (e) {
      setBanner((e as Error).message);
    }
  };

  const nameOf = (id: string) =>
    bots.find(b => b.id === id)?.name ?? id;

  return (
    <Dialog
      isOpen
      onOpenChange={open => !open && onClose()}
      purpose="form"
      variant="fullscreen">
      <DialogHeader
        title="Group chat"
        subtitle={
          active
            ? `${active.name} · round ${active.round} · ${active.members.length} bots · serial turns`
            : '2–6 bots, serial rounds, @mentions route a message'
        }
        onOpenChange={onClose}
      />
      <VStack gap={3} padding={4} height="fill">
        {banner ? (
          <Banner status="error" title="Group chat" description={banner}
                  onDismiss={() => setBanner('')} />
        ) : null}

        <SegmentedControl
          value={mode}
          onChange={v => setMode(v as ViewMode)}
          label="Group chat view">
          <SegmentedControlItem value="setup" label="New group" />
          <SegmentedControlItem value="chat" label="Open group" isDisabled={!groups.length} />
        </SegmentedControl>

        {mode === 'setup' ? (
          <VStack gap={3} maxWidth={520}>
            <TextInput
              label="Group name"
              value={groupName}
              onChange={setGroupName}
              placeholder="e.g. Ops war room"
              description="A shared room where 2–6 bots take serial turns."
            />
            <Tokenizer
              label={`Members (${MIN_MEMBERS}–${MAX_MEMBERS} bots)`}
              searchSource={botSource(bots)}
              value={members}
              onChange={setMembers}
              placeholder="Add bots…"
              maxEntries={MAX_MEMBERS}
              hasClear
              description="The first member hosts the shared Agent Computer pane."
            />
            <HStack gap={2}>
              <Button
                label="Create group"
                variant="primary"
                isDisabled={!canCreate || creating}
                isLoading={creating}
                onClick={() => void create()}
              />
            </HStack>
            {groups.length ? (
              <VStack gap={2}>
                <Text type="supporting">Existing groups</Text>
                <HStack gap={1} vAlign="center" wrap="wrap">
                  {groups.map(g => (
                    <Button
                      key={g.id}
                      label={`Open ${g.name}`}
                      size="sm"
                      variant="secondary"
                      onClick={() => void openGroup(g.id)}
                    />
                  ))}
                </HStack>
              </VStack>
            ) : null}
          </VStack>
        ) : active ? (
          <VStack gap={2} height="fill">
            <HStack gap={2} vAlign="center" wrap="wrap">
              {active.members.map(m => (
                <Token
                  key={m}
                  label={`${nameOf(m)}${m === active.computerAgent ? ' · shared screen' : ''}`}
                  size="sm"
                  color={m === active.computerAgent ? 'teal' : 'blue'}
                />
              ))}
              <StatusDot
                variant={turnBusy ? 'warning' : 'success'}
                label={turnBusy ? 'Serial round running' : `Round ${active.round}`}
                isPulsing={turnBusy}
              />
              <Text type="supporting">
                {active.members
                  .map(m => `${nameOf(m)}: ${active.sessionLens[m] ?? 0} msgs`)
                  .join(' · ')}
              </Text>
            </HStack>
            <VStack
              gap={2}
              padding={3}
              height="fill"
              style={{overflowY: 'auto', minHeight: 0}}
            >
              <div ref={listRef} style={{display: 'contents'}} />
              {active.transcript.length === 0 && !turnBusy ? (
                <EmptyState
                  isCompact
                  title="No turns yet"
                  description="Send a message. Mention @bot-id to route it, or leave it bare for every member in order."
                />
              ) : null}
              {active.transcript.map((e, i) => (
                <VStack key={`${e.at}-${i}`} gap={1} align="start">
                  <HStack gap={2} vAlign="center">
                    <Token
                      label={e.from}
                      size="sm"
                      color={e.kind === 'error' ? 'red' : 'blue'}
                    />
                    <Text type="supporting">round {e.round}</Text>
                    <Timestamp value={e.at} format="time" />
                  </HStack>
                  {e.kind === 'error' ? (
                    <Banner
                      status="error"
                      title={`${nameOf(e.from)} could not respond`}
                      description={e.detail ?? 'unknown error'}
                    />
                  ) : (
                    <Text type="body">{e.text}</Text>
                  )}
                </VStack>
              ))}
              {turnBusy ? (
                <HStack gap={2} vAlign="center">
                  <ThinkingOrb state="working" size={32} theme="dark"
                               aria-label="Group round in progress" />
                  <Text type="supporting">Serial round in progress…</Text>
                </HStack>
              ) : null}
            </VStack>
            <HStack gap={2} vAlign="end">
              <TextInput
                label="Message the group"
                value={draft}
                onChange={setDraft}
                placeholder={`Message… (@${active.members.join(' @')} to address)`}
                size="sm"
                isDisabled={turnBusy}
                onEnter={() => void send()}
              />
              <Button
                label="Send to group"
                variant="primary"
                size="sm"
                isDisabled={turnBusy || !draft.trim()}
                isLoading={turnBusy}
                onClick={() => void send()}
              />
              {onFleetsChanged ? (
                <Button
                  label="Refresh"
                  size="sm"
                  variant="ghost"
                  onClick={() => void loadGroups()}
                />
              ) : null}
            </HStack>
          </VStack>
        ) : (
          <EmptyState
            title="Pick a group"
            description="Create one under 'New group', or open an existing one."
            icon={<IconWarning />}
          />
        )}
      </VStack>
    </Dialog>
  );
}
