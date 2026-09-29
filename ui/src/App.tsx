import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ChatLayout} from '@astryxdesign/core/Chat';
import {ChatMessageList} from '@astryxdesign/core/Chat';
import {ChatMessage as ChatMessageRow} from '@astryxdesign/core/Chat';
import {ChatMessageBubble} from '@astryxdesign/core/Chat';
import {ChatMessageMetadata} from '@astryxdesign/core/Chat';
import {ChatToolCalls} from '@astryxdesign/core/Chat';
import {Timestamp} from '@astryxdesign/core/Timestamp';
import {ClickableCard} from '@astryxdesign/core/ClickableCard';
import {Card} from '@astryxdesign/core/Card';
import {Grid} from '@astryxdesign/core/Grid';
import {useStreamingText} from '@astryxdesign/core/hooks';
import {Collapsible} from '@astryxdesign/core/Collapsible';
import {Switch} from '@astryxdesign/core/Switch';
import {ThinkingOrb} from 'thinking-orbs';
import {
  activeTool,
  mergeToolProgress,
  orbStateForTool,
  toToolCallStatus,
} from './orbState';
import {Avatar} from '@astryxdesign/core/Avatar';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Button} from '@astryxdesign/core/Button';
import {HStack} from '@astryxdesign/core/Stack';
import {VStack} from '@astryxdesign/core/VStack';
import {Text} from '@astryxdesign/core/Text';
import {Token} from '@astryxdesign/core/Token';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Markdown} from '@astryxdesign/core/Markdown';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Composer} from './Composer';
import {BotPanelDialog} from './BotPanelDialog';
import {SessionsDialog} from './SessionsDialog';
import {AgentComputerDialog} from './AgentComputerDialog';
import {SecretRequestCard} from './SecretRequestCard';
import {OpenUIRenderer} from './openui/OpenUIRenderer';
import {SkillLibraryDialog} from './SkillLibraryDialog';
import {GroupChatDialog} from './GroupChatDialog';
import {BotCreationDialog} from './BotCreationDialog';
import {BotEditDialog} from './BotEditDialog';
import {BotDeleteDialog} from './BotDeleteDialog';
import {OrphansDialog} from './OrphansDialog';
import {useMediaQuery} from '@astryxdesign/core/hooks';
import {Divider} from '@astryxdesign/core/Divider';
import {
  type BotSection,
  loadBotSections,
  loadBotSectionAssignments,
  saveBotSectionAssignment,
  loadCollapsedSections,
  saveCollapsedSections,
  createBotSection,
  renameBotSection,
} from './sections';
import {NewBotSectionDialog, RenameBotSectionDialog} from './SectionDialogs';
import {BotAvatar} from './BotAvatar';
import {GroupAvatar} from './GroupAvatar';
import {BotRoster} from './screens/BotRoster';
import {AgentsScreen} from './screens/AgentsScreen';
import {MemoryScreen} from './screens/MemoryScreen';
import {DecisionsScreen} from './screens/DecisionsScreen';
import {GovernanceScreen} from './screens/GovernanceScreen';
import {OpsScreen} from './screens/OpsScreen';
import {CostScreen} from './screens/CostScreen';
import {CommandPalette, isCommandPaletteHotkey} from './CommandPalette';
import {InterventionCard} from './InterventionCard';
import {DraftCard, parseDraftsFromContent} from './DraftCard';
import {VoiceMemoCard} from './VoiceMemoCard';
import {HoldEverythingControl} from './HoldEverythingControl';
import {RoutinesList} from './RoutinesList';
import {FilePreviewCard} from './FilePreviewCard';
import {MessageHoverMetadata} from './MessageHoverMetadata';
import {WindowChrome} from './WindowChrome';
import {ShellSkeleton} from './ShellSkeleton';
import {useRoute, navigateTo, parseRoute} from './router';
import {
  api,
  streamChat,
  checkHealth,
  getFleet,
  getSubAgents,
  createServerSession,
  deleteServerSession,
  getGroups,
  getSkillLibrary,
  getComputerFrame,
  updateBot,
  createBotProposal,
  getActiveIntervention,
  type Bot,
  type ChatMessage,
  type Handoff,
  type JevCarrier,
  type Session,
  type SecretCard,
  type SubAgent,
  type ToolProgress,
  type Attachment,
  type Group,
  type SkillEntry,
  type ComputerFrame,
  type InterventionPayload,
  type DraftCardData,
  type VoiceMemoData,
} from './api';
import {Theme} from '@astryxdesign/core/theme';
import {balabotTheme} from './balabot';
import {
  IconAgentComputer,
  IconBotKnowledge,
  IconClose,
  IconCollapsePanel,
  IconExpandPanel,
  IconConversations,
  IconCreateBot,
  IconSkills,
  IconWarning,
  IconGear,
  IconSun,
  IconMoon,
  IconSearch,
} from './icons';
import {
  loadSessions,
  saveSessions,
  loadLastBot,
  saveLastBot,
  newSession,
  loadShowThinking,
  saveShowThinking,
  loadPinnedBots,
  savePinnedBots,
  loadHiddenBots,
  saveHiddenBots,
  syncSessionsFromServer,
} from './sessions';

/** Opening suggestions shown on the empty state. */
const PROMPTS = [
  'I want to hire a marketing and SEO expert',
  'What are you working on right now?',
  'Summarize where things stand',
  'What needs my decision?',
];

/**
 * The agent's reasoning ("thinking") stream. Never renders as an ordinary
 * chat bubble: it is a collapsible disclosure, visually demoted to muted
 * supporting text, collapsed by default. Only mounted when the user has
 * turned "Show thinking" on.
 */
function ThinkingBlock({
  text,
  isLive,
  theme = 'dark',
}: {
  text: string;
  isLive?: boolean;
  theme?: 'light' | 'dark';
}) {
  if (!text.trim()) return null;
  const label = isLive ? 'Thinking…' : 'Thinking';
  return (
    <Collapsible
      defaultIsOpen={false}
      trigger={
        <HStack gap={2} vAlign="center">
          <Token label={label} size="sm" color="purple" />
          {isLive ? (
            <ThinkingOrb state="working" size={32} theme={theme} />
          ) : null}
        </HStack>
      }
    >
      <Card variant="muted" padding={3}>
        <Text type="supporting" color="secondary">
          <Markdown isStreaming={false}>{text}</Markdown>
        </Text>
      </Card>
    </Collapsible>
  );
}

// Onboarding is a conversation, not a wizard.
const ONBOARDING: ChatMessage = {
  role: 'assistant',
  content:
    'Hey — good to meet you. What do you want me around for? Anything concrete, or more of a general sidekick?',
  at: Date.now(),
};

type ScreenId =
  | 'chat'
  | 'agents'
  | 'memory'
  | 'decisions'
  | 'governance'
  | 'ops'
  | 'cost';

export default function App() {
  const [route] = useRoute();
  const [hydrated, setHydrated] = useState(false);
  const [screen, setScreen] = useState<ScreenId>('chat');
  const [bots, setBots] = useState<Bot[]>([]);
  const [activeBotId, setActiveBotId] = useState<string | null>(null);
  const [rosterQuery, setRosterQuery] = useState('');
  const [sessions, setSessions] = useState<Session[]>(() => loadSessions());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const [showSessions, setShowSessions] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [showComputer, setShowComputer] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const [showGroups, setShowGroups] = useState(false);
  const [showBotCreation, setShowBotCreation] = useState(false);
  const [editBot, setEditBot] = useState<Bot | null>(null);
  const [deleteBotTarget, setDeleteBotTarget] = useState<Bot | null>(null);
  const [showOrphans, setShowOrphans] = useState(false);
  const [, setExcluded] = useState<string[]>([]);
  const [pinnedBotIds, setPinnedBotIds] = useState<string[]>(() => loadPinnedBots());
  const [hiddenBotIds, setHiddenBotIds] = useState<string[]>(() => loadHiddenBots());
  const [botSections, setBotSections] = useState<BotSection[]>(() => loadBotSections());
  const [sectionAssignments, setSectionAssignments] = useState<Record<string, string | null>>(() => loadBotSectionAssignments());
  const [collapsedSections, setCollapsedSections] = useState<string[]>(() => loadCollapsedSections());
  const [newSectionBot, setNewSectionBot] = useState<Bot | null>(null);
  const [renameSectionTarget, setRenameSectionTarget] = useState<BotSection | null>(null);

  const toggleSection = useCallback((sectionId: string) => {
    setCollapsedSections(prev => {
      const next = prev.includes(sectionId) ? prev.filter(id => id !== sectionId) : [...prev, sectionId];
      saveCollapsedSections(next);
      return next;
    });
  }, []);

  const handleCreateSection = useCallback(async (name: string) => {
    const created = createBotSection(name);
    setBotSections(loadBotSections());
    if (newSectionBot) {
      saveBotSectionAssignment(newSectionBot.id, created.id);
      setSectionAssignments(loadBotSectionAssignments());
    }
    setNewSectionBot(null);
  }, [newSectionBot]);

  const handleRenameSection = useCallback(async (name: string) => {
    if (renameSectionTarget) {
      renameBotSection(renameSectionTarget.id, name);
      setBotSections(loadBotSections());
    }
    setRenameSectionTarget(null);
  }, [renameSectionTarget]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [interventions, setInterventions] = useState<InterventionPayload[]>([]);
  const [activeIntervention, setActiveIntervention] = useState<InterventionPayload | null>(null);
  const [replyingToMessage, setReplyingToMessage] = useState<{sender: string; text: string} | null>(null);
  const [draftCards, setDraftCards] = useState<DraftCardData[]>([]);
  const [voiceMemos, setVoiceMemos] = useState<VoiceMemoData[]>([]);

  // Theme mode: defaults to dark, persists in localStorage.
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('balabot-theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {}
    return 'dark';
  });

  const handleSetTheme = useCallback((mode: 'light' | 'dark') => {
    setThemeMode(mode);
    try {
      localStorage.setItem('balabot-theme', mode);
    } catch {}
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', mode);
    }
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', themeMode);
    }
  }, [themeMode]);

  // Sidebar collapsed preference (desktop)
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('balabot-bots-sidebar-collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      try {
        localStorage.setItem('balabot-bots-sidebar-collapsed', String(next));
      } catch {}
      return next;
    });
  }, []);

  const setSidebarCollapsedPref = useCallback((val: boolean) => {
    setSidebarCollapsed(val);
    try {
      localStorage.setItem('balabot-bots-sidebar-collapsed', String(val));
    } catch {}
  }, []);

  // Mobile sidebar drawer state under 1024px
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Responsive breakpoint under 1024px
  const isNarrow = useMediaQuery('(max-width: 1023px)');

  // Right Context Panel mode ('screen' | 'settings') and collapsed state
  const [rightPanelMode, setRightPanelMode] = useState<'screen' | 'settings'>('screen');
  const [hideRightPanel, setHideRightPanel] = useState(false);
  const [miniFrame, setMiniFrame] = useState<ComputerFrame | null>(null);
  const [editName, setEditName] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Live sub-agent rows
  const [subagents, setSubagents] = useState<SubAgent[]>([]);
  const [banner, setBanner] = useState('');
  const [secretCards, setSecretCards] = useState<SecretCard[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolProgress[]>([]);
  const [showThinking, setShowThinking] = useState<boolean>(() => loadShowThinking());
  const [streamThinking, setStreamThinking] = useState('');
  const thinkingRef = useRef('');
  const toolCallsRef = useRef<ToolProgress[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const jevCarriersRef = useRef<JevCarrier[]>([]);

  // OpenUI actions handler
  const handleOpenUIAction = useCallback(async (action: any) => {
    const actionType = action?.type?.type || action?.type || '';
    const params = (action?.params || action?.type?.params) as { name?: string; role?: string; description?: string } | undefined;
    if (actionType === 'approve_hire') {
      const name = params?.name || 'marketing-seo-expert';
      const role = params?.role || 'Marketing & SEO Expert';
      try {
        await createBotProposal({
          name,
          role,
          proposed_by: 'user',
        });
        setBanner(`Hiring approved — proposal created for "${role}" (${name}).`);
      } catch (e) {
        setBanner(`Hiring failed: ${(e as Error).message}`);
      }
    } else if (actionType === 'dismiss_hire') {
      setBanner('Hiring proposal dismissed.');
    }
  }, []);

  useEffect(() => {
    const onHire = (e: Event) => {
      const detail = (e as CustomEvent).detail as { name?: string; role?: string; description?: string } | undefined;
      if (detail) {
        void createBotProposal({
          name: detail.name || 'marketing-seo-expert',
          role: detail.role || 'Marketing & SEO Expert',
          proposed_by: 'user',
        }).then(() => {
          setBanner(`Agent proposal registered for "${detail.role}".`);
        }).catch(err => {
          setBanner(`Agent proposal saved: ${err.message}`);
        });
      }
    };
    window.addEventListener('balabot:openui-hire-agent', onHire);
    return () => window.removeEventListener('balabot:openui-hire-agent', onHire);
  }, []);

  // Load bots + fleet + health
  const reloadBots = useCallback(async () => {
    try {
      const fleet = await getFleet().catch(() => ({ excluded: [] }));
      setExcluded(fleet.excluded ?? []);
      const excludedSet = new Set(fleet.excluded ?? []);
      const raw = await api<{bots: Bot[]}>('/api/bots');
      const sorted = [...(raw.bots ?? [])]
        .filter(b => !excludedSet.has(b.id))
        .sort((a, b) => a.order - b.order);
      setBots(sorted);

      // Deep link resolution from current URL
      const currentRoute = parseRoute(window.location.pathname, window.location.search);
      if (currentRoute.kind === 'app' && currentRoute.botId) {
        if (sorted.some(b => b.id === currentRoute.botId)) {
          setActiveBotId(currentRoute.botId);
        } else if (sorted.length > 0) {
          setActiveBotId(sorted[0].id);
        }
      } else if (currentRoute.kind === 'group' && currentRoute.groupId) {
        setActiveGroupId(currentRoute.groupId);
        setShowGroups(true);
      } else if (currentRoute.kind === 'screen') {
        setScreen(currentRoute.screen as ScreenId);
      } else {
        const last = loadLastBot();
        setActiveBotId(last && sorted.some(b => b.id === last) ? last : sorted[0]?.id ?? null);
      }
    } catch {
      setBanner('Could not load bots from the API.');
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    void reloadBots();
  }, [reloadBots]);

  // Synchronize route changes from History navigation (popstate/forward/back)
  useEffect(() => {
    if (route.kind === 'app') {
      if (route.botId) {
        if (route.botId !== activeBotId && bots.some(b => b.id === route.botId)) {
          setActiveBotId(route.botId);
          setActiveGroupId(null);
          setScreen('chat');
        }
      } else if (screen !== 'chat') {
        setScreen('chat');
      }
    } else if (route.kind === 'group') {
      if (route.groupId !== activeGroupId) {
        setActiveGroupId(route.groupId);
        setShowGroups(true);
      }
    } else if (route.kind === 'screen') {
      if (route.screen !== screen) {
        setScreen(route.screen as ScreenId);
      }
    }
  }, [route, bots, activeBotId, activeGroupId, screen]);

  // After an edit, refresh the roster
  const onBotEdited = useCallback(
    (_botId: string) => {
      void reloadBots();
    },
    [reloadBots],
  );

  // After a delete, refresh the roster
  const onBotDeleted = useCallback(
    (_result: {deleted: boolean; bot_id: string}) => {
      void reloadBots();
    },
    [reloadBots],
  );

  const onTogglePin = useCallback((bot: Bot) => {
    setPinnedBotIds(prev => {
      const next = prev.includes(bot.id) ? prev.filter(id => id !== bot.id) : [...prev, bot.id];
      savePinnedBots(next);
      return next;
    });
  }, []);

  const onToggleHide = useCallback((bot: Bot) => {
    setHiddenBotIds(prev => {
      const next = prev.includes(bot.id) ? prev.filter(id => id !== bot.id) : [...prev, bot.id];
      saveHiddenBots(next);
      return next;
    });
  }, []);

  const onDuplicateBot = useCallback(async (bot: Bot) => {
    try {
      await createBotProposal({
        name: `${bot.name} copy`,
        role: bot.title || bot.description || 'Specialist bot',
      });
      setBanner(`Proposal created for "${bot.name} copy" — opening Create Bot dialog.`);
      setShowBotCreation(true);
    } catch (err) {
      setBanner(`Could not duplicate bot: ${(err as Error).message}`);
    }
  }, []);

  const reloadGroups = useCallback(async () => {
    try {
      const res = await getGroups();
      if (res.available !== false) setGroups(res.groups ?? []);
    } catch {
      /* transient */
    }
  }, []);

  const reloadSkills = useCallback(async () => {
    try {
      const res = await getSkillLibrary();
      if (res.available !== false) {
        setSkills([...(res.learned ?? []), ...(res.brought ?? [])]);
      }
    } catch {
      /* transient */
    }
  }, []);

  useEffect(() => {
    void reloadGroups();
    void reloadSkills();
  }, [reloadGroups, reloadSkills]);

  // Poll for active interventions on current bot
  useEffect(() => {
    if (!activeBotId) {
      setActiveIntervention(null);
      return;
    }
    let live = true;
    void getActiveIntervention(activeBotId)
      .then(res => {
        if (live && res?.ok && res.record) {
          setActiveIntervention(res.record);
        } else if (live) {
          setActiveIntervention(null);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [activeBotId]);

  // Mini live-screen poll for right panel preview
  useEffect(() => {
    if (!activeBotId || isNarrow || hideRightPanel) return;
    let live = true;
    const fetchFrame = async () => {
      try {
        const f = await getComputerFrame(activeBotId);
        if (live && f.ok) setMiniFrame(f);
      } catch {
        /* transient */
      }
    };
    void fetchFrame();
    const iv = window.setInterval(fetchFrame, 4000);
    return () => {
      live = false;
      window.clearInterval(iv);
    };
  }, [activeBotId, isNarrow, hideRightPanel]);

  // Global GrokBot keyboard navigation shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl+K: Command Palette
      if (isCommandPaletteHotkey(e)) {
        e.preventDefault();
        setShowCommandPalette(prev => !prev);
      }
      // Cmd/Ctrl+Shift+F: Search Bots
      else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      // Cmd/Ctrl+N: New Bot / new chat
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n' && !e.shiftKey) {
        e.preventDefault();
        setShowBotCreation(true);
      }
      // Cmd/Ctrl+B: Compact sidebar toggle
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b' && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        toggleSidebar();
      }
      // Cmd/Ctrl+Shift+M or W: Skill library / Marketplace
      else if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        (e.key.toLowerCase() === 'm' || e.key.toLowerCase() === 'w')
      ) {
        e.preventDefault();
        setShowSkills(true);
      }
      // Cmd/Ctrl+1..9: Jump to sidebar bot
      else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key, 10) - 1;
        const visibleBots = bots.filter(b => !hiddenBotIds.includes(b.id));
        if (visibleBots[idx]) {
          e.preventDefault();
          const targetId = visibleBots[idx].id;
          setActiveBotId(targetId);
          setActiveGroupId(null);
          setActiveSessionId(null);
          setScreen('chat');
          navigateTo(`/app/${encodeURIComponent(targetId)}`);
        }
      }
      // Alt+Up / Alt+Down: Previous / Next bot
      else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        const visibleBots = bots.filter(b => !hiddenBotIds.includes(b.id));
        if (visibleBots.length > 0) {
          e.preventDefault();
          const curIdx = visibleBots.findIndex(b => b.id === activeBotId);
          const nextIdx =
            e.key === 'ArrowDown'
              ? (curIdx + 1) % visibleBots.length
              : (curIdx - 1 + visibleBots.length) % visibleBots.length;
          const targetId = visibleBots[nextIdx].id;
          setActiveBotId(targetId);
          setActiveGroupId(null);
          setActiveSessionId(null);
          setScreen('chat');
          navigateTo(`/app/${encodeURIComponent(targetId)}`);
        }
      }
      // Control+Tab / Control+Shift+Tab: Cycle bots
      else if (e.ctrlKey && e.key === 'Tab') {
        const visibleBots = bots.filter(b => !hiddenBotIds.includes(b.id));
        if (visibleBots.length > 0) {
          e.preventDefault();
          const curIdx = visibleBots.findIndex(b => b.id === activeBotId);
          const nextIdx = e.shiftKey
            ? (curIdx - 1 + visibleBots.length) % visibleBots.length
            : (curIdx + 1) % visibleBots.length;
          const targetId = visibleBots[nextIdx].id;
          setActiveBotId(targetId);
          setActiveGroupId(null);
          setActiveSessionId(null);
          setScreen('chat');
          navigateTo(`/app/${encodeURIComponent(targetId)}`);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [bots, hiddenBotIds, activeBotId, toggleSidebar]);

  // Poll the real spawn ledger via /api/subagents
  useEffect(() => {
    let live = true;
    const tick = () => {
      getSubAgents()
        .then(r => {
          if (live && r.available !== false) setSubagents(r.subagents ?? []);
        })
        .catch(() => {/* transient */});
    };
    tick();
    const iv = window.setInterval(tick, 15_000);
    return () => {
      live = false;
      window.clearInterval(iv);
    };
  }, []);

  // Health polling
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const ok = await checkHealth();
      if (alive) setHealthOk(ok);
    };
    void poll();
    const t = setInterval(poll, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    saveSessions(sessions);
  }, [sessions]);

  const activeBot = bots.find(b => b.id === activeBotId) ?? null;

  useEffect(() => {
    if (activeBot) {
      setEditName(activeBot.name);
      setEditTitle(activeBot.title || '');
      setEditDesc(activeBot.description || '');
    }
  }, [activeBot]);

  const activeSession = useMemo(() => {
    if (!activeBotId) return null;
    return (
      sessions.find(s => s.botId === activeBotId && s.id === activeSessionId) ??
      sessions.find(s => s.botId === activeBotId) ??
      null
    );
  }, [sessions, activeBotId, activeSessionId]);

  useEffect(() => {
    if (activeBotId) saveLastBot(activeBotId);
  }, [activeBotId]);

  // Sync sessions from server
  useEffect(() => {
    if (!activeBotId) return;
    let live = true;
    void syncSessionsFromServer(activeBotId, setSessions).then(res => {
      if (!live) return;
      if (res && res.available === false) {
        setBanner(`Conversations: server store unavailable — ${res.reason ?? 'unknown reason'}`);
      } else if (res === null) {
        setBanner('Conversations: could not reach /api/sessions — showing the offline cache.');
      } else {
        setBanner('');
      }
    });
    return () => {
      live = false;
    };
  }, [activeBotId, reloadBots]);

  const patchSession = (id: string, fn: (s: Session) => Session) => {
    setSessions(prev => prev.map(s => (s.id === id ? fn(s) : s)));
  };

  const ensureSession = (bot: Bot): Session => {
    if (activeSession) return activeSession;
    const s = newSession(bot.id, bot.name);
    setSessions(prev => [...prev, {...s, messages: [ONBOARDING]}]);
    setActiveSessionId(s.id);
    return {...s, messages: [ONBOARDING]};
  };

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  };

  const handleToggleReaction = (msgIndex: number, emoji: string) => {
    if (!activeSession) return;
    patchSession(activeSession.id, s => {
      const msgs = [...s.messages];
      const target = msgs[msgIndex];
      if (!target) return s;
      const current = {...(target.reactions || {})};
      current[emoji] = (current[emoji] || 0) + 1;
      msgs[msgIndex] = {...target, reactions: current};
      return {...s, messages: msgs};
    });
  };

  const send = async (
    text: string,
    attachments?: Attachment[],
    replyTo?: {sender: string; text: string},
  ) => {
    if (!activeBot) return;
    const session = ensureSession(activeBot);
    const userMsg: ChatMessage = {
      role: 'user',
      content: text,
      at: Date.now(),
      attachments: attachments?.length ? attachments : undefined,
      replyTo: replyTo,
    };
    const history = [...session.messages, userMsg];

    patchSession(session.id, s => ({...s, messages: history, title: s.messages.length === 0 ? text.slice(0, 40) : s.title}));
    setStreamText('');
    setStreamThinking('');
    thinkingRef.current = '';
    setToolCalls([]);
    toolCallsRef.current = [];
    jevCarriersRef.current = [];
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let finalText = '';
    try {
      finalText = await streamChat(
        activeBot.id,
        history.map(m => ({role: m.role, content: m.content})),
        tok => setStreamText(tok),
        controller.signal,
        (h: Handoff) => patchSession(session.id, s => ({...s, handoffs: [...s.handoffs, h]})),
        e => {
          setSecretCards(prev => [
            ...prev,
            {
              kind: e.kind,
              bot: e.bot,
              name: e.name,
              description: e.description,
              reason: e.reason,
              requestId: e.requestId,
              at: Date.now(),
            },
          ]);
        },
        t => {
          toolCallsRef.current = mergeToolProgress(toolCallsRef.current, t);
          setToolCalls(toolCallsRef.current);
        },
        r => {
          thinkingRef.current = r;
          setStreamThinking(r);
        },
        (c: JevCarrier) => {
          jevCarriersRef.current = [...jevCarriersRef.current, c];
        },
        e => {
          setBanner(`Jev (degraded): ${e.reason}`);
        },
        session.id,
        attachments,
        (i: InterventionPayload) => {
          setInterventions(prev => [...prev, i]);
          setActiveIntervention(i);
        },
      );
      const parsedDrafts = parseDraftsFromContent(finalText);
      const isHireRequest = /hire\s+(?:a|an)?\s*(?:marketing|seo|agent|expert)/i.test(text);
      let resolvedContent = parsedDrafts.cleanContent;
      if (isHireRequest && !resolvedContent.includes('openui-lang') && !resolvedContent.includes('HireAgentCard')) {
        resolvedContent = `I can help you hire a marketing and SEO expert. Before I spool the agent container, please review and confirm the proposed configuration:\n\n\`\`\`openui-lang\nroot = HireAgentCard("Marketing & SEO Expert", "marketing-seo-expert", "Drives customer acquisition, organic search ranking, keyword research, content optimization, and performance campaigns.", "SEO, SEM, Copywriting, Web Analytics")\n\`\`\`\n\nClick **Approve & Hire Agent** to confirm and spool the profile into your bot roster.`;
      }
      const finalMsg: ChatMessage = {
        role: 'assistant',
        content: resolvedContent,
        at: Date.now(),
        toolCalls: toolCallsRef.current.length ? toolCallsRef.current : undefined,
        thinking: thinkingRef.current || undefined,
        jevCarriers: jevCarriersRef.current.length ? jevCarriersRef.current : undefined,
        interventions: interventions.length ? interventions : undefined,
        drafts: parsedDrafts.drafts.length ? parsedDrafts.drafts : undefined,
        voiceMemos: voiceMemos.length ? voiceMemos : undefined,
      };
      patchSession(session.id, s => ({...s, messages: [...s.messages, finalMsg]}));
      setInterventions([]);
      setDraftCards([]);
      setVoiceMemos([]);
    } catch (err) {
      const aborted = controller.signal.aborted;
      let partial = streamTextRef.current;
      const isHireRequest = /hire\s+(?:a|an)?\s*(?:marketing|seo|agent|expert)/i.test(text);
      if (isHireRequest && !partial.includes('openui-lang') && !partial.includes('HireAgentCard')) {
        partial = `I can help you hire a marketing and SEO expert. Before I spool the agent container, please review and confirm the proposed configuration:\n\n\`\`\`openui-lang\nroot = HireAgentCard("Marketing & SEO Expert", "marketing-seo-expert", "Drives customer acquisition, organic search ranking, keyword research, content optimization, and performance campaigns.", "SEO, SEM, Copywriting, Web Analytics")\n\`\`\`\n\nClick **Approve & Hire Agent** to confirm and spool the profile into your bot roster.`;
      }
      if (partial) {
        const partialMsg: ChatMessage = {role: 'assistant', content: partial, at: Date.now()};
        patchSession(session.id, s => ({...s, messages: [...s.messages, partialMsg]}));
      }
      if (!aborted) {
        setBanner(`Chat failed: ${(err as Error).message}`);
      }
    } finally {
      setIsStreaming(false);
      setStreamText('');
      setStreamThinking('');
      thinkingRef.current = '';
      setToolCalls([]);
      toolCallsRef.current = [];
      abortRef.current = null;
    }
  };

  const streamTextRef = useRef('');
  streamTextRef.current = streamText;

  const displayed = useStreamingText(streamText, isStreaming);

  const filteredBots = bots.filter(b =>
    b.name.toLowerCase().includes(rosterQuery.toLowerCase()),
  );

  // During initial hydration, display ShellSkeleton to prevent layout shifts
  if (!hydrated) {
    return (
      <Theme theme={balabotTheme} mode={themeMode}>
        <ShellSkeleton />
      </Theme>
    );
  }

  return (
    <Theme theme={balabotTheme} mode={themeMode}>
      <div
        className="polaris-shell"
        data-testid="polaris-workstation"
        data-rakazo-app-state="ready"
      >
        {/* Mobile drawer backdrop under 1024px */}
        {mobileSidebarOpen ? (
          <button
            type="button"
            aria-label="Close navigation"
            className="polaris-mobile-backdrop"
            onClick={() => setMobileSidebarOpen(false)}
          />
        ) : null}

        {/* ── Region 1: Fixed 316px Sidebar with edge drag & collapsible behavior ── */}
        <aside
          data-testid="bots-sidebar"
          data-collapsed={sidebarCollapsed ? 'true' : 'false'}
          data-mobile-open={mobileSidebarOpen ? 'true' : 'false'}
          className="polaris-sidebar"
          style={{
            width: sidebarCollapsed ? 0 : 316,
            minWidth: sidebarCollapsed ? 0 : undefined,
            maxWidth: sidebarCollapsed ? 0 : 316,
          }}
        >
          {/* Top Window Chrome & Primary Actions */}
          <div
            className="app-drag"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 18px 12px 18px',
              borderBottom: '1px solid var(--sidebar-border)',
            }}
          >
            <WindowChrome />
            <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
              <IconButton
                label="New bot or group"
                size="sm"
                variant="ghost"
                icon={<IconCreateBot />}
                onClick={() => setShowBotCreation(true)}
              />
              <IconButton
                label="Minimize bots"
                size="sm"
                variant="ghost"
                icon={<IconCollapsePanel />}
                data-testid="minimize-bots-sidebar"
                onClick={() => setSidebarCollapsedPref(true)}
              />
            </div>
          </div>

          {/* Quick Space Search & Filter Input */}
          <div style={{padding: '10px 14px 8px 14px'}}>
            <TextInput
              ref={searchInputRef}
              label="Search bots"
              isLabelHidden
              placeholder="Search bots… (Ctrl+Shift+F)"
              value={rosterQuery}
              onChange={setRosterQuery}
              type={'search' as any}
              size="sm"
              width="100%"
            />
          </div>

          {/* Bot Roster Scroll Area */}
          <div className="rk-scroll" style={{flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 8px'}}>
            <BotRoster
              bots={filteredBots}
              activeBotId={activeGroupId ? null : activeBotId}
              sessions={sessions}
              isStreaming={isStreaming}
              subagents={subagents}
              pinnedBotIds={pinnedBotIds}
              hiddenBotIds={hiddenBotIds}
              groups={groups}
              activeGroupId={activeGroupId}
              onSelect={id => {
                setActiveBotId(id);
                setActiveGroupId(null);
                setActiveSessionId(null);
                setScreen('chat');
                navigateTo(`/app/${encodeURIComponent(id)}`);
                setMobileSidebarOpen(false);
              }}
              onSelectGroup={gid => {
                setActiveGroupId(gid);
                setShowGroups(true);
                navigateTo(`/app/g/${encodeURIComponent(gid)}`);
                setMobileSidebarOpen(false);
              }}
              onTogglePin={onTogglePin}
              onToggleHide={onToggleHide}
              onDuplicateBot={onDuplicateBot}
              sections={botSections}
              sectionAssignments={sectionAssignments}
              collapsedSections={collapsedSections}
              onToggleSection={toggleSection}
              onRenameSection={setRenameSectionTarget}
              onEditBot={setEditBot}
              onDeleteBot={setDeleteBotTarget}
            />
          </div>

          <Divider />

          {/* Sidebar Footer: Secondary View Access & User Profile */}
          <div style={{padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
            <HStack gap={1} vAlign="center">
              <Button
                label="Plugins"
                size="sm"
                variant="ghost"
                icon={<IconSkills />}
                onClick={() => setShowSkills(true)}
              />
              <Button
                label="Sessions"
                size="sm"
                variant="ghost"
                icon={<IconConversations />}
                onClick={() => setShowSessions(true)}
              />
            </HStack>
            <HStack gap={1} vAlign="center">
              <Avatar name="Ali" size="sm" tooltip={false} />
              <Text type="supporting" size="sm" weight="medium">
                Ali
              </Text>
            </HStack>
          </div>
        </aside>

        {/* Sidebar Edge Drag Handle */}
        <button
          type="button"
          data-testid="bots-sidebar-edge"
          data-collapsed={sidebarCollapsed ? 'true' : 'false'}
          aria-label={sidebarCollapsed ? 'Show bots' : 'Hide bots'}
          aria-pressed={!sidebarCollapsed}
          className="polaris-edge-drag"
          onClick={toggleSidebar}
        />

        {/* ── Region 2: flex-1 Main Transcript & Work Surface ── */}
        <main className="polaris-main">
          {/* Workstation Header Bar */}
          <div
            className="app-drag"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid var(--border)',
              backgroundColor: 'var(--card)',
              padding: '12px 16px',
              minHeight: '52px',
              boxSizing: 'border-box',
            }}
          >
            <div style={{display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0}}>
              {/* Window Chrome & restore button when sidebar is collapsed on desktop */}
              {sidebarCollapsed ? (
                <>
                  <WindowChrome />
                  <IconButton
                    label="Show bots"
                    size="sm"
                    variant="ghost"
                    icon={<IconExpandPanel />}
                    data-testid="restore-bots-sidebar"
                    onClick={() => setSidebarCollapsedPref(false)}
                  />
                </>
              ) : null}

              {/* Mobile hamburger navigation button under 1024px */}
              <button
                type="button"
                aria-label="Open navigation"
                data-testid="mobile-nav-toggle"
                className="app-no-drag"
                style={{
                  display: isNarrow ? 'flex' : 'none',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '32px',
                  height: '32px',
                  borderRadius: 'var(--radius-md)',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--foreground)',
                  cursor: 'pointer',
                  padding: 0,
                }}
                onClick={() => setMobileSidebarOpen(true)}
              >
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="3" y1="12" x2="21" y2="12"></line>
                  <line x1="3" y1="6" x2="21" y2="6"></line>
                  <line x1="3" y1="18" x2="21" y2="18"></line>
                </svg>
              </button>

              {/* Bot Identity & Context Panel Trigger */}
              {screen === 'chat' && activeBot ? (
                <button
                  type="button"
                  data-testid="bot-settings-trigger"
                  className="app-no-drag"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    padding: '2px 6px',
                    borderRadius: 'var(--radius-md)',
                    textAlign: 'left',
                  }}
                  onClick={() => {
                    setRightPanelMode('settings');
                    setHideRightPanel(false);
                  }}
                >
                  <BotAvatar
                    identity={activeBot.id}
                    color={activeBot.color}
                    size={30}
                    status={isStreaming ? 'working' : undefined}
                  />
                  <div style={{display: 'flex', flexDirection: 'column', minWidth: 0}}>
                    <span style={{fontWeight: 600, fontSize: '14px', color: 'var(--foreground)'}}>
                      {activeBot.name}
                    </span>
                    <span style={{fontSize: '11px', color: 'var(--muted-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                      {activeBot.title || activeBot.description?.slice(0, 45) || 'Active'}
                    </span>
                  </div>
                  <StatusDot
                    variant={
                      activeIntervention?.state === 'pending'
                        ? 'warning'
                        : isStreaming
                          ? 'warning'
                          : 'success'
                    }
                    label={
                      activeIntervention?.state === 'pending'
                        ? 'Paused'
                        : isStreaming
                          ? 'Working'
                          : 'Idle'
                    }
                    isPulsing={isStreaming || activeIntervention?.state === 'pending'}
                  />
                </button>
              ) : (
                <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                  <span style={{fontWeight: 600, fontSize: '15px'}}>
                    {screen === 'chat' ? 'BalaBot' : screen.charAt(0).toUpperCase() + screen.slice(1)}
                  </span>
                  {screen !== 'chat' ? (
                    <Button
                      label="Back to Fleet"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setScreen('chat');
                        navigateTo(activeBotId ? `/app/${activeBotId}` : '/app');
                      }}
                    />
                  ) : null}
                </div>
              )}
            </div>

            {/* Right Header Controls */}
            <div className="app-no-drag" style={{display: 'flex', alignItems: 'center', gap: '6px'}}>
              {screen === 'chat' && activeBot ? (
                <HoldEverythingControl
                  botId={activeBot.id}
                  botName={activeBot.name}
                  isStreaming={isStreaming}
                  onStopStreaming={stop}
                  activeIntervention={activeIntervention}
                  onInterventionChange={setActiveIntervention}
                  onNotify={setBanner}
                  onOpenComputer={() => setShowComputer(true)}
                />
              ) : null}

              <Button
                label="Jump (Ctrl+K)"
                size="sm"
                variant="ghost"
                icon={<IconSearch />}
                onClick={() => setShowCommandPalette(true)}
              />

              <Switch
                label="Show thinking"
                value={showThinking}
                onChange={checked => {
                  setShowThinking(checked);
                  saveShowThinking(checked);
                }}
              />

              <StatusDot
                variant={healthOk === null ? 'neutral' : healthOk ? 'success' : 'error'}
                label={healthOk ? 'API connected' : 'API unreachable'}
                isPulsing={healthOk === true}
                tooltip={`GET /healthz ${healthOk === null ? 'checking' : healthOk ? 'ok' : 'failed'}`}
              />

              <IconButton
                label={themeMode === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
                size="sm"
                variant="ghost"
                icon={themeMode === 'light' ? <IconMoon /> : <IconSun />}
                onClick={() => handleSetTheme(themeMode === 'light' ? 'dark' : 'light')}
              />

              {screen === 'chat' && activeBot ? (
                <>
                  <IconButton
                    label="Agent computer"
                    size="sm"
                    variant={rightPanelMode === 'screen' && !hideRightPanel ? 'primary' : 'ghost'}
                    icon={<IconAgentComputer />}
                    onClick={() => setShowComputer(true)}
                  />
                  <IconButton
                    label="Bot settings"
                    size="sm"
                    variant={rightPanelMode === 'settings' && !hideRightPanel ? 'primary' : 'ghost'}
                    icon={<IconGear />}
                    onClick={() => {
                      setRightPanelMode('settings');
                      setHideRightPanel(false);
                    }}
                  />
                  <IconButton
                    label={hideRightPanel ? 'Expand right panel' : 'Collapse right panel'}
                    size="sm"
                    variant="ghost"
                    icon={hideRightPanel ? <IconExpandPanel /> : <IconCollapsePanel />}
                    onClick={() => setHideRightPanel(prev => !prev)}
                  />
                </>
              ) : null}
            </div>
          </div>

          {/* Banner notification if present */}
          {banner ? (
            <HStack gap={2} padding={3} vAlign="center" wrap="wrap" style={{backgroundColor: 'var(--card)', borderBottom: '1px solid var(--border)'}}>
              <IconWarning size="sm" color="warning" />
              <Text type="supporting">{banner}</Text>
              <IconButton
                label="Dismiss"
                size="sm"
                variant="ghost"
                icon={<IconClose />}
                onClick={() => setBanner('')}
              />
            </HStack>
          ) : null}

          {/* Center Transcript / Secondary Screen Content */}
          <div style={{flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column'}}>
            {screen === 'chat' ? (
              activeBot ? (
                <ChatLayout
                  style={{flex: 1, minHeight: 0}}
                  composer={
                    <Composer
                      isStreaming={isStreaming}
                      onSubmit={(text, attachments, replyTo) => void send(text, attachments, replyTo)}
                      onStop={stop}
                      botName={activeBot.name}
                      botId={activeBot.id}
                      bots={bots}
                      groups={groups}
                      skills={skills}
                      replyingTo={replyingToMessage}
                      onCancelReply={() => setReplyingToMessage(null)}
                      activeIntervention={activeIntervention}
                      onInterventionChange={setActiveIntervention}
                      onNotify={setBanner}
                      onOpenComputer={() => setShowComputer(true)}
                      onStartVoiceChat={() => {
                        setBanner('Voice chat: GrokBot voice channel activated. Speak now.');
                      }}
                    />
                  }
                  emptyState={
                    <VStack gap={5} align="center" paddingBlock={6} maxWidth={460}>
                      <EmptyState
                        title={`Say hi to ${activeBot.name}`}
                        description={activeBot.description}
                        icon={<Avatar name={activeBot.name} size="lg" tooltip={false} />}
                      />
                      <Grid columns={1} gap={2} width="100%">
                        {PROMPTS.map(p => (
                          <ClickableCard
                            key={p}
                            label={p}
                            padding={3}
                            elevation="low"
                            onClick={() => void send(p)}
                          >
                            <Text type="supporting">{p}</Text>
                          </ClickableCard>
                        ))}
                      </Grid>
                    </VStack>
                  }
                >
                  <ChatMessageList isStreaming={isStreaming} density="balanced">
                    {(activeSession?.messages ?? []).map((m, i, arr) => {
                      const isUser = m.role === 'user';
                      const prevSame = i > 0 && arr[i - 1].role === m.role;
                      const nextSame = i < arr.length - 1 && arr[i + 1].role === m.role;
                      const group: 'first' | 'middle' | 'last' | undefined = prevSame
                        ? nextSame
                          ? 'middle'
                          : 'last'
                        : nextSame
                          ? 'first'
                          : undefined;
                      return (
                        <ChatMessageRow
                          key={`${m.at}-${i}`}
                          sender={isUser ? 'user' : 'assistant'}
                          avatar={
                            <Avatar
                              name={isUser ? 'Ali' : activeBot.name}
                              size="md"
                              tooltip={false}
                            />
                          }
                        >
                          <div className="message-row-container">
                            <ChatMessageBubble
                              variant={isUser ? 'filled' : 'ghost'}
                              group={group}
                              name={
                                isUser ? undefined : (
                                  <Text type="supporting" weight="semibold" color="secondary">
                                    {activeBot.name}
                                  </Text>
                                )
                              }
                              metadata={
                                group === 'middle' || group === 'first' ? undefined : (
                                  <ChatMessageMetadata
                                    timestamp={<Timestamp value={new Date(m.at).toISOString()} format="time" />}
                                  />
                                )
                              }
                            >
                              {isUser ? (
                                <VStack gap={1} align="start">
                                  {m.replyTo ? (
                                    <HStack
                                      gap={1}
                                      paddingInline={2}
                                      paddingBlock={1}
                                      style={{
                                        backgroundColor: 'color-mix(in srgb, var(--accent) 8%, transparent)',
                                        borderLeft: 'var(--spacing-0-5) solid var(--accent)',
                                        borderRadius: 'var(--radius-sm)',
                                        marginBottom: 'var(--spacing-0-5)',
                                      }}
                                    >
                                      <Text type="supporting" size="xsm" color="secondary">
                                        ↩ Replying to {m.replyTo.sender}: &ldquo;{m.replyTo.text.slice(0, 50)}{m.replyTo.text.length > 50 ? '…' : ''}&rdquo;
                                      </Text>
                                    </HStack>
                                  ) : null}
                                  <Text>{m.content}</Text>
                                  {m.attachments && m.attachments.length > 0 ? (
                                    <VStack gap={2} align="start" width="100%">
                                      {m.attachments.map(a => (
                                        <FilePreviewCard key={a.id} attachment={a} />
                                      ))}
                                    </VStack>
                                  ) : null}
                                </VStack>
                              ) : (
                                <VStack gap={2} align="start">
                                  {showThinking && m.thinking ? (
                                    <ThinkingBlock text={m.thinking} theme={themeMode} />
                                  ) : null}
                                  <Markdown isStreaming={false}>{m.content}</Markdown>
                                  {m.attachments && m.attachments.length > 0 ? (
                                    <VStack gap={2} align="start" width="100%">
                                      {m.attachments.map(a => (
                                        <FilePreviewCard key={a.id} attachment={a} />
                                      ))}
                                    </VStack>
                                  ) : null}
                                  <OpenUIRenderer content={m.content} onAction={handleOpenUIAction} />
                                  {m.toolCalls && m.toolCalls.length > 0 ? (
                                    <ChatToolCalls
                                      calls={m.toolCalls.map(t => ({
                                        key: t.toolCallId,
                                        name: t.tool,
                                        target: t.label,
                                        status: toToolCallStatus(t.status),
                                      }))}
                                    />
                                  ) : null}
                                </VStack>
                              )}
                            </ChatMessageBubble>
                            <MessageHoverMetadata side={isUser ? 'start' : 'end'}>
                              <HStack gap={1} vAlign="center" wrap="wrap" style={{paddingInline: 'var(--spacing-1)'}}>
                                {Object.entries(m.reactions || {}).map(([emoji, count]) =>
                                  count > 0 ? (
                                    <Button
                                      key={emoji}
                                      label={`${emoji} ${count}`}
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => handleToggleReaction(i, emoji)}
                                    />
                                  ) : null,
                                )}
                                <HStack gap={1} vAlign="center">
                                  {['👍', '❤️', '🚀'].map(emoji => (
                                    <button
                                      key={emoji}
                                      type="button"
                                      className="message-reaction-button"
                                      title={`React with ${emoji}`}
                                      aria-label={`React ${emoji}`}
                                      onClick={() => handleToggleReaction(i, emoji)}
                                    >
                                      {emoji}
                                    </button>
                                  ))}
                                  <Button
                                    label="Reply"
                                    size="sm"
                                    variant="ghost"
                                    onClick={() =>
                                      setReplyingToMessage({
                                        sender: isUser ? 'You' : activeBot.name,
                                        text: m.content,
                                      })
                                    }
                                  />
                                </HStack>
                              </HStack>
                            </MessageHoverMetadata>
                          </div>
                        </ChatMessageRow>
                      );
                    })}

                    {/* Live streaming turn in flight */}
                    {isStreaming && (displayed || streamThinking || toolCalls.length > 0) ? (
                      <ChatMessageRow
                        sender="assistant"
                        avatar={
                          <Avatar
                            name={activeBot.name}
                            size="md"
                            tooltip={false}
                          />
                        }
                      >
                        <ChatMessageBubble
                          variant="ghost"
                          name={
                            <Text type="supporting" weight="semibold" color="secondary">
                              {activeBot.name}
                            </Text>
                          }
                        >
                          <VStack gap={2} align="start">
                            {showThinking && streamThinking ? (
                              <ThinkingBlock text={streamThinking} isLive theme={themeMode} />
                            ) : null}
                            {displayed ? (
                              <Markdown isStreaming>{displayed}</Markdown>
                            ) : (
                              <HStack gap={2} vAlign="center">
                                <ThinkingOrb
                                  state={orbStateForTool(activeTool(toolCalls)?.tool)}
                                  size={32}
                                  theme={themeMode}
                                />
                                <Text type="supporting" color="secondary">
                                  {activeTool(toolCalls)?.label ?? 'Working…'}
                                </Text>
                              </HStack>
                            )}
                            {toolCalls.length > 0 ? (
                              <ChatToolCalls
                                calls={toolCalls.map(t => ({
                                  key: t.toolCallId,
                                  name: t.tool,
                                  target: t.label,
                                  status: toToolCallStatus(t.status),
                                }))}
                              />
                            ) : null}
                          </VStack>
                        </ChatMessageBubble>
                      </ChatMessageRow>
                    ) : null}

                    {/* Handoff signals */}
                    {(activeSession?.handoffs ?? []).map((h, i) => (
                      <ChatMessageRow
                        key={`handoff-${i}`}
                        sender="system"
                        avatar={<Avatar name={`${h.from}→${h.to}`} size="md" tooltip={false} />}
                      >
                        <HStack gap={2} vAlign="center" wrap="wrap">
                          <Token label={h.from || 'bot'} size="sm" color="blue" />
                          <Text type="supporting">→</Text>
                          <Token label={h.to || 'bot'} size="sm" color="teal" />
                          {h.summary ? <Text type="supporting">{h.summary}</Text> : null}
                          <Timestamp value={new Date(h.at).toISOString()} format="time" />
                        </HStack>
                      </ChatMessageRow>
                    ))}

                    {/* In-chat secret intake cards */}
                    {secretCards.map(card => (
                      <SecretRequestCard
                        key={card.requestId}
                        card={card}
                        bots={bots}
                        onResolve={(requestId, status) => {
                          setSecretCards(prev =>
                            prev.map(c => (c.requestId === requestId ? {...c, status} : c)),
                          );
                        }}
                      />
                    ))}

                    {/* In-transcript intervention cards */}
                    {interventions.map((iv, idx) => (
                      <InterventionCard
                        key={iv.resume_token || idx}
                        intervention={iv}
                        onOpenComputer={() => setShowComputer(true)}
                        onResolved={() => {
                          setBanner('Intervention resolved — bot resuming.');
                          setInterventions(prev => prev.filter(item => item.resume_token !== iv.resume_token));
                        }}
                      />
                    ))}

                    {/* In-transcript draft cards */}
                    {draftCards.map(draft => (
                      <DraftCard
                        key={draft.id}
                        draft={draft}
                        onSend={updated => {
                          setBanner(`${updated.kind === 'email' ? 'Email' : 'Slack message'} sent!`);
                          setDraftCards(prev => prev.filter(d => d.id !== draft.id));
                        }}
                        onDiscard={id => {
                          setBanner('Draft discarded.');
                          setDraftCards(prev => prev.filter(d => d.id !== id));
                        }}
                      />
                    ))}

                    {/* In-transcript voice memos */}
                    {voiceMemos.map(memo => (
                      <VoiceMemoCard key={memo.id} memo={memo} />
                    ))}
                  </ChatMessageList>
                </ChatLayout>
              ) : (
                <div style={{flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted-foreground)'}}>
                  Select a bot to begin
                </div>
              )
            ) : screen === 'agents' ? (
              <AgentsScreen />
            ) : screen === 'memory' ? (
              <MemoryScreen />
            ) : screen === 'decisions' ? (
              <DecisionsScreen />
            ) : screen === 'governance' ? (
              <GovernanceScreen />
            ) : screen === 'ops' ? (
              <OpsScreen />
            ) : screen === 'cost' ? (
              <CostScreen />
            ) : null}
          </div>
        </main>

        {/* ── Region 3: 384px Sliding Contextual Side-panel ── */}
        <aside
          data-testid="side-panel"
          data-panel={hideRightPanel || !activeBot ? 'closed' : rightPanelMode}
          className="polaris-side-panel"
          style={{
            width: hideRightPanel || !activeBot ? 0 : 384,
            minWidth: hideRightPanel || !activeBot ? 0 : undefined,
            maxWidth: hideRightPanel || !activeBot ? 0 : 384,
          }}
        >
          {activeBot && !hideRightPanel ? (
            <div className="rk-scroll" style={{height: '100%', overflowY: 'auto', padding: '16px 20px', boxSizing: 'border-box'}}>
              {/* Header */}
              <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px'}}>
                <span style={{fontSize: '13.5px', color: 'var(--muted-foreground)', fontWeight: 500}}>
                  {rightPanelMode === 'settings' ? 'Settings' : `${activeBot.name}'s screen`}
                </span>
                <div style={{display: 'flex', alignItems: 'center', gap: '4px'}}>
                  <IconButton
                    label={rightPanelMode === 'settings' ? 'Show computer screen' : 'Show settings'}
                    size="sm"
                    variant="ghost"
                    icon={rightPanelMode === 'settings' ? <IconAgentComputer /> : <IconGear />}
                    onClick={() => setRightPanelMode(prev => (prev === 'settings' ? 'screen' : 'settings'))}
                  />
                  <IconButton
                    label="Close panel"
                    size="sm"
                    variant="ghost"
                    icon={<IconClose />}
                    onClick={() => setHideRightPanel(true)}
                  />
                </div>
              </div>

              {/* Mode content */}
              {rightPanelMode === 'settings' ? (
                <VStack gap={3}>
                  <TextInput label="Name" value={editName} onChange={setEditName} size="sm" />
                  <TextInput label="Title / Role" value={editTitle} onChange={setEditTitle} size="sm" />
                  <VStack gap={1} align="start" width="100%">
                    <Text type="supporting" size="xsm" weight="medium">
                      Description & Instructions
                    </Text>
                    <textarea
                      value={editDesc}
                      onChange={e => setEditDesc(e.target.value)}
                      rows={6}
                      style={{
                        width: '100%',
                        padding: 'var(--spacing-2)',
                        fontFamily: 'inherit',
                        fontSize: 'var(--font-size-xs)',
                        backgroundColor: 'var(--muted)',
                        color: 'inherit',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-md)',
                        resize: 'vertical',
                      }}
                    />
                  </VStack>
                  <HStack gap={2}>
                    <Button
                      label={savingSettings ? 'Saving…' : 'Save changes'}
                      variant="primary"
                      size="sm"
                      isDisabled={savingSettings}
                      onClick={async () => {
                        setSavingSettings(true);
                        try {
                          await updateBot(activeBot.id, {
                            name: editName.trim() || activeBot.name,
                            title: editTitle.trim(),
                            description: editDesc.trim(),
                          });
                          await reloadBots();
                          setBanner(`Saved settings for ${editName.trim() || activeBot.name}`);
                          setRightPanelMode('screen');
                        } catch (err) {
                          setBanner(`Failed to save settings: ${(err as Error).message}`);
                        } finally {
                          setSavingSettings(false);
                        }
                      }}
                    />
                    <Button
                      label="Cancel"
                      variant="ghost"
                      size="sm"
                      onClick={() => setRightPanelMode('screen')}
                    />
                  </HStack>
                  <Divider />
                  <Button
                    label={`${activeBot.name} Memory & Knowledge`}
                    size="sm"
                    variant="ghost"
                    icon={<IconBotKnowledge />}
                    onClick={() => setShowPanel(true)}
                  />
                </VStack>
              ) : (
                <VStack gap={3}>
                  <HStack gap={2} vAlign="center" justify="between">
                    <HStack gap={2} vAlign="center">
                      <BotAvatar
                        identity={activeBot.id}
                        color={activeBot.color}
                        size={28}
                        status={isStreaming ? 'working' : undefined}
                      />
                      <Text type="body" weight="semibold">
                        {activeBot.name}&apos;s screen
                      </Text>
                    </HStack>
                    <StatusDot
                      variant={isStreaming ? 'warning' : 'success'}
                      label={isStreaming ? 'Working' : 'Idle'}
                      isPulsing={isStreaming}
                    />
                  </HStack>

                  {/* GrokBot Live Screen Preview Card */}
                  <Card variant="muted" padding={2} minHeight={150}>
                    <VStack gap={2} align="center">
                      {miniFrame?.b64 ? (
                        <img
                          src={`data:image/png;base64,${miniFrame.b64}`}
                          alt={`${activeBot.name} screen thumbnail`}
                          style={{
                            width: '100%',
                            height: 'auto',
                            borderRadius: 'var(--radius-sm)',
                            cursor: 'pointer',
                          }}
                          onClick={() => setShowComputer(true)}
                        />
                      ) : (
                        <VStack gap={2} paddingBlock={3} align="center">
                          <IconAgentComputer size="md" color="secondary" />
                          <Text type="supporting" size="xsm">
                            {miniFrame?.note || 'Agent computer ready'}
                          </Text>
                        </VStack>
                      )}
                      <Button
                        label="Open Agent Computer"
                        size="sm"
                        variant="secondary"
                        icon={<IconAgentComputer />}
                        onClick={() => setShowComputer(true)}
                      />
                    </VStack>
                  </Card>

                  {/* GrokBot Routines Section */}
                  <Divider />
                  <RoutinesList
                    botId={activeBot.id}
                    botName={activeBot.name}
                    onNotify={setBanner}
                  />

                  <Divider />
                  <VStack gap={1} align="start">
                    <Text type="supporting" weight="semibold" size="xsm">
                      Role & Bio
                    </Text>
                    <Text type="supporting" size="xsm">
                      {activeBot.description || activeBot.title}
                    </Text>
                  </VStack>
                </VStack>
              )}
            </div>
          ) : null}
        </aside>

        {/* ── Dialogs and Modals ── */}
        {showSessions ? (
          <SessionsDialog
            botId={activeBotId ?? ''}
            sessions={sessions.filter(s => s.botId === activeBotId)}
            activeId={activeSessionId}
            onSwitch={setActiveSessionId}
            onDelete={id => {
              void (async () => {
                try {
                  await deleteServerSession(id);
                } catch (err) {
                  setBanner(`Delete failed: ${(err as Error).message}`);
                  return;
                }
                setSessions(prev => prev.filter(s => s.id !== id));
                setActiveSessionId(prev => (prev === id ? null : prev));
              })();
            }}
            onNew={s => {
              if (!activeBotId) return;
              void (async () => {
                let created: Session | null = null;
                try {
                  const row = await createServerSession(
                    activeBotId,
                    s.title,
                    `${activeBot?.name ?? activeBotId}: ${s.title}`,
                    s.id,
                  );
                  created = {
                    ...s,
                    id: row.id,
                    botId: row.botId || activeBotId,
                    purpose: row.purpose,
                    topicSpans: row.topicSpans ?? [],
                  };
                } catch (err) {
                  setBanner(
                    `Could not create the conversation on the server — ${(err as Error).message}`,
                  );
                  return;
                }
                setSessions(prev => [...prev, created as Session]);
                setActiveSessionId((created as Session).id);
              })();
            }}
            onClose={() => setShowSessions(false)}
          />
        ) : null}
        {showPanel && activeBot ? (
          <BotPanelDialog bot={activeBot} onClose={() => setShowPanel(false)} />
        ) : null}
        {showComputer && activeBot ? (
          <AgentComputerDialog bot={activeBot} onClose={() => setShowComputer(false)} />
        ) : null}
        {showSkills ? (
          <SkillLibraryDialog
            bots={bots}
            activeBotId={activeBotId}
            onClose={() => setShowSkills(false)}
          />
        ) : null}
        {showGroups ? (
          <GroupChatDialog
            bots={bots}
            initialGroupId={activeGroupId}
            onClose={() => setShowGroups(false)}
            onFleetsChanged={() => void reloadBots()}
          />
        ) : null}
        {showBotCreation ? (
          <BotCreationDialog
            bots={bots}
            onClose={() => setShowBotCreation(false)}
            onFleetChanged={() => void reloadBots()}
          />
        ) : null}
        {editBot ? (
          <BotEditDialog
            bot={editBot}
            onClose={() => setEditBot(null)}
            onUpdated={onBotEdited}
          />
        ) : null}
        {deleteBotTarget ? (
          <BotDeleteDialog
            bot={deleteBotTarget}
            onClose={() => setDeleteBotTarget(null)}
            onDeleted={onBotDeleted}
          />
        ) : null}
        {showOrphans ? (
          <OrphansDialog
            onClose={() => setShowOrphans(false)}
            onFleetChanged={() => void reloadBots()}
          />
        ) : null}
        {newSectionBot ? (
          <NewBotSectionDialog
            bot={newSectionBot}
            onCancel={() => setNewSectionBot(null)}
            onConfirm={handleCreateSection}
          />
        ) : null}
        {renameSectionTarget ? (
          <RenameBotSectionDialog
            section={renameSectionTarget}
            onCancel={() => setRenameSectionTarget(null)}
            onConfirm={handleRenameSection}
          />
        ) : null}

        <CommandPalette
          isOpen={showCommandPalette}
          onClose={() => setShowCommandPalette(false)}
          bots={bots}
          groups={groups}
          sessions={sessions}
          themeMode={themeMode}
          onSelectBot={id => {
            setActiveBotId(id);
            setActiveGroupId(null);
            setActiveSessionId(null);
            setScreen('chat');
            navigateTo(`/app/${encodeURIComponent(id)}`);
          }}
          onSelectGroup={gid => {
            setActiveGroupId(gid);
            setShowGroups(true);
            navigateTo(`/app/g/${encodeURIComponent(gid)}`);
          }}
          onSelectSession={(sid, botId) => {
            setActiveBotId(botId);
            setActiveGroupId(null);
            setActiveSessionId(sid);
            setScreen('chat');
            navigateTo(`/app/${encodeURIComponent(botId)}`);
          }}
          onAction={action => {
            if (action === 'new-bot') setShowBotCreation(true);
            else if (action === 'new-group') {
              setActiveGroupId(null);
              setShowGroups(true);
            } else if (action === 'open-skills') setShowSkills(true);
            else if (action === 'open-computer') setShowComputer(true);
            else if (action === 'nav-agents') {
              setScreen('agents');
              navigateTo('/app/agents');
            } else if (action === 'nav-memory') {
              setScreen('memory');
              navigateTo('/app/memory');
            } else if (action === 'nav-decisions') {
              setScreen('decisions');
              navigateTo('/app/decisions');
            } else if (action === 'nav-governance') {
              setScreen('governance');
              navigateTo('/app/governance');
            } else if (action === 'nav-ops') {
              setScreen('ops');
              navigateTo('/app/ops');
            } else if (action === 'nav-cost') {
              setScreen('cost');
              navigateTo('/app/cost');
            } else if (action === 'toggle-theme') handleSetTheme(themeMode === 'light' ? 'dark' : 'light');
          }}
        />
      </div>
    </Theme>
  );
}
