import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {AppShell} from '@astryxdesign/core/AppShell';
import {TopNav, TopNavHeading} from '@astryxdesign/core/TopNav';
import {SideNav, SideNavSection, SideNavItem, SideNavHeading} from '@astryxdesign/core/SideNav';
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
import {Icon} from '@astryxdesign/core/Icon';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Button} from '@astryxdesign/core/Button';
import {HStack} from '@astryxdesign/core/Stack';
import {VStack} from '@astryxdesign/core/VStack';
import {Text} from '@astryxdesign/core/Text';
import {Token} from '@astryxdesign/core/Token';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Markdown} from '@astryxdesign/core/Markdown';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Layout} from '@astryxdesign/core/Layout';
import {LayoutHeader} from '@astryxdesign/core/Layout';
import {LayoutContent} from '@astryxdesign/core/Layout';
import {LayoutPanel} from '@astryxdesign/core/Layout';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Composer} from './Composer';
import {BotPanelDialog} from './BotPanelDialog';
import {SessionsDialog} from './SessionsDialog';
import {AgentComputerDialog} from './AgentComputerDialog';
import {SecretRequestCard} from './SecretRequestCard';
import {SkillLibraryDialog} from './SkillLibraryDialog';
import {GroupChatDialog} from './GroupChatDialog';
import {BotCreationDialog} from './BotCreationDialog';
import {BotEditDialog} from './BotEditDialog';
import {BotDeleteDialog} from './BotDeleteDialog';
import {OrphansDialog} from './OrphansDialog';
import {useMediaQuery} from '@astryxdesign/core/hooks';
import {useResizable, ResizeHandle} from '@astryxdesign/core/Resizable';
import {MoreMenu} from '@astryxdesign/core/MoreMenu';
import {Divider} from '@astryxdesign/core/Divider';
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
import {
  api,
  streamChat,
  checkHealth,
  getFleet,
  getSubAgents,
  getSessions,
  getServerSession,
  createServerSession,
  deleteServerSession,
  getGroups,
  postGroupTurn,
  getSkillLibrary,
  getComputerFrame,
  updateBot,
  createBotProposal,
  getActiveIntervention,
  endInterventionTurn,
  type Bot,
  type ChatMessage,
  type Handoff,
  type JevCarrier,
  type Session,
  type SecretCard,
  type SubAgent,
  type ToolProgress,
  type SessionsResponse,
  type Attachment,
  type Group,
  type SkillEntry,
  type ComputerFrame,
  type InterventionPayload,
  type DraftCardData,
  type VoiceMemoData,
} from './api';
import {
  IconAgentComputer,
  IconAgents,
  IconFile,
  IconBotKnowledge,
  IconClose,
  IconCollapsePanel,
  IconConversations,
  IconExpandPanel,
  IconCost,
  IconCreateBot,
  IconDecisions,
  IconGovernance,
  IconGroupChat,
  IconMemory,
  IconMessages,
  IconOps,
  IconOrphans,
  IconSkills,
  IconWarning,
  IconGear,
  IconMicrophone,
  IconPin,
  IconAdd,
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
}: {
  text: string;
  isLive?: boolean;
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
            <ThinkingOrb state="working" size={32} theme="dark" />
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

// Onboarding is a conversation, not a wizard (Grok Bot spec).
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
  const [excluded, setExcluded] = useState<string[]>([]);
  const [pinnedBotIds, setPinnedBotIds] = useState<string[]>(() => loadPinnedBots());
  const [hiddenBotIds, setHiddenBotIds] = useState<string[]>(() => loadHiddenBots());
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [interventions, setInterventions] = useState<InterventionPayload[]>([]);
  const [activeIntervention, setActiveIntervention] = useState<InterventionPayload | null>(null);
  const [replyingToMessage, setReplyingToMessage] = useState<{sender: string; text: string} | null>(null);
  const [draftCards, setDraftCards] = useState<DraftCardData[]>([]);
  const [voiceMemos, setVoiceMemos] = useState<VoiceMemoData[]>([]);
  const [rightPanelMode, setRightPanelMode] = useState<'screen' | 'settings'>('screen');
  const [hideRightPanel, setHideRightPanel] = useState(false);
  const [miniFrame, setMiniFrame] = useState<ComputerFrame | null>(null);
  const [editName, setEditName] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  // Live sub-agent rows (real spawn ledger). Polled so the roster reflects
  // spawns as they start and stop; never invented client-side.
  const [subagents, setSubagents] = useState<SubAgent[]>([]);
  const [banner, setBanner] = useState('');
  const [secretCards, setSecretCards] = useState<SecretCard[]>([]);
  // Tool activity for the turn in flight. Mirrored into a ref because send()
  // must read the final list after the stream resolves, not a stale closure.
  const [toolCalls, setToolCalls] = useState<ToolProgress[]>([]);
  // Agent reasoning ("thinking"): OFF by default — the user opts in when they
  // want to see how the AI reasoned. The choice persists across reloads.
  const [showThinking, setShowThinking] = useState<boolean>(() => loadShowThinking());
  const [streamThinking, setStreamThinking] = useState('');
  const thinkingRef = useRef('');
  const toolCallsRef = useRef<ToolProgress[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  // Jev USER-message carriers emitted during THIS turn's stream. Cleared at
  // send, collected during streaming, attached to the final assistant message.
  const jevCarriersRef = useRef<JevCarrier[]>([]);


  // Astryx's responsive contract: above 1024px the third region (the rosters and
  // detail panels) has room; below it, it is dropped rather than squeezed, and
  // the nav collapses to MobileNav at the shell's own breakpoint.
  const isNarrow = useMediaQuery('(max-width: 1024px)');

  // The bot list is drag-resizable and fully collapsible, using the framework's
  // own useResizable (snap points + collapse past the min + persistence) rather
  // than a hand-rolled drawer. On a phone the roster otherwise eats the width the
  // thread needs, and the thread is the thing you actually came to use.
  const roster = useResizable({
    defaultSize: 300,
    minSize: 200,
    maxSize: 460,
    collapsible: true,
    snaps: [240, 300, 380],
    autoSaveId: 'balabot.roster',
  });

  // Load bots + fleet + health
  const reloadBots = useCallback(async () => {
    try {
      // Fleet discipline: never render or request excluded profiles.
      // Nothing alarming is shown for them — they are simply absent.
      try {
        const fleet = await getFleet();
        setExcluded(fleet.excluded ?? []);
        const excludedSet = new Set(fleet.excluded ?? []);
        const raw = await api<{bots: Bot[]}>('/api/bots');
        const sorted = [...(raw.bots ?? [])]
          .filter(b => !excludedSet.has(b.id))
          .sort((a, b) => a.order - b.order);
        setBots(sorted);
        const last = loadLastBot();
        setActiveBotId(last && sorted.some(b => b.id === last) ? last : sorted[0]?.id ?? null);
      } catch {
        // /api/fleet missing — fall back to plain bot list.
        const r = await api<{bots: Bot[]}>('/api/bots');
        const sorted = [...(r.bots ?? [])].sort((a, b) => a.order - b.order);
        setBots(sorted);
        const last = loadLastBot();
        setActiveBotId(last && sorted.some(b => b.id === last) ? last : sorted[0]?.id ?? null);
      }
    } catch {
      setBanner('Could not load bots from the API.');
    }
  }, []);

  useEffect(() => {
    void reloadBots();
  }, [reloadBots]);

  // After an edit, refresh the roster so renamed titles show everywhere.
  const onBotEdited = useCallback(
    (_botId: string) => {
      void reloadBots();
    },
    [reloadBots],
  );

  // After a delete, refresh the roster.
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

  // Mobile share-sheet intake (8.4)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const title = params.get('share_title');
    const text = params.get('share_text');
    const url = params.get('share_url');
    if (title || text || url) {
      setBanner(`Mobile share intake: ${title || url || 'shared content'} imported.`);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // Poll/fetch active intervention for the active bot (Priority 1)
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


  // Poll live Agent Computer mini screen frame for the active bot
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
        if (roster.isCollapsed) roster.expand();
        else roster.collapse();
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
          setActiveBotId(visibleBots[idx].id);
          setActiveGroupId(null);
          setActiveSessionId(null);
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
          setActiveBotId(visibleBots[nextIdx].id);
          setActiveGroupId(null);
          setActiveSessionId(null);
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
          setActiveBotId(visibleBots[nextIdx].id);
          setActiveGroupId(null);
          setActiveSessionId(null);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [bots, hiddenBotIds, activeBotId, roster]);


  // Poll the real spawn ledger via /api/subagents. An empty list is a real
  // answer (nothing spawned); a failed fetch just leaves the last state.
  useEffect(() => {
    let live = true;
    const tick = () => {
      getSubAgents()
        .then(r => {
          if (live && r.available !== false) setSubagents(r.subagents ?? []);
        })
        .catch(() => {/* transient — keep last honest state */});
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

  // SERVER-BACKED CONVERSATIONS: the server's SQLite store (balabot.sessions)
  // is the source of truth for the conversation register — fetch it whenever
  // the active bot changes. localStorage stays only as an offline cache
  // (saveSessions below); when the server is honestly unavailable the cache
  // is what renders, and nothing is invented client-side.
  useEffect(() => {
    if (!activeBotId) return;
    let live = true;
    void syncSessionsFromServer(activeBotId, setSessions).then(res => {
      if (!live) return;
      if (res && res.available === false) {
        // Named reason, not a silent empty list.
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
    // Onboarding conversation: the bot opens, not the user.
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
          // SSE secret frames: render the in-chat card. Only the NAME arrives
          // here — the value is typed by the human and POSTed client-side.
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
          // Real tool activity from `hermes.tool.progress`. Merge on toolCallId:
          // the gateway sends the same call twice (running, then completed).
          toolCallsRef.current = mergeToolProgress(toolCallsRef.current, t);
          setToolCalls(toolCallsRef.current);
        },
        r => {
          // The agent's private reasoning stream arrives on its own channel
          // (`delta.reasoning_content`) and is buffered separately from the
          // answer — it is never merged into the visible reply text.
          thinkingRef.current = r;
          setStreamThinking(r);
        },
        (c: JevCarrier) => {
          // Jev's cache-safe carrier: a USER-message ride rendered as a
          // signal row in the transcript. The system prompt is never touched.
          jevCarriersRef.current = [...jevCarriersRef.current, c];
        },
        e => {
          // A stated Jev degrade — why no signal rode this turn. Never silent.
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
      const finalMsg: ChatMessage = {
        role: 'assistant',
        content: parsedDrafts.cleanContent,
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
      const partial = streamTextRef.current;
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
      abortRef.current = null;
      if (activeIntervention?.resume_token && activeIntervention.state === 'pending') {
        void endInterventionTurn(activeIntervention.resume_token)
          .then(res => {
            if (res?.record) setActiveIntervention(res.record);
          })
          .catch(() => {});
      }
    }
  };

  // Keep a ref of streamText so send() can read it after the async loop.
  const streamTextRef = useRef('');
  streamTextRef.current = streamText;

  // Smooth bursty tokens into a steady character reveal via useStreamingText.
  const displayed = useStreamingText(streamText, isStreaming);

  const filteredBots = bots.filter(b =>
    b.name.toLowerCase().includes(rosterQuery.toLowerCase()),
  );

  const sideNav = (
    <SideNav>
      <SideNavHeading heading="BalaBot" subheading="Your bot roster" />
      <SideNavSection title="Chat">
        <SideNavItem
          label="Messages"
          isSelected={screen === 'chat'}
          icon={<IconMessages />}
          onClick={() => setScreen('chat')}
        />
        <SideNavItem
          label="Group chat"
          icon={<IconGroupChat />}
          onClick={() => setShowGroups(true)}
        />
        <SideNavItem
          label="Unregistered profiles"
          icon={<IconOrphans />}
          onClick={() => setShowOrphans(true)}
        />
      </SideNavSection>
      <SideNavSection title="Control">
        <SideNavItem
          label="Agents"
          isSelected={screen === 'agents'}
          icon={<IconAgents />}
          onClick={() => setScreen('agents')}
        />
        <SideNavItem
          label="Memory"
          isSelected={screen === 'memory'}
          icon={<IconMemory />}
          onClick={() => setScreen('memory')}
        />
        <SideNavItem
          label="Decisions"
          isSelected={screen === 'decisions'}
          icon={<IconDecisions />}
          onClick={() => setScreen('decisions')}
        />
        <SideNavItem
          label="Governance"
          isSelected={screen === 'governance'}
          icon={<IconGovernance />}
          onClick={() => setScreen('governance')}
        />
        <SideNavItem
          label="Ops"
          isSelected={screen === 'ops'}
          icon={<IconOps />}
          onClick={() => setScreen('ops')}
        />
        <SideNavItem
          label="Cost & usage"
          isSelected={screen === 'cost'}
          icon={<IconCost />}
          onClick={() => setScreen('cost')}
        />
      </SideNavSection>
      <SideNavSection title="Sessions">
        <SideNavItem
          label="Conversations"
          icon={<IconConversations />}
          onClick={() => setShowSessions(true)}
        />
      </SideNavSection>
    </SideNav>
  );

  const topNav = (
    <TopNav
      label="BalaBot top navigation"
      heading={
        <TopNavHeading
          heading="BalaBot"
          subheading={
            screen === 'chat'
              ? activeBot
                ? `${activeBot.icon} ${activeBot.title}`
                : 'Loading…'
              : screen.charAt(0).toUpperCase() + screen.slice(1)
          }
        />
      }
      endContent={
        <HStack gap={2} vAlign="center">
          <Button
            label="Jump (Ctrl+K)"
            size="sm"
            variant="ghost"
            icon={<IconSearch />}
            onClick={() => setShowCommandPalette(true)}
          />
          {/* Diagnosis toggle: reveals the agent's reasoning stream. Off by
              default; the choice is persisted so it survives a reload. */}
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
            label="Conversations"
            size="sm"
            variant="ghost"
            icon={<IconConversations />}
            onClick={() => setShowSessions(true)}
          />
          <IconButton
            label="Skill library"
            size="sm"
            variant="ghost"
            icon={<IconSkills />}
            onClick={() => setShowSkills(true)}
          />
          <IconButton
            label="Group chat"
            size="sm"
            variant="ghost"
            icon={<IconGroupChat />}
            onClick={() => setShowGroups(true)}
          />
          <IconButton
            label="Create a bot (with consent)"
            size="sm"
            variant="ghost"
            icon={<IconCreateBot />}
            onClick={() => setShowBotCreation(true)}
          />
          {activeBot ? (
            <IconButton
              label={`${activeBot.name} memory & knowledge`}
              size="sm"
              variant="ghost"
              icon={<IconBotKnowledge />}
              onClick={() => setShowPanel(true)}
            />
          ) : null}
          {activeBot ? (
            <IconButton
              label="Agent computer"
              size="sm"
              variant="ghost"
              icon={<IconAgentComputer />}
              onClick={() => setShowComputer(true)}
            />
          ) : null}
          {activeBot ? (
            <IconButton
              label={rightPanelMode === 'settings' ? 'Show live screen' : `${activeBot.name} settings`}
              size="sm"
              variant={rightPanelMode === 'settings' ? 'primary' : 'ghost'}
              icon={<IconGear />}
              onClick={() => {
                setRightPanelMode(prev => (prev === 'settings' ? 'screen' : 'settings'));
                setHideRightPanel(false);
              }}
            />
          ) : null}
          {activeBot ? (
            <IconButton
              label={hideRightPanel ? 'Expand right panel' : 'Collapse right panel'}
              size="sm"
              variant="ghost"
              icon={hideRightPanel ? <IconExpandPanel /> : <IconCollapsePanel />}
              onClick={() => setHideRightPanel(prev => !prev)}
            />
          ) : null}
        </HStack>
      }
    />
  );

  // ── Chat screen: roster column + thread + live-screen context panel ──
  const chatScreen = (
    <Layout
      height="fill"
      start={
        <>
          <LayoutPanel
            width={roster.isCollapsed ? 44 : roster.size}
            hasDivider
            label="Bot roster"
            padding={2}
          >
            {roster.isCollapsed ? (
              <VStack gap={2} align="center">
                <IconButton
                  label="Show bot list"
                  size="sm"
                  variant="ghost"
                  icon={<IconExpandPanel />}
                  onClick={() => roster.expand()}
                />
              </VStack>
            ) : (
              <VStack gap={2} height="100%">
                <HStack gap={1} vAlign="center" justify="between">
                  <TextInput
                    ref={searchInputRef}
                    label="Search bots"
                    isLabelHidden
                    placeholder="Search bots… (Ctrl+Shift+F)"
                    value={rosterQuery}
                    onChange={setRosterQuery}
                    type={"search" as any}
                    size="sm"
                    width={`${Math.max(100, roster.size - 90)}px`}
                  />
                  <HStack gap={1} vAlign="center">
                    <IconButton
                      label="New bot or group"
                      size="sm"
                      variant="ghost"
                      icon={<IconCreateBot />}
                      onClick={() => setShowBotCreation(true)}
                    />
                    <IconButton
                      label="Collapse bot list"
                      size="sm"
                      variant="ghost"
                      icon={<IconCollapsePanel />}
                      onClick={() => roster.collapse()}
                    />
                  </HStack>
                </HStack>
                <div style={{flex: 1, minHeight: 0, overflowY: 'auto'}}>
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
                    }}
                    onSelectGroup={gid => {
                      setActiveGroupId(gid);
                      setShowGroups(true);
                    }}
                    onTogglePin={onTogglePin}
                    onToggleHide={onToggleHide}
                    onDuplicateBot={onDuplicateBot}
                    onEditBot={setEditBot}
                    onDeleteBot={setDeleteBotTarget}
                  />
                </div>
                <Divider />
                <HStack gap={2} vAlign="center" justify="between" paddingBlock={1}>
                  <Button
                    label="Plugins"
                    size="sm"
                    variant="ghost"
                    icon={<IconSkills />}
                    onClick={() => setShowSkills(true)}
                  />
                  <HStack gap={1} vAlign="center">
                    <Avatar name="Ali" size="sm" tooltip={false} />
                    <Text type="supporting" size="sm" weight="medium">Ali</Text>
                  </HStack>
                </HStack>
              </VStack>
            )}
          </LayoutPanel>
          <ResizeHandle
            direction="horizontal"
            hasDivider
            resizable={roster.props}
            label="Resize bot list"
          />
        </>
      }
      content={
        activeBot ? (
          // ChatLayout's `flex: 1` is inert unless its parent is a flex
          // container — the LayoutContent the `content` slot renders is
          // display:block, so without this wrapper the chat box simply took its
          // content height (measured 2673px inside a 736px parent) and the
          // composer rode off the bottom of the screen. The framework's own
          // ai-chat template wraps its ChatLayout the same way.
          <HStack height="100%">
            <VStack style={{flex: 1, minHeight: 0, height: '100%'}} gap={0}>
              {/* Active Bot Transcript Header with Hold everything control */}
              <HStack
                gap={2}
                vAlign="center"
                justify="between"
                paddingInline={3}
                paddingBlock={2}
                style={{
                  borderBottom: '1px solid var(--border-default, rgba(255, 255, 255, 0.1))',
                  backgroundColor: 'var(--surface-default, #121214)',
                }}
              >
                <HStack gap={2} vAlign="center">
                  <Avatar name={activeBot.name} size="sm" tooltip={false} />
                  <VStack gap={0} align="start">
                    <Text type="body" weight="semibold">
                      {activeBot.name}
                    </Text>
                    <Text type="supporting" size="xsm" color="secondary">
                      {activeBot.title || activeBot.description?.slice(0, 45) || 'Active'}
                    </Text>
                  </VStack>
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
                </HStack>

                {/* GrokBot Pause / Hold Everything Control */}
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
              </HStack>

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
                      onClick={() => void send(p)}>
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
                    }>
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
                      }>
                      {isUser ? (
                        <VStack gap={1} align="start">
                          {m.replyTo ? (
                            <HStack
                              gap={1}
                              paddingInline={2}
                              paddingBlock={1}
                              style={{
                                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                                borderLeft: '2px solid var(--accent, #6366f1)',
                                borderRadius: 'var(--radius-sm, 4px)',
                                marginBottom: '2px',
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
                        <VStack gap={2}>
                          {showThinking && m.thinking ? (
                            <ThinkingBlock text={m.thinking} />
                          ) : null}
                          {m.toolCalls?.length ? (
                            <ChatToolCalls
                              calls={m.toolCalls.map(t => ({
                                key: t.toolCallId,
                                name: t.tool,
                                target: t.label,
                                status: toToolCallStatus(t.status),
                              }))}
                            />
                          ) : null}
                          {m.attachments && m.attachments.length > 0 ? (
                            <VStack gap={2} align="start" width="100%">
                              {m.attachments.map(a => (
                                <FilePreviewCard key={a.id} attachment={a} />
                              ))}
                            </VStack>
                          ) : null}
                          {m.interventions?.map((iv, idx) => (
                            <InterventionCard
                              key={iv.resume_token || idx}
                              intervention={iv}
                              onOpenComputer={() => setShowComputer(true)}
                              onResolved={() => {
                                setBanner('Intervention resolved — bot resuming.');
                                setActiveIntervention(null);
                              }}
                            />
                          ))}
                          {m.drafts?.map(draft => (
                            <DraftCard
                              key={draft.id}
                              draft={draft}
                              onSend={updated => {
                                setBanner(`${updated.kind === 'email' ? 'Email' : 'Slack message'} sent!`);
                              }}
                              onDiscard={id => {
                                setBanner('Draft discarded.');
                              }}
                            />
                          ))}
                          {m.voiceMemos?.map(memo => (
                            <VoiceMemoCard key={memo.id} memo={memo} />
                          ))}
                          <Markdown isStreaming={false}>{m.content}</Markdown>
                        </VStack>
                      )}
                    </ChatMessageBubble>
                      {/* Reactions and Reply-in-Thread action with MessageHoverMetadata */}
                      <MessageHoverMetadata
                        side={isUser ? 'start' : 'end'}
                        pinned={Object.values(m.reactions || {}).some(c => c > 0)}
                      >
                        <HStack gap={1} vAlign="center" wrap="wrap" style={{paddingInline: '4px'}}>
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
              {isStreaming ? (
                <ChatMessageRow
                  sender="assistant"
                  avatar={<Avatar name={activeBot.name} size="md" tooltip={false} />}>
                  <ChatMessageBubble
                    variant="ghost"
                    name={
                      <Text type="supporting" weight="semibold" color="secondary">
                        {activeBot.name}
                      </Text>
                    }>
                    <VStack gap={2}>
                      {showThinking && streamThinking ? (
                        <ThinkingBlock text={streamThinking} isLive />
                      ) : null}
                      {toolCalls.length ? (
                        <ChatToolCalls
                          calls={toolCalls.map(t => ({
                            key: t.toolCallId,
                            name: t.tool,
                            target: t.label,
                            status: toToolCallStatus(t.status),
                          }))}
                        />
                      ) : null}
                      <Markdown isStreaming>{displayed}</Markdown>
                    </VStack>
                  </ChatMessageBubble>
                </ChatMessageRow>
              ) : null}
              {isStreaming && !displayed ? (
                <ChatMessageRow
                  sender="assistant"
                  avatar={<Avatar name={activeBot.name} size="md" tooltip={false} />}>
                  <ChatMessageBubble variant="ghost">
                    {/* The agent is running but has not emitted text yet. A
                        thinking orb says "working" far better than the word
                        "Typing…", and `state` is a real signal here: the bot is
                        executing, not typing. theme is PINNED dark rather than
                        left on auto — the app tags <html> with
                        data-astryx-theme, not data-theme, so auto would fall
                        through to prefers-color-scheme and paint dark ink on our
                        always-black surface for anyone in light mode. */}
                    <ThinkingOrb
                      state={orbStateForTool(activeTool(toolCalls)?.tool)}
                      size={32}
                      theme="dark"
                      aria-label={
                        activeTool(toolCalls)
                          ? `${activeBot.name} is running ${activeTool(toolCalls)!.tool}${
                              activeTool(toolCalls)!.label
                                ? `: ${activeTool(toolCalls)!.label}`
                                : ''
                            }`
                          : `${activeBot.name} is working`
                      }
                    />
                  </ChatMessageBubble>
                </ChatMessageRow>
              ) : null}
              {(activeSession?.handoffs ?? []).map((h, i) => (
                <ChatMessageRow
                  key={`handoff-${i}`}
                  sender="system"
                  avatar={<Avatar name={`${h.from}→${h.to}`} size="md" tooltip={false} />}>
                  <HStack gap={2} vAlign="center" wrap="wrap">
                    <Token label={h.from || 'bot'} size="sm" color="blue" />
                    <Text type="supporting">→</Text>
                    <Token label={h.to || 'bot'} size="sm" color="teal" />
                    {h.summary ? <Text type="supporting">{h.summary}</Text> : null}
                    <Timestamp value={new Date(h.at).toISOString()} format="time" />
                  </HStack>
                </ChatMessageRow>
              ))}
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
              {voiceMemos.map(memo => (
                <VoiceMemoCard key={memo.id} memo={memo} />
              ))}
            </ChatMessageList>
            </ChatLayout>
          </VStack>
        </HStack>
        ) : (
          <EmptyState title="No bots loaded" description="Waiting on /api/bots…" />
        )
      }
      end={
        // Responsive contract (>1024: nav | roster | thread | live panel;
        // <=1024: the live panel is dropped, not squeezed — its content opens on
        // demand from the top-bar "Agent computer" button.
        isNarrow || hideRightPanel ? undefined : activeBot ? (
          <LayoutPanel
            width={320}
            hasDivider
            label={rightPanelMode === 'settings' ? `${activeBot.name} settings` : "Live screen"}
            padding={3}
          >
            {rightPanelMode === 'settings' ? (
              <VStack gap={3}>
                <HStack gap={2} vAlign="center" justify="between">
                  <HStack gap={2} vAlign="center">
                    <Avatar name={activeBot.name} size="sm" tooltip={false} />
                    <Text type="body" weight="semibold">
                      Bot Settings
                    </Text>
                  </HStack>
                  <IconButton
                    label="Back to screen"
                    size="sm"
                    variant="ghost"
                    icon={<IconClose />}
                    onClick={() => setRightPanelMode('screen')}
                  />
                </HStack>
                <Divider />
                <TextInput
                  label="Bot Name"
                  value={editName}
                  onChange={setEditName}
                  size="sm"
                />
                <TextInput
                  label="Title / Role"
                  value={editTitle}
                  onChange={setEditTitle}
                  size="sm"
                />
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
                      padding: '8px',
                      fontFamily: 'inherit',
                      fontSize: '13px',
                      backgroundColor: 'var(--surface-sunken, rgba(255, 255, 255, 0.05))',
                      color: 'inherit',
                      border: '1px solid var(--border-default, rgba(255, 255, 255, 0.15))',
                      borderRadius: 'var(--radius-md, 6px)',
                      resize: 'vertical',
                    }}
                  />
                </VStack>
                <HStack gap={2}>
                  <Button
                    label={savingSettings ? "Saving…" : "Save changes"}
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
              </VStack>
            ) : (
              <VStack gap={3}>
                <HStack gap={2} vAlign="center" justify="between">
                  <HStack gap={2} vAlign="center">
                    <Avatar name={activeBot.name} size="sm" tooltip={false} />
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
                          borderRadius: 'var(--radius-sm, 4px)',
                          cursor: 'pointer',
                        }}
                        onClick={() => setShowComputer(true)}
                      />
                    ) : (
                      <VStack gap={2} paddingBlock={3} align="center">
                        <IconAgentComputer size="md" color="secondary" />
                        <Text type="supporting" size="xsm">
                          {miniFrame?.note || "Agent computer ready"}
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
          </LayoutPanel>
        ) : null
      }
    />
  );

  return (
    <AppShell
      topNav={topNav}
      sideNav={sideNav}
      mobileNav={{breakpoint: 'md'}}
      height="fill"
      contentPadding={0}
    >
      {banner ? (
        <HStack gap={2} padding={3} vAlign="center" wrap="wrap">
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
      {screen === 'chat' ? chatScreen : null}
      {screen === 'agents' ? <AgentsScreen /> : null}
      {screen === 'memory' ? <MemoryScreen /> : null}
      {screen === 'decisions' ? <DecisionsScreen /> : null}
      {screen === 'governance' ? <GovernanceScreen /> : null}
      {screen === 'ops' ? <OpsScreen /> : null}
      {screen === 'cost' ? <CostScreen /> : null}
      {showSessions ? (
        <SessionsDialog
          botId={activeBotId ?? ''}
          sessions={sessions.filter(s => s.botId === activeBotId)}
          activeId={activeSessionId}
          onSwitch={setActiveSessionId}
          onDelete={id => {
            // Server is the source of truth: DELETE /api/sessions/{id} first;
            // only a successful delete removes it locally. A failed call keeps
            // the row and names the error rather than pretending it worked.
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
            // A new conversation MUST carry a real botId (an empty one made
            // sessions unreachable/unlistable). Create it server-side; the
            // returned row — with its server id and purpose — enters state.
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
      <CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        bots={bots}
        groups={groups}
        sessions={sessions}
        onSelectBot={id => {
          setActiveBotId(id);
          setActiveGroupId(null);
          setActiveSessionId(null);
          setScreen('chat');
        }}
        onSelectGroup={gid => {
          setActiveGroupId(gid);
          setShowGroups(true);
        }}
        onSelectSession={(sid, botId) => {
          setActiveBotId(botId);
          setActiveGroupId(null);
          setActiveSessionId(sid);
          setScreen('chat');
        }}
        onAction={action => {
          if (action === 'new-bot') setShowBotCreation(true);
          else if (action === 'new-group') {
            setActiveGroupId(null);
            setShowGroups(true);
          } else if (action === 'open-skills') setShowSkills(true);
          else if (action === 'open-computer') setShowComputer(true);
          else if (action === 'nav-agents') setScreen('agents');
          else if (action === 'nav-memory') setScreen('memory');
          else if (action === 'nav-decisions') setScreen('decisions');
          else if (action === 'nav-governance') setScreen('governance');
          else if (action === 'nav-ops') setScreen('ops');
          else if (action === 'nav-cost') setScreen('cost');
        }}
      />
    </AppShell>
  );
}
