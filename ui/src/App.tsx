import {useEffect, useMemo, useRef, useState} from 'react';
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
import {useMediaQuery} from '@astryxdesign/core/hooks';
import {useResizable, ResizeHandle} from '@astryxdesign/core/Resizable';
import {BotRoster} from './screens/BotRoster';
import {AgentsScreen} from './screens/AgentsScreen';
import {MemoryScreen} from './screens/MemoryScreen';
import {DecisionsScreen} from './screens/DecisionsScreen';
import {GovernanceScreen} from './screens/GovernanceScreen';
import {OpsScreen} from './screens/OpsScreen';
import {CostScreen} from './screens/CostScreen';
import {api, streamChat, checkHealth, getFleet, type Bot, type ChatMessage, type Handoff, type Session, type SecretCard, type ToolProgress} from './api';
import {
  IconAgentComputer,
  IconAgents,
  IconBotKnowledge,
  IconClose,
  IconCollapsePanel,
  IconConversations,
  IconExpandPanel,
  IconCost,
  IconDecisions,
  IconGovernance,
  IconMemory,
  IconMessages,
  IconOps,
  IconSkills,
  IconWarning,
} from './icons';
import {loadSessions, saveSessions, loadLastBot, saveLastBot, newSession} from './sessions';

/** Opening suggestions shown on the empty state. */
const PROMPTS = [
  'What are you working on right now?',
  'Summarize where things stand',
  'What needs my decision?',
];

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
  const [excluded, setExcluded] = useState<string[]>([]);
  const [banner, setBanner] = useState('');
  const [secretCards, setSecretCards] = useState<SecretCard[]>([]);
  // Tool activity for the turn in flight. Mirrored into a ref because send()
  // must read the final list after the stream resolves, not a stale closure.
  const [toolCalls, setToolCalls] = useState<ToolProgress[]>([]);
  const toolCallsRef = useRef<ToolProgress[]>([]);
  const abortRef = useRef<AbortController | null>(null);

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
  useEffect(() => {
    void (async () => {
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
    })();
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

  const send = async (text: string) => {
    if (!activeBot) return;
    const session = ensureSession(activeBot);
    const userMsg: ChatMessage = {role: 'user', content: text, at: Date.now()};
    const history = [...session.messages, userMsg];

    patchSession(session.id, s => ({...s, messages: history, title: s.messages.length === 0 ? text.slice(0, 40) : s.title}));
    setStreamText('');
    setToolCalls([]);
    toolCallsRef.current = [];
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
      );
      const finalMsg: ChatMessage = {
        role: 'assistant',
        content: finalText,
        at: Date.now(),
        toolCalls: toolCallsRef.current.length ? toolCallsRef.current : undefined,
      };
      patchSession(session.id, s => ({...s, messages: [...s.messages, finalMsg]}));
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
                <HStack gap={1} vAlign="center">
                  <TextInput
                    label="Search bots"
                    isLabelHidden
                    placeholder="Search bots…"
                    value={rosterQuery}
                    onChange={setRosterQuery}
                    size="sm"
                    width={`${Math.max(120, roster.size - 60)}px`}
                  />
                  <IconButton
                    label="Collapse bot list"
                    size="sm"
                    variant="ghost"
                    icon={<IconCollapsePanel />}
                    onClick={() => roster.collapse()}
                  />
                </HStack>
                <BotRoster
                  bots={filteredBots}
                  activeBotId={activeBotId}
                  sessions={sessions}
                  isStreaming={isStreaming}
                  onSelect={id => {
                    setActiveBotId(id);
                    setActiveSessionId(null);
                    setScreen('chat');
                  }}
                />
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
            <ChatLayout
              style={{flex: 1, minHeight: 0}}
              composer={
              <Composer
                isStreaming={isStreaming}
                onSubmit={text => void send(text)}
                onStop={stop}
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
                        m.content
                      ) : (
                        <VStack gap={2}>
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
                          <Markdown isStreaming={false}>{m.content}</Markdown>
                        </VStack>
                      )}
                    </ChatMessageBubble>
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
            </ChatMessageList>
            </ChatLayout>
          </HStack>
        ) : (
          <EmptyState title="No bots loaded" description="Waiting on /api/bots…" />
        )
      }
      end={
        // Responsive contract (>1024: nav | roster | thread | live panel;
        // <=1024: the live panel is dropped, not squeezed — its content opens on
        // demand from the top-bar "Agent computer" button.
        isNarrow ? undefined : activeBot ? (
          <LayoutPanel width={300} hasDivider label="Live screen" padding={4}>
            <VStack gap={3}>
              <HStack gap={2} vAlign="center">
                <Avatar name={activeBot.name} size="sm" tooltip={false} />
                <Text type="body" weight="semibold">
                  {activeBot.name}
                </Text>
                <StatusDot
                  variant={isStreaming ? 'warning' : 'success'}
                  label={isStreaming ? 'Thinking' : 'Idle'}
                  isPulsing={isStreaming}
                />
              </HStack>
              {/* Placeholder live-screen preview — the real desktop feed is
                  wired through AgentComputerDialog today. */}
              <Card variant="muted" padding={4} minHeight={160}>
                <VStack gap={2} align="start">
                  <Text type="supporting">
                    Live screen preview — placeholder. Open the full view:
                  </Text>
                  <Button
                    label="Open agent computer"
                    size="sm"
                    variant="secondary"
                    onClick={() => setShowComputer(true)}
                  />
                </VStack>
              </Card>
              <Button
                label="Create Routine"
                variant="primary"
                onClick={() => {
                  // Placeholder — routines are a named object in the product
                  // plan; the create action is wired when the API exists.
                  window.setTimeout(() => {
                    window.console.info('[placeholder] Create Routine requested');
                  }, 0);
                }}
              />
              <Text type="supporting">
                {activeBot.description}
              </Text>
            </VStack>
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
          sessions={sessions.filter(s => s.botId === activeBotId)}
          activeId={activeSessionId}
          onSwitch={setActiveSessionId}
          onDelete={id => {
            setSessions(prev => prev.filter(s => s.id !== id));
            setActiveSessionId(prev => (prev === id ? null : prev));
          }}
          onNew={s => {
            setSessions(prev => [...prev, s]);
            setActiveSessionId(s.id);
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
    </AppShell>
  );
}
