import {useEffect, useMemo, useRef, useState} from 'react';
import {Dialog} from '@astryxdesign/core/Dialog';
import {TextInput} from '@astryxdesign/core/TextInput';
import {VStack} from '@astryxdesign/core/VStack';
import {HStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {Avatar} from '@astryxdesign/core/Avatar';
import {Badge} from '@astryxdesign/core/Badge';
import {List} from '@astryxdesign/core/List';
import {ListItem} from '@astryxdesign/core/List';
import {Divider} from '@astryxdesign/core/Divider';
import {
  IconAgentComputer,
  IconConversations,
  IconCost,
  IconCreateBot,
  IconGovernance,
  IconGroupChat,
  IconMemory,
  IconOps,
  IconSearch,
  IconSkills,
} from './icons';
import type {Bot, Group, Session} from './api';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  bots: Bot[];
  groups: Group[];
  sessions: Session[];
  onSelectBot: (id: string) => void;
  onSelectGroup: (gid: string) => void;
  onSelectSession: (sid: string, botId: string) => void;
  onAction: (actionId: string) => void;
};

type PaletteItem = {
  id: string;
  category: 'Bots' | 'Groups' | 'Conversations' | 'Actions';
  label: string;
  subtitle?: string;
  icon?: React.ReactNode;
  onExecute: () => void;
};

export function isCommandPaletteHotkey(event: KeyboardEvent): boolean {
  if (event.repeat || event.altKey || event.shiftKey) return false;
  if (!(event.metaKey || event.ctrlKey)) return false;
  return event.key.toLowerCase() === 'k';
}

function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}

export function CommandPalette({
  isOpen,
  onClose,
  bots,
  groups,
  sessions,
  onSelectBot,
  onSelectGroup,
  onSelectSession,
  onAction,
}: Props) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [modKey, setModKey] = useState('⌘');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setModKey(isApplePlatform() ? '⌘' : 'Ctrl+');
  }, []);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const items: PaletteItem[] = useMemo(() => {
    const list: PaletteItem[] = [];

    // Bots
    for (const b of bots) {
      list.push({
        id: `bot-${b.id}`,
        category: 'Bots',
        label: b.name,
        subtitle: b.title || b.description,
        icon: <Avatar name={b.name} size="sm" tooltip={false} />,
        onExecute: () => {
          onSelectBot(b.id);
          onClose();
        },
      });
    }

    // Groups
    for (const g of groups) {
      list.push({
        id: `group-${g.id}`,
        category: 'Groups',
        label: g.name,
        subtitle: `${g.members.length} participating bots`,
        icon: <IconGroupChat size="sm" color="accent" />,
        onExecute: () => {
          onSelectGroup(g.id);
          onClose();
        },
      });
    }

    // Conversations
    for (const s of sessions) {
      list.push({
        id: `session-${s.id}`,
        category: 'Conversations',
        label: s.title,
        subtitle: s.purpose || `Bot: ${s.botId}`,
        icon: <IconConversations size="sm" color="secondary" />,
        onExecute: () => {
          onSelectSession(s.id, s.botId);
          onClose();
        },
      });
    }

    // Actions
    list.push(
      {
        id: 'action-new-bot',
        category: 'Actions',
        label: 'Create a Bot (with consent)',
        subtitle: 'Cmd/Ctrl+N',
        icon: <IconCreateBot size="sm" color="accent" />,
        onExecute: () => {
          onAction('new-bot');
          onClose();
        },
      },
      {
        id: 'action-new-group',
        category: 'Actions',
        label: 'Start a Group Chat',
        subtitle: 'Collaborate with 2–6 bots',
        icon: <IconGroupChat size="sm" color="accent" />,
        onExecute: () => {
          onAction('new-group');
          onClose();
        },
      },
      {
        id: 'action-skills',
        category: 'Actions',
        label: 'Skill Library & Marketplace',
        subtitle: 'Cmd/Ctrl+Shift+M',
        icon: <IconSkills size="sm" color="accent" />,
        onExecute: () => {
          onAction('skills');
          onClose();
        },
      },
      {
        id: 'action-computer',
        category: 'Actions',
        label: 'Open Agent Computer',
        subtitle: 'Watch and control persistent desktop',
        icon: <IconAgentComputer size="sm" color="accent" />,
        onExecute: () => {
          onAction('computer');
          onClose();
        },
      },
      {
        id: 'action-memory',
        category: 'Actions',
        label: 'View Holographic Memory',
        subtitle: 'Inspect agent knowledge and facts',
        icon: <IconMemory size="sm" color="secondary" />,
        onExecute: () => {
          onAction('memory');
          onClose();
        },
      },
      {
        id: 'action-ops',
        category: 'Actions',
        label: 'System Operations & Services',
        subtitle: 'Health and running services',
        icon: <IconOps size="sm" color="secondary" />,
        onExecute: () => {
          onAction('ops');
          onClose();
        },
      },
      {
        id: 'action-cost',
        category: 'Actions',
        label: 'Cost & Spend Ledger',
        subtitle: 'Model token usage and burn rates',
        icon: <IconCost size="sm" color="secondary" />,
        onExecute: () => {
          onAction('cost');
          onClose();
        },
      },
      {
        id: 'action-governance',
        category: 'Actions',
        label: 'Governance & Audit Ledger',
        subtitle: 'Inspect immutable OKF decisions',
        icon: <IconGovernance size="sm" color="secondary" />,
        onExecute: () => {
          onAction('governance');
          onClose();
        },
      },
    );

    return list;
  }, [bots, groups, sessions, onSelectBot, onSelectGroup, onSelectSession, onAction, onClose]);

  const filteredItems = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter(
      item =>
        item.label.toLowerCase().includes(q) ||
        (item.subtitle && item.subtitle.toLowerCase().includes(q)) ||
        item.category.toLowerCase().includes(q),
    );
  }, [items, query]);

  useEffect(() => {
    if (!isOpen) return;
    function onGlobalKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.repeat) {
        return;
      }
      if (!/^[1-9]$/.test(event.key)) return;
      const index = Number(event.key) - 1;
      const target = filteredItems[index];
      if (!target) return;
      event.preventDefault();
      target.onExecute();
    }
    window.addEventListener('keydown', onGlobalKeyDown);
    return () => window.removeEventListener('keydown', onGlobalKeyDown);
  }, [filteredItems, isOpen]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % Math.max(1, filteredItems.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(
        prev => (prev - 1 + filteredItems.length) % Math.max(1, filteredItems.length),
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredItems[selectedIndex]) {
        filteredItems[selectedIndex].onExecute();
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <Dialog
      isOpen
      onOpenChange={open => !open && onClose()}
      purpose="info"
    >
      <VStack gap={3} padding={3} style={{maxHeight: '75vh'}}>

        <HStack gap={2} vAlign="center" paddingInline={2}>
          <IconSearch size="md" color="secondary" />
          <TextInput
            label="Command search"
            isLabelHidden
            placeholder="Search Bots, Group Chats, Sessions, or Actions… (Cmd+K)"
            value={query}
            onChange={val => {
              setQuery(val);
              setSelectedIndex(0);
            }}
            size="lg"
            onKeyDown={onKeyDown}
            width="100%"
          />
        </HStack>

        <Divider />

        <VStack gap={2} style={{flex: 1, minHeight: 0, overflowY: 'auto'}}>
          <List density="compact">
            {filteredItems.map((item, idx) => (
              <ListItem
                key={item.id}
                label={item.label}
                isSelected={idx === selectedIndex}
                onClick={item.onExecute}
                startContent={item.icon}
                description={
                  item.subtitle ? (
                    <Text type="supporting" size="xsm" color="secondary">
                      {item.subtitle}
                    </Text>
                  ) : undefined
                }
                endContent={
                  <HStack gap={1} vAlign="center">
                    <Badge label={item.category} variant="neutral" />
                    {idx < 9 ? (
                      <span className="rk-kbd-shortcut">
                        {modKey}{idx + 1}
                      </span>
                    ) : null}
                  </HStack>
                }
              />
            ))}
          </List>
          {filteredItems.length === 0 ? (
            <HStack padding={4} justify="center">
              <Text type="supporting" color="secondary">
                No matching results found.
              </Text>
            </HStack>
          ) : null}
        </VStack>
      </VStack>
    </Dialog>
  );
}
