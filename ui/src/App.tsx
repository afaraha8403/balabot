import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Transcript} from './Transcript';
import {LinkifiedText} from './LinkifiedText';
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
import {ChatMarkdown} from './ChatMarkdown';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Composer} from './Composer';
import {BotPanelDialog} from './BotPanelDialog';
import {AgentComputerDialog} from './AgentComputerDialog';
import {ComputerMaintenanceActions} from './ComputerMaintenanceActions';
import {SecretRequestCard} from './SecretRequestCard';
import {OpenUIRenderer, extractOpenUI} from './openui/OpenUIRenderer';
import {SkillLibraryDialog} from './SkillLibraryDialog';
import {PluginsOverlay} from './PluginsOverlay';
import {McpServersOverlay} from './McpServersOverlay';
import {GroupChatDialog} from './GroupChatDialog';
import {BotSettings} from './BotSettings';
import {CreateBotForm} from './CreateBotForm';
import {ClearConversationDialog} from './ClearConversationDialog';
import {BotDeleteDialog} from './BotDeleteDialog';
import {OrphansDialog} from './OrphansDialog';
import {SettingsOverlay, type SettingsSection} from './SettingsOverlay';
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
import {SpaceSwitcher} from './SpaceSwitcher';
import {UserMenuPopover} from './UserMenuPopover';
import {BotRoster} from './screens/BotRoster';
import {AgentsScreen} from './screens/AgentsScreen';
import {MemoryScreen} from './screens/MemoryScreen';
import {DecisionsScreen} from './screens/DecisionsScreen';
import {GovernanceScreen} from './screens/GovernanceScreen';
import {OpsScreen} from './screens/OpsScreen';
import {CostScreen} from './screens/CostScreen';
import {ArtifactsPage} from './ArtifactsPage';
import {CallView} from './CallView';
import {Phone} from 'lucide-react';
import {CommandPalette, isCommandPaletteHotkey} from './CommandPalette';
import {InterventionCard} from './InterventionCard';
import {DraftCard, parseDraftsFromContent} from './DraftCard';
import {VoiceMemoCard} from './VoiceMemoCard';
import {HoldEverythingControl} from './HoldEverythingControl';
import {RoutinesList, RoutineEditor} from './RoutinesList';
import {FilePreviewCard} from './FilePreviewCard';
import {AskCard, ChoiceCard, AppConnectCard, McpApprovalCard, ChartBlockView} from './cards';
import {MessageHoverMetadata, MessageHoverActions} from './MessageHoverMetadata';
import {WindowChrome} from './WindowChrome';
import {ShellSkeleton} from './ShellSkeleton';
import {useRoute, navigateTo, parseRoute} from './router';
import {
  api,
  streamChat,
  enqueueMessage,
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
  approveBotProposal,
  createApprovedBot,
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
  type Routine,
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
  loadUnreadBots,
  saveUnreadBots,
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
          <ChatMarkdown>{text}</ChatMarkdown>
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
  const [screen, setScreen] = useState<ScreenId>(() => {
    if (typeof window !== 'undefined') {
      const initialRoute = parseRoute(window.location.pathname, window.location.search);
      if (initialRoute.kind === 'screen') {
        return initialRoute.screen as ScreenId;
      }
    }
    return 'chat';
  });
  const [bots, setBots] = useState<Bot[]>([]);
  const [activeBotId, setActiveBotId] = useState<string | null>(null);
  const [rosterQuery, setRosterQuery] = useState('');
  const [sessions, setSessions] = useState<Session[]>(() => loadSessions());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const [showPanel, setShowPanel] = useState(false);
  const [showComputer, setShowComputer] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const [showPlugins, setShowPlugins] = useState(false);
  const [showMcp, setShowMcp] = useState(false);
  const [showGroups, setShowGroups] = useState(false);
  const [deleteBotTarget, setDeleteBotTarget] = useState<Bot | null>(null);
  const [clearTarget, setClearTarget] = useState<Bot | null>(null);
  const [showOrphans, setShowOrphans] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCallView, setShowCallView] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general');
  const [, setExcluded] = useState<string[]>([]);
  const [pinnedBotIds, setPinnedBotIds] = useState<string[]>(() => loadPinnedBots());
  const [hiddenBotIds, setHiddenBotIds] = useState<string[]>(() => loadHiddenBots());
  const [unreadBotIds, setUnreadBotIds] = useState<string[]>(() => loadUnreadBots());
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

  const sidebarEdgeDragRef = useRef<{ startX: number; mode: 'expand' | 'collapse' } | null>(null);

  // Mobile sidebar drawer state under 1024px
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Responsive breakpoint under 1024px
  const isNarrow = useMediaQuery('(max-width: 1023px)');

  // Right Context Panel mode ('screen' | 'settings' | 'create' | 'routine') and collapsed state
  const [rightPanelMode, setRightPanelMode] = useState<'screen' | 'settings' | 'create' | 'routine'>('screen');
  const [editingRoutine, setEditingRoutine] = useState<Routine | null>(null);
  const [hideRightPanel, setHideRightPanel] = useState(false);
  const [miniFrame, setMiniFrame] = useState<ComputerFrame | null>(null);
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
      if (currentRoute.kind === 'artifacts') {
        // Artifacts gallery route
      } else if (currentRoute.kind === 'app' && currentRoute.botId) {
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

  // OpenUI actions handler
  const handleOpenUIAction = useCallback(async (action: any) => {
    const actionType = action?.type?.type || action?.type || '';
    const params = (action?.params || action?.type?.params) as { name?: string; role?: string; description?: string } | undefined;
    if (actionType === 'approve_hire') {
      const name = params?.name || 'marketing-seo-expert';
      const role = params?.role || 'Marketing & SEO Expert';
      try {
        const propRes = await createBotProposal({
          name,
          role,
          proposed_by: 'user',
        });
        if (propRes.proposal?.id) {
          await approveBotProposal(propRes.proposal.id).catch(() => null);
          await createApprovedBot(propRes.proposal.id).catch(() => null);
        }
        await reloadBots();
        setBanner(`Hiring approved — "${role}" (${name}) registered in the roster.`);
      } catch (e) {
        await reloadBots().catch(() => {});
        setBanner(`Hiring registered for "${role}": ${(e as Error).message}`);
      }
    } else if (actionType === 'dismiss_hire') {
      setBanner('Hiring proposal dismissed.');
    }
  }, [reloadBots]);

  useEffect(() => {
    const onHire = (e: Event) => {
      const detail = (e as CustomEvent).detail as { name?: string; role?: string; description?: string } | undefined;
      if (detail) {
        void (async () => {
          try {
            const propRes = await createBotProposal({
              name: detail.name || 'marketing-seo-expert',
              role: detail.role || 'Marketing & SEO Expert',
              proposed_by: 'user',
            });
            if (propRes.proposal?.id) {
              await approveBotProposal(propRes.proposal.id).catch(() => null);
              await createApprovedBot(propRes.proposal.id).catch(() => null);
            }
            await reloadBots();
            setBanner(`Agent "${detail.role}" registered in the roster.`);
          } catch (err) {
            await reloadBots().catch(() => {});
            setBanner(`Agent proposal saved: ${(err as Error).message}`);
          }
        })();
      }
    };
    window.addEventListener('balabot:openui-hire-agent', onHire);
    return () => window.removeEventListener('balabot:openui-hire-agent', onHire);
  }, [reloadBots]);

  // Synchronize route changes from History navigation (popstate/forward/back)
  useEffect(() => {
    if (route.kind === 'artifacts') {
      // Handled at top-level view
    } else if (route.kind === 'app') {
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

  const onToggleUnread = useCallback((bot: Bot) => {
    setUnreadBotIds(prev => {
      const next = prev.includes(bot.id) ? prev.filter(id => id !== bot.id) : [...prev, bot.id];
      saveUnreadBots(next);
      return next;
    });
  }, []);

  const onMoveToSection = useCallback((botId: string, sectionId: string | null) => {
    saveBotSectionAssignment(botId, sectionId);
    setSectionAssignments(loadBotSectionAssignments());
  }, []);

  const onClearConversation = useCallback((bot: Bot) => {
    setClearTarget(bot);
  }, []);

  const onArchiveBot = useCallback((bot: Bot) => {
    onToggleHide(bot);
    setBanner(`Archived ${bot.name} from sidebar.`);
  }, [onToggleHide]);

  const onDuplicateBot = useCallback(async (bot: Bot) => {
    try {
      await createBotProposal({
        name: `${bot.name} copy`,
        role: bot.title || bot.description || 'Specialist bot',
      });
      setBanner(`Proposal created for "${bot.name} copy" — opening Create Bot in right panel.`);
      setRightPanelMode('create');
      setHideRightPanel(false);
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
        setRightPanelMode('create');
        setHideRightPanel(false);
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

    if (isStreaming) {
      const hasActiveTools = toolCallsRef.current.length > 0;
      const userMsg: ChatMessage = {
        role: 'user',
        content: text,
        at: Date.now(),
        attachments: attachments?.length ? attachments : undefined,
        replyTo: replyTo,
        deliveryStatus: hasActiveTools ? 'steered' : 'queued',
      };
      patchSession(session.id, s => ({
        ...s,
        messages: [...s.messages, userMsg],
      }));
      void enqueueMessage(session.id, text).catch(() => {});
      return;
    }

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
          patchSession(session.id, s => ({
            ...s,
            messages: s.messages.map(m =>
              m.deliveryStatus === 'queued' ? {...m, deliveryStatus: 'steered'} : m
            ),
          }));
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
      patchSession(session.id, s => ({
        ...s,
        messages: s.messages.map(m =>
          m.deliveryStatus === 'queued' ? {...m, deliveryStatus: 'delivered'} : m
        ),
      }));
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

  if (route.kind === 'artifacts') {
    return (
      <Theme theme={balabotTheme} mode={themeMode}>
        <div className="h-screen w-screen overflow-hidden bg-background text-foreground" data-rakazo-app-state="ready">
          <ArtifactsPage artifactId={route.artifactId} bots={bots} />
        </div>
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
                onClick={() => {
                  setRightPanelMode('create');
                  setHideRightPanel(false);
                }}
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

          {/* Quick Space Switcher Popover */}
          <div style={{padding: '10px 14px 2px 14px'}}>
            <SpaceSwitcher
              activeBotId={activeBotId ?? undefined}
              activeBotName={activeBot?.name}
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSelectSession={setActiveSessionId}
              onNewSession={() => {
                if (!activeBotId) return;
                void (async () => {
                  let created: Session | null = null;
                  try {
                    const s = newSession(activeBotId, 'New chat');
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
                    setBanner(`Could not create conversation: ${(err as Error).message}`);
                    return;
                  }
                  if (created) {
                    setSessions(prev => [created!, ...prev]);
                    setActiveSessionId(created.id);
                  }
                })();
              }}
              onDeleteSession={id => {
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
            />
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
              unreadBotIds={unreadBotIds}
              groups={groups}
              activeGroupId={activeGroupId}
              onSelect={id => {
                setActiveBotId(id);
                setActiveGroupId(null);
                setActiveSessionId(null);
                setScreen('chat');
                setUnreadBotIds(prev => {
                  if (prev.includes(id)) {
                    const next = prev.filter(x => x !== id);
                    saveUnreadBots(next);
                    return next;
                  }
                  return prev;
                });
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
              onToggleUnread={onToggleUnread}
              onMoveToSection={onMoveToSection}
              onCreateSection={setNewSectionBot}
              onDuplicateBot={onDuplicateBot}
              onClearConversation={onClearConversation}
              onArchiveBot={onArchiveBot}
              sections={botSections}
              sectionAssignments={sectionAssignments}
              collapsedSections={collapsedSections}
              onToggleSection={toggleSection}
              onEditBot={bot => {
                setActiveBotId(bot.id);
                setRightPanelMode('settings');
                setHideRightPanel(false);
              }}
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
                onClick={() => setShowPlugins(true)}
              />
            </HStack>
            <UserMenuPopover
              userName="Ali"
              onNavigateArtifacts={() => {
                setScreen('chat');
                navigateTo('/app/artifacts');
              }}
              onNavigateScreen={(targetScreen) => {
                setScreen(targetScreen);
                navigateTo(targetScreen === 'agents' ? '/app/fleet' : `/app/${targetScreen}`);
              }}
              onOpenSettings={(tab) => {
                setSettingsSection((tab as SettingsSection) || 'general');
                setShowSettings(true);
              }}
              onOpenUsage={() => {
                setSettingsSection('usage');
                setShowSettings(true);
              }}
              onSignOut={() => {
                try {
                  localStorage.removeItem('balabot-dashboard.key');
                  window.location.reload();
                } catch {}
              }}
            />
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
          onPointerDown={event => {
            event.currentTarget.setPointerCapture(event.pointerId);
            sidebarEdgeDragRef.current = {
              startX: event.clientX,
              mode: sidebarCollapsed ? 'expand' : 'collapse',
            };
          }}
          onPointerMove={event => {
            const drag = sidebarEdgeDragRef.current;
            if (!drag) return;
            const delta = event.clientX - drag.startX;
            if (drag.mode === 'expand' && delta >= 24) {
              sidebarEdgeDragRef.current = null;
              setSidebarCollapsedPref(false);
            } else if (drag.mode === 'collapse' && delta <= -24) {
              sidebarEdgeDragRef.current = null;
              setSidebarCollapsedPref(true);
            }
          }}
          onPointerUp={event => {
            const drag = sidebarEdgeDragRef.current;
            sidebarEdgeDragRef.current = null;
            if (!drag) return;
            if (Math.abs(event.clientX - drag.startX) < 24) {
              toggleSidebar();
            }
          }}
          onPointerCancel={() => {
            sidebarEdgeDragRef.current = null;
          }}
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
                    label="Voice call"
                    size="sm"
                    variant={showCallView ? 'primary' : 'ghost'}
                    icon={<Phone size={15} />}
                    onClick={() => setShowCallView(true)}
                  />
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
                <div style={{flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column'}}>
                  <Transcript
                    trackDep={activeSession?.messages?.length}
                    isStreaming={isStreaming}
                    onQuote={(messageId, quoteText) => {
                      const msg = (activeSession?.messages ?? []).find((_, idx) => `msg-${_?.at}-${idx}` === messageId);
                      const sender = msg?.role === 'user' ? 'You' : activeBot.name;
                      setReplyingToMessage({
                        sender,
                        text: quoteText,
                      });
                    }}
                  >
                    {(activeSession?.messages ?? []).length === 0 && !isStreaming && secretCards.length === 0 && interventions.length === 0 && draftCards.length === 0 && voiceMemos.length === 0 ? (
                      <div style={{display: 'flex', justifyContent: 'center', width: '100%', margin: 'auto 0'}}>
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
                      </div>
                    ) : (
                      <>
                        {(activeSession?.messages ?? []).map((m, i) => {
                        const isUser = m.role === 'user';
                        const messageId = `msg-${m.at}-${i}`;
                        return (
                          <div
                            key={messageId}
                            data-message-id={messageId}
                            className="group/message relative hover:z-20"
                            style={{ position: 'relative' }}
                          >
                            <time
                              dateTime={new Date(m.at).toISOString()}
                              data-testid="message-hover-time"
                              className={`pointer-events-none absolute top-1 z-10 text-xs tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100 ${
                                isUser ? 'start-0' : 'end-0'
                              }`}
                              style={{
                                position: 'absolute',
                                top: '-18px',
                                [isUser ? 'right' : 'left']: '0',
                                zIndex: 10,
                                fontSize: '12px',
                                color: 'var(--muted-foreground)',
                                pointerEvents: 'none',
                                fontVariantNumeric: 'tabular-nums',
                              }}
                            >
                              {new Date(m.at).toLocaleTimeString([], {
                                hour: 'numeric',
                                minute: '2-digit',
                              })}
                            </time>
                            <div
                              className={`relative flex ${isUser ? 'justify-end' : 'justify-start'}`}
                              style={{
                                position: 'relative',
                                display: 'flex',
                                justifyContent: isUser ? 'flex-end' : 'flex-start',
                                width: '100%',
                              }}
                            >
                              <div
                                data-testid="message-bubble-frame"
                                className={`relative w-fit min-w-0 ${
                                  isUser
                                    ? 'max-w-[min(84%,calc(100%_-_6rem))] [@media(hover:none)]:max-w-[84%]'
                                    : 'max-w-[min(88%,calc(100%_-_6rem))] [@media(hover:none)]:max-w-[88%]'
                                }`}
                                style={{
                                  position: 'relative',
                                  width: 'fit-content',
                                  minWidth: 0,
                                  maxWidth: isUser ? 'min(84%, calc(100% - 6rem))' : 'min(88%, calc(100% - 6rem))',
                                }}
                              >
                                {!isUser ? (
                                  <div
                                    className="mb-1.5 flex items-center gap-2 text-[13px] font-semibold tracking-tight"
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '8px',
                                      marginBottom: '6px',
                                      fontSize: '13px',
                                      fontWeight: 600,
                                      color: activeBot.color || 'var(--foreground)',
                                    }}
                                  >
                                    <BotAvatar
                                      identity={activeBot.id}
                                      color={activeBot.color}
                                      size={22}
                                    />
                                    {activeBot.name}
                                  </div>
                                ) : null}

                                {m.replyTo ? (
                                  <button
                                    type="button"
                                    data-testid="reply-parent-preview"
                                    aria-label={`Jump to replied message: “${m.replyTo.text.slice(0, 50)}”`}
                                    style={{
                                      display: 'block',
                                      maxWidth: '74%',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                      borderRadius: '14px',
                                      border: '1px solid var(--border)',
                                      backgroundColor: 'var(--background)',
                                      padding: '6px 12px',
                                      textAlign: 'left',
                                      fontSize: '12.5px',
                                      color: 'var(--muted-foreground)',
                                      marginBottom: '6px',
                                      cursor: 'default',
                                    }}
                                  >
                                    “{m.replyTo.text}”
                                  </button>
                                ) : null}

                                {isUser ? (
                                  <div
                                    data-testid="message-user-bubble"
                                    data-quote-message-id={messageId}
                                    className="max-w-full whitespace-pre-wrap wrap-anywhere rounded-[20px] bg-chat-user px-[18px] py-3 text-[15.5px] leading-[1.45] text-chat-user-foreground"
                                    style={{
                                      backgroundColor: 'var(--chat-user)',
                                      color: 'var(--chat-user-foreground)',
                                      borderRadius: '20px',
                                      padding: '12px 18px',
                                      fontSize: '15.5px',
                                      lineHeight: 1.45,
                                      wordBreak: 'break-word',
                                      whiteSpace: 'pre-wrap',
                                    }}
                                  >
                                    <LinkifiedText>{m.content}</LinkifiedText>
                                    {m.attachments && m.attachments.length > 0 ? (
                                      <VStack gap={2} align="start" width="100%" style={{ marginTop: '8px' }}>
                                        {m.attachments.map(a => (
                                          <FilePreviewCard key={a.id} attachment={a} />
                                        ))}
                                      </VStack>
                                    ) : null}
                                    {m.deliveryStatus === 'queued' ? (
                                      <div
                                        data-testid="message-delivery-status"
                                        className="mt-1 text-[11.5px] font-medium text-chat-user-foreground/75"
                                        style={{ marginTop: '4px', fontSize: '11.5px', fontWeight: 500, opacity: 0.85 }}
                                      >
                                        queued for the next step
                                      </div>
                                    ) : null}
                                    {m.deliveryStatus === 'delivered' ? (
                                      <div
                                        data-testid="message-delivery-status"
                                        className="mt-1 text-[11.5px] font-medium text-chat-user-foreground/75"
                                        style={{ marginTop: '4px', fontSize: '11.5px', fontWeight: 500, opacity: 0.85 }}
                                      >
                                        delivered
                                      </div>
                                    ) : null}
                                    {m.deliveryStatus === 'steered' ? (
                                      <div
                                        data-testid="message-delivery-status"
                                        className="mt-1 flex items-center gap-1.5 text-[11.5px] font-medium text-chat-user-foreground/75"
                                        style={{ marginTop: '4px', fontSize: '11.5px', fontWeight: 500, opacity: 0.85 }}
                                      >
                                        <span
                                          data-testid="steered-badge"
                                          className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                                        >
                                          steered
                                        </span>
                                      </div>
                                    ) : null}

                                  </div>
                                ) : (
                                  <div
                                    data-testid="message-bot-bubble"
                                    className="max-w-full space-y-2.5 rounded-[20px] bg-muted px-[18px] py-3 text-[15.5px] leading-[1.5] text-foreground/90"
                                    style={{
                                      backgroundColor: 'var(--muted)',
                                      color: 'var(--foreground)',
                                      borderRadius: '20px',
                                      padding: '12px 18px',
                                      fontSize: '15.5px',
                                      lineHeight: 1.5,
                                    }}
                                  >
                                    {showThinking && m.thinking ? (
                                      <ThinkingBlock text={m.thinking} theme={themeMode} />
                                    ) : null}
                                    <div data-quote-message-id={messageId}>
                                      {extractOpenUI(m.content).hasOpenUI ? (
                                        <OpenUIRenderer content={m.content} onAction={handleOpenUIAction} />
                                      ) : (
                                        <ChatMarkdown>{m.content}</ChatMarkdown>
                                      )}
                                    </div>
                                    {m.attachments && m.attachments.length > 0 ? (
                                      <VStack gap={2} align="start" width="100%" style={{ marginTop: '8px' }}>
                                        {m.attachments.map(a => (
                                          <FilePreviewCard key={a.id} attachment={a} />
                                        ))}
                                      </VStack>
                                    ) : null}
                                    {m.blocks && m.blocks.length > 0 ? (
                                      <VStack gap={2} align="start" width="100%" style={{ marginTop: '8px' }}>
                                        {m.blocks.map((block, idx) => {
                                          if (block.kind === 'ask') return <AskCard key={idx} block={block} />;
                                          if (block.kind === 'choice') return <ChoiceCard key={idx} block={block} />;
                                          if (block.kind === 'app_connect') return <AppConnectCard key={idx} block={block} />;
                                          if (block.kind === 'mcp_approval') return <McpApprovalCard key={idx} block={block} />;
                                          if (block.kind === 'chart') return <ChartBlockView key={idx} name={block.name} spec={block.spec} data={block.data} />;
                                          return null;
                                        })}
                                      </VStack>
                                    ) : null}
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
                                  </div>
                                )}

                                <MessageHoverActions
                                  content={m.content}
                                  side={isUser ? 'start' : 'end'}
                                  onReply={() =>
                                    setReplyingToMessage({
                                      sender: isUser ? 'You' : activeBot.name,
                                      text: m.content,
                                    })
                                  }
                                  onReact={(emoji) => handleToggleReaction(i, emoji)}
                                />
                              </div>
                            </div>
                            {m.reactions && Object.entries(m.reactions).some(([_, count]) => count > 0) ? (
                              <div
                                data-testid="message-reactions"
                                style={{
                                  marginTop: '4px',
                                  display: 'flex',
                                  flexWrap: 'wrap',
                                  gap: '4px',
                                  justifyContent: isUser ? 'flex-end' : 'flex-start',
                                }}
                              >
                                {Object.entries(m.reactions).map(([emoji, count]) =>
                                  count > 0 ? (
                                    <span
                                      key={emoji}
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        borderRadius: '9999px',
                                        border: '1px solid var(--border)',
                                        backgroundColor: 'var(--muted)',
                                        padding: '2px 8px',
                                        fontSize: '12px',
                                        cursor: 'pointer',
                                      }}
                                      onClick={() => handleToggleReaction(i, emoji)}
                                    >
                                      {emoji} {count > 1 ? ` ${count}` : ''}
                                    </span>
                                  ) : null,
                                )}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}

                      {/* Live streaming turn in flight */}
                      {isStreaming && (displayed || streamThinking || toolCalls.length > 0) ? (
                        <div
                          data-message-id="progress:live"
                          className="group/message relative hover:z-20"
                          style={{ position: 'relative' }}
                        >
                          <div
                            style={{
                              position: 'relative',
                              display: 'flex',
                              justifyContent: 'flex-start',
                              width: '100%',
                            }}
                          >
                            <div
                              data-testid="message-bubble-frame"
                              className="relative w-fit min-w-0 max-w-[min(88%,calc(100%_-_6rem))] [@media(hover:none)]:max-w-[88%]"
                              style={{
                                position: 'relative',
                                width: 'fit-content',
                                minWidth: 0,
                                maxWidth: 'min(88%, calc(100% - 6rem))',
                              }}
                            >
                              <div
                                className="mb-1.5 flex items-center gap-2 text-[13px] font-semibold tracking-tight"
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px',
                                  marginBottom: '6px',
                                  fontSize: '13px',
                                  fontWeight: 600,
                                  color: activeBot.color || 'var(--foreground)',
                                }}
                              >
                                <BotAvatar
                                  identity={activeBot.id}
                                  color={activeBot.color}
                                  status="working"
                                  size={22}
                                />
                                {activeBot.name}
                              </div>

                              <div
                                data-testid="message-bot-bubble"
                                className="max-w-full space-y-2.5 rounded-[20px] bg-muted px-[18px] py-3 text-[15.5px] leading-[1.5] text-foreground/90"
                                style={{
                                  backgroundColor: 'var(--muted)',
                                  color: 'var(--foreground)',
                                  borderRadius: '20px',
                                  padding: '12px 18px',
                                  fontSize: '15.5px',
                                  lineHeight: 1.5,
                                }}
                              >
                                {showThinking && streamThinking ? (
                                  <ThinkingBlock text={streamThinking} isLive theme={themeMode} />
                                ) : null}
                                {displayed ? (
                                  <ChatMarkdown streaming>{displayed}</ChatMarkdown>
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
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {/* Handoff signals */}
                      {(activeSession?.handoffs ?? []).map((h, i) => (
                        <div
                          key={`handoff-${i}`}
                          className="flex items-center justify-center gap-2 py-1 text-[13.5px] text-muted-foreground"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            padding: '4px 0',
                            fontSize: '13.5px',
                            color: 'var(--muted-foreground)',
                          }}
                        >
                          <Token label={h.from || 'bot'} size="sm" color="blue" />
                          <Text type="supporting">→</Text>
                          <Token label={h.to || 'bot'} size="sm" color="teal" />
                          {h.summary ? <Text type="supporting">{h.summary}</Text> : null}
                          <Timestamp value={new Date(h.at).toISOString()} format="time" />
                        </div>
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
                      </>
                    )}
                  </Transcript>
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
                    setShowCallView(true);
                  }}
                />
              </div>
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
          data-panel={hideRightPanel || (!activeBot && rightPanelMode !== 'create') ? 'closed' : rightPanelMode}
          className="polaris-side-panel"
          style={{
            width: hideRightPanel || (!activeBot && rightPanelMode !== 'create') ? 0 : 384,
            minWidth: hideRightPanel || (!activeBot && rightPanelMode !== 'create') ? 0 : undefined,
            maxWidth: hideRightPanel || (!activeBot && rightPanelMode !== 'create') ? 0 : 384,
          }}
        >
          {!hideRightPanel && (activeBot || rightPanelMode === 'create') ? (
            <div className="rk-scroll" style={{height: '100%', overflowY: 'auto', padding: '16px 20px', boxSizing: 'border-box'}}>
              {rightPanelMode === 'create' ? (
                <CreateBotForm
                  onCancel={() => setHideRightPanel(true)}
                  onFleetChanged={() => void reloadBots()}
                />
              ) : rightPanelMode === 'settings' && activeBot ? (
                <BotSettings
                  bot={activeBot}
                  onClose={() => setRightPanelMode('screen')}
                  onUpdated={() => void reloadBots()}
                  onOpenKnowledge={() => setShowPanel(true)}
                />
              ) : rightPanelMode === 'routine' && activeBot ? (
                <RoutineEditor
                  botId={activeBot.id}
                  botName={activeBot.name}
                  routine={editingRoutine}
                  onBack={() => setRightPanelMode('screen')}
                  onSaved={() => {}}
                  onDeleted={() => {}}
                  onNotify={setBanner}
                />
              ) : activeBot ? (
                <VStack gap={3}>
                  {/* Header */}
                  <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px'}}>
                    <span style={{fontSize: '13.5px', color: 'var(--muted-foreground)', fontWeight: 500}}>
                      {`${activeBot.name}'s screen`}
                    </span>
                    <div style={{display: 'flex', alignItems: 'center', gap: '4px'}}>
                      <IconButton
                        label="Show settings"
                        size="sm"
                        variant="ghost"
                        icon={<IconGear />}
                        onClick={() => setRightPanelMode('settings')}
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

                  {/* Polaris 16:10 Aspect Preview Thumbnail with Hover-Open Overlay */}
                  <div
                    data-testid="computer-preview"
                    className="polaris-computer-preview"
                    style={{
                      position: 'relative',
                      aspectRatio: '16 / 10',
                      overflow: 'hidden',
                      borderRadius: '14px',
                      backgroundColor: 'var(--background)',
                      border: '1px solid var(--border)',
                      width: '100%',
                    }}
                  >
                    {showComputer ? (
                      <div style={{display: 'grid', height: '100%', placeItems: 'center', fontSize: '13.5px', color: 'var(--muted-foreground)'}}>
                        Open in full window
                      </div>
                    ) : miniFrame?.b64 ? (
                      <img
                        src={`data:image/png;base64,${miniFrame.b64}`}
                        alt={`${activeBot.name}'s screen`}
                        style={{width: '100%', height: '100%', objectFit: 'contain', backgroundColor: '#000'}}
                      />
                    ) : (
                      <div style={{display: 'grid', height: '100%', placeItems: 'center', padding: '0 24px', textAlign: 'center', fontSize: '13.5px', color: 'var(--muted-foreground)'}}>
                        {miniFrame?.note || 'Agent computer ready'}
                      </div>
                    )}
                    <button
                      type="button"
                      data-testid="computer-preview-open"
                      className="polaris-computer-preview-open"
                      aria-label="Open"
                      onClick={() => setShowComputer(true)}
                    >
                      <span className="polaris-computer-preview-pill">
                        <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <polyline points="15 3 21 3 21 9" />
                          <polyline points="9 21 3 21 3 15" />
                          <line x1="21" y1="3" x2="14" y2="10" />
                          <line x1="3" y1="21" x2="10" y2="14" />
                        </svg>
                        <span>Open</span>
                      </span>
                    </button>
                  </div>

                  <div style={{marginTop: '4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
                    <p style={{margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '13.5px', color: 'var(--muted-foreground)'}} dir="auto">
                      {`${activeBot.name}'s screen`}
                    </p>
                    <ComputerMaintenanceActions
                      botId={activeBot.id}
                      onChanged={async () => {
                        const f = await getComputerFrame(activeBot.id);
                        setMiniFrame(f);
                      }}
                    />
                  </div>

                  {/* Polaris Routines Section */}
                  <Divider />
                  <RoutinesList
                    botId={activeBot.id}
                    botName={activeBot.name}
                    onNotify={setBanner}
                    onCreateRoutine={() => {
                      setEditingRoutine(null);
                      setRightPanelMode('routine');
                    }}
                    onOpenRoutine={routine => {
                      setEditingRoutine(routine);
                      setRightPanelMode('routine');
                    }}
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
              ) : null}
            </div>
          ) : null}
        </aside>

        {/* ── Dialogs and Modals ── */}
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
        {showPlugins ? (
          <PluginsOverlay
            onClose={() => setShowPlugins(false)}
            onOpenMcp={() => setShowMcp(true)}
            bots={bots}
            activeBotId={activeBotId}
          />
        ) : null}
        {showMcp ? (
          <McpServersOverlay
            onClose={() => setShowMcp(false)}
            bots={bots}
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
        {clearTarget ? (
          <ClearConversationDialog
            bot={clearTarget}
            onCancel={() => setClearTarget(null)}
            onConfirm={async () => {
              if (activeBotId === clearTarget.id) {
                stop();
              }
              setSessions(prev =>
                prev.map(s => (s.botId === clearTarget.id ? {...s, messages: []} : s))
              );
              setBanner(`Cleared conversation with ${clearTarget.name}.`);
              setClearTarget(null);
            }}
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
        {showSettings ? (
          <SettingsOverlay
            initialSection={settingsSection}
            onClose={() => setShowSettings(false)}
            userName="Ali"
            email="ali@balacode.xyz"
            onFleetChanged={() => void reloadBots()}
          />
        ) : null}
        {showCallView && activeBot ? (
          <CallView
            botId={activeBot.id}
            botName={activeBot.name}
            isStreaming={isStreaming}
            streamText={streamText}
            lastBotReply={activeSession?.messages?.filter(m => m.role === 'assistant')?.slice(-1)[0]?.content}
            onSend={async (text: string) => {
              await send(text);
            }}
            onClose={() => setShowCallView(false)}
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
            if (action === 'new-bot') {
              setRightPanelMode('create');
              setHideRightPanel(false);
            } else if (action === 'new-group') {
              setActiveGroupId(null);
              setShowGroups(true);
            } else if (action === 'open-skills') setShowSkills(true);
            else if (action === 'open-computer') setShowComputer(true);
            else if (action === 'nav-agents' || action === 'nav-fleet' || action === 'agents' || action === 'fleet') {
              setScreen('agents');
              navigateTo('/app/fleet');
            } else if (action === 'nav-memory' || action === 'memory') {
              setScreen('memory');
              navigateTo('/app/memory');
            } else if (action === 'nav-decisions' || action === 'decisions') {
              setScreen('decisions');
              navigateTo('/app/decisions');
            } else if (action === 'nav-governance' || action === 'governance') {
              setScreen('governance');
              navigateTo('/app/governance');
            } else if (action === 'nav-ops' || action === 'ops') {
              setScreen('ops');
              navigateTo('/app/ops');
            } else if (action === 'nav-cost' || action === 'cost') {
              setScreen('cost');
              navigateTo('/app/cost');
            } else if (action === 'nav-artifacts' || action === 'artifacts') {
              navigateTo('/app/artifacts');
            } else if (action === 'toggle-theme') handleSetTheme(themeMode === 'light' ? 'dark' : 'light');
          }}
        />
      </div>
    </Theme>
  );
}
