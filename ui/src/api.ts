export type Bot = {
  id: string;
  name: string;
  title: string;
  icon: string;
  color: string;
  description: string;
  templateId: string;
  order: number;
  handle?: string;
  botId?: string;
};

/**
 * One tool invocation reported mid-stream by the gateway
 * (`event: hermes.tool.progress`). Arrives twice per call: once running, once
 * completed. `label` is the target — the actual command, path or query.
 */
export type ToolProgress = {
  tool: string;
  emoji?: string;
  label?: string;
  toolCallId: string;
  status: 'pending' | 'running' | 'completed' | 'error';
};

export type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  at: number;
  /** Tool calls the assistant made while producing this message. */
  toolCalls?: ToolProgress[];
  /** The agent's private reasoning ("thinking") stream, kept separate from the answer. */
  thinking?: string;
};

export type Session = {
  id: string;
  botId: string;
  title: string;
  messages: ChatMessage[];
  handoffs: Handoff[];
  createdAt: number;
  /** The session's purpose record (server-backed). Every session is responsible for something. */
  purpose?: string;
  /** Topic spans from the server store: [{topic, start_seq, end_seq}, ...]. */
  topicSpans?: TopicSpan[];
  /** Set when this session exists only in localStorage (server was unreachable). */
  localOnly?: boolean;
};

export type Handoff = {
  from: string;
  to: string;
  summary: string;
  at: number;
};

// ── org surfaces (CONTRACT.md §3 — frozen) ──
export type OrgSummary = {id: string; name: string; members: string[]};

export type SecretRequestPayload = {
  bot: string;
  name: string;
  description?: string;
  request_id: string;
};

export type SecretAccessRequestPayload = {
  bot: string;
  name: string;
  reason?: string;
  request_id: string;
};

/**
 * POST /api/org/secrets — the exact backend contract:
 *   response: {saved, name, fingerprint, granted_to, share_scope}
 * The VALUE is POSTed straight from the password input's ref and never
 * round-trips through chat state, a store, or the transcript.
 */
export type SecretSaveResult = {
  saved: boolean;
  name: string;
  fingerprint: string;
  granted_to?: string[];
  share_scope?: string;
};

export type SkillEntry = {
  org?: string;
  name: string;
  source: string;
  description?: string;
  grants?: string[] | string;
  state?: string;
  /** Real skill category on disk (server-reported), e.g. 'balabot', 'devops'. */
  category?: string;
};

export type SkillLibrary = {
  learned: SkillEntry[];
  brought: SkillEntry[];
  note?: string;
};

/**
 * GET /api/skills/library — real endpoint (server.py). Like every honest
 * control-plane response it carries `available`; when false, `reason` says
 * what is missing and the view must render that, not an empty list.
 */
export type SkillLibraryResponse = {available: boolean; reason?: string} & {
  learned?: SkillEntry[];
  brought?: SkillEntry[];
  note?: string;
};

/** A secret card living in the transcript. NEVER stores a value or fingerprint of unsaved data. */
export type SecretCard = {
  kind: 'secret_request' | 'secret_access_request';
  bot: string;
  name: string;
  description?: string;
  reason?: string;
  requestId: string;
  at: number;
  status?:
    | {state: 'saved'; fingerprint: string}
    | {state: 'denied'}
    | {state: 'cancelled'};
};

export type Fleet = {
  fleet: string;
  agents: {id: string; name: string}[];
  excluded: string[];
};

export type ComputerFrame = {
  ok: boolean;
  b64: string;
  capturedAt: string;
  width: number;
  height: number;
  state: 'ready' | 'no-driver' | 'error';
  note?: string;
};

export type ComputerAction = {
  action: 'click' | 'doubleClick' | 'rightClick' | 'type' | 'key' | 'scroll';
  x?: number;
  y?: number;
  text?: string;
  key?: string;
  amount?: number;
};

export type MemoryItem = {id: string; content: string; category?: string};
export type KbDoc = {id: string; title: string; content: string};

// ── server-backed conversations (GET/POST /api/sessions, /{id}, DELETE, PATCH) ──
export type TopicSpan = {topic: string; start_seq: number; end_seq: number};

export type ServerSessionDecision = {
  text: string;
  provenance: string;
  created_at: string;
};

/**
 * One row of GET /api/sessions?bot=<id>. `purpose` is the session's
 * responsibility statement; topic spans arrive on the detail endpoint.
 */
export type ServerSession = {
  id: string;
  botId: string;
  title: string;
  purpose: string;
  createdAt: number | null;
  nextSeq?: number;
  compactionCount?: number;
  lastCompactionAt?: string | null;
  topicSpans?: TopicSpan[];
  decisions?: ServerSessionDecision[];
  resumeState?: Record<string, unknown>;
  recentWindow?: string;
};

export type SessionsResponse = {
  available: boolean;
  reason?: string;
  bot?: string;
  sessions?: ServerSession[];
};

export type ServerSessionResponse = {
  available: boolean;
  reason?: string;
  session?: ServerSession;
};

export async function getSessions(botId: string): Promise<SessionsResponse> {
  return api<SessionsResponse>(
    `/api/sessions?bot=${encodeURIComponent(botId)}`,
  );
}

export async function getServerSession(
  botId: string,
  sessionId: string,
): Promise<ServerSessionResponse> {
  return api<ServerSessionResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}?bot=${encodeURIComponent(botId)}`,
  );
}

/**
 * POST /api/sessions — create a conversation with its PURPOSE. A session
 * without a real botId is orphaned (unlistable/undeletable), so the caller
 * must pass one; the server refuses otherwise.
 */
export async function createServerSession(
  botId: string,
  title: string,
  purpose?: string,
  id?: string,
): Promise<ServerSession> {
  const res = await api<{created: boolean; session: ServerSession}>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({botId, title, purpose, id}),
  });
  return res.session;
}

export async function deleteServerSession(sessionId: string): Promise<void> {
  await api(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
}

export async function patchServerSession(
  sessionId: string,
  purpose: string,
): Promise<void> {
  await api(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    body: JSON.stringify({purpose}),
  });
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch('/healthz', {credentials: 'include'});
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * POST /api/chat and parse the SSE-ish stream. Supports both OpenAI-style
 * frames (`data: {"choices":[{"delta":{"content":"tok"}}]}`) and named events
 * (`event: token` / `event: final` / `event: done` / `event: error`).
 * Frames are separated by a blank line. onToken receives the accumulated
 * text so far; the returned string is the final full text.
 */
export async function streamChat(
  botId: string,
  messages: {role: string; content: string}[],
  onToken: (accumulated: string) => void,
  signal: AbortSignal,
  onHandoff?: (h: Handoff) => void,
  onSecretEvent?: (e: {
    kind: 'secret_request' | 'secret_access_request';
    bot: string;
    name: string;
    description?: string;
    reason?: string;
    requestId: string;
  }) => void,
  onToolEvent?: (t: ToolProgress) => void,
  /** Accumulated `delta.reasoning_content` ("thinking") text, if the model emits any. */
  onReasoning?: (accumulated: string) => void,
): Promise<string> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    credentials: 'include',
    signal,
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({bot_id: botId, messages}),
  });
  if (!res.ok || !res.body) throw new Error(`chat stream failed: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let acc = '';
  let reasoningAcc = '';

  const emit = (piece: string) => {
    acc += piece;
    onToken(acc);
  };
  const emitReasoning = (piece: string) => {
    reasoningAcc += piece;
    if (onReasoning) onReasoning(reasoningAcc);
  };
  const replace = (full: string) => {
    acc = full;
    onToken(acc);
  };

  const handleFrame = (frame: string) => {
    let eventName = '';
    const dataLines: string[] = [];
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    const data = dataLines.join('\n');
    if (!data) return;
    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      if (eventName === 'token') emit(data);
      else if (eventName === 'final') replace(data);
      return;
    }
    const p = payload as {
      content?: string;
      message?: string;
      choices?: {delta?: {content?: string; reasoning_content?: string}}[];
    };
    if (eventName === 'final' && typeof p.content === 'string') {
      replace(p.content);
    } else if (eventName === 'handoff') {
      const h = payload as {from?: string; to?: string; summary?: string; at?: string};
      if (onHandoff) {
        onHandoff({
          from: h.from ?? '',
          to: h.to ?? '',
          summary: h.summary ?? '',
          at: h.at ? Date.parse(h.at) || Date.now() : Date.now(),
        });
      }
    } else if (eventName === 'secret_request' || eventName === 'secret_access_request') {
      // A bot is asking for a secret. Only the NAME travels through the stream —
      // the value (if any) is entered by the human directly into the card form
      // and POSTed straight to the backend; it never re-enters the chat.
      const r = payload as {
        bot?: string;
        name?: string;
        description?: string;
        reason?: string;
        request_id?: string;
      };
      if (onSecretEvent && r.name) {
        onSecretEvent({
          kind: eventName === 'secret_request' ? 'secret_request' : 'secret_access_request',
          bot: r.bot ?? '',
          name: r.name,
          description: r.description,
          reason: r.reason,
          requestId: r.request_id ?? `${r.name}-${Date.now()}`,
        });
      }
    } else if (eventName === 'hermes.tool.progress') {
      // Real agent activity: which tool, on what target, and whether it is
      // still running. This is what makes the working indicator truthful
      // rather than a decorative spinner.
      const t = payload as {
        tool?: string;
        emoji?: string;
        label?: string;
        toolCallId?: string;
        status?: string;
      };
      if (onToolEvent && t.tool) {
        const status =
          t.status === 'pending' || t.status === 'running' ||
          t.status === 'completed' || t.status === 'error'
            ? t.status
            : 'running';
        onToolEvent({
          tool: t.tool,
          emoji: t.emoji,
          label: t.label,
          toolCallId: t.toolCallId ?? `${t.tool}-${Date.now()}`,
          status,
        });
      }
    } else if (eventName === 'error') {
      throw new Error(p.message ?? 'stream error');
    } else if (typeof p.content === 'string') {
      emit(p.content);
    } else if (Array.isArray(p.choices)) {
      for (const c of p.choices) {
        // The gateway streams the model's reasoning as a SEPARATE delta field
        // (`delta.reasoning_content`). It is never part of the answer, so it
        // must never be merged into the visible reply — the UI buffers it on
        // its own channel and only shows it behind the "thinking" toggle.
        if (c.delta?.reasoning_content) emitReasoning(c.delta.reasoning_content);
        if (c.delta?.content) emit(c.delta.content);
      }
    }
  };

  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream: true});
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 2);
        if (frame) handleFrame(frame);
      }
    }
    const tail = buffer.trim();
    if (tail) handleFrame(tail);
  } finally {
    reader.releaseLock();
  }
  return acc;
}

export async function getComputerFrame(botId: string): Promise<ComputerFrame> {
  return api<ComputerFrame>(`/api/computer/${botId}/frame`);
}

export async function sendComputerAction(
  botId: string,
  action: ComputerAction,
): Promise<{ok: boolean; effect?: string; escalation?: string}> {
  return api(`/api/computer/${botId}/action`, {
    method: 'POST',
    body: JSON.stringify(action),
  });
}

export async function getFleet(): Promise<Fleet> {
  return api<Fleet>('/api/fleet');
}

// ── org endpoints (CONTRACT.md §3) ──

export async function getOrgs(): Promise<OrgSummary[]> {
  const r = await api<{orgs: OrgSummary[]}>('/api/orgs');
  return r.orgs ?? [];
}

/**
 * POST the secret value STRAIGHT to the backend, client-side.
 * The value must never be dispatched as a chat message or placed in
 * component state beyond the password input itself.
 */
export async function getSkillLibrary(botId?: string): Promise<SkillLibraryResponse> {
  const q = botId ? `?bot=${encodeURIComponent(botId)}` : '';
  return api<SkillLibraryResponse>(`/api/skills/library${q}`);
}

export async function postSkillPin(body: {
  org?: string;
  name: string;
  pinned: boolean;
}): Promise<unknown> {
  return api('/api/org/skills/pin', {method: 'POST', body: JSON.stringify(body)});
}

export async function postSkillPromote(body: {
  org?: string;
  name: string;
  share: string | string[];
}): Promise<unknown> {
  return api('/api/org/skills/promote', {method: 'POST', body: JSON.stringify(body)});
}

/**
 * POST /api/org/secrets — the secret VALUE travels from the caller's password
 * input straight into this request body and nowhere else. Never log it, never
 * route it through a chat message or a store that renders in the transcript.
 */
export async function postOrgSecret(body: {
  org?: string;
  name: string;
  value: string;
  description?: string;
  share: string | string[];
}): Promise<SecretSaveResult> {
  const res = await fetch('/api/org/secrets', {
    method: 'POST',
    credentials: 'include',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST /api/org/secrets -> ${res.status}`);
  const result = (await res.json()) as SecretSaveResult;
  if (!result.saved) {
    throw new Error(
      `the secret store did not save "${result.name}"` +
        (result.fingerprint ? ` (fingerprint ${result.fingerprint})` : ''),
    );
  }
  return result;
}

// ── control-plane endpoints (B-era): all follow the honesty contract ──
// Every response carries `available`. When false, `reason` explains what is
// missing and the screen must render an explicit unavailable state — mock
// data may be shown only as a clearly-labelled sample, never as live data.
export type Available = {available: boolean; reason?: string; note?: string};

export type AgentNode = {
  id: string;
  name: string;
  tier: 'user' | 'principal' | 'governor' | 'persistent' | 'sub';
  status: 'live' | 'dormant' | 'busy';
  role: string;
  children?: AgentNode[];
};
export type AgentsResponse = Available & {tree?: AgentNode[]};

export type OpsService = {
  id: string;
  name: string;
  state: 'running' | 'dormant' | 'degraded' | 'down';
  detail: string;
  uptime: string;
};
export type OpsResponse = Available & {services?: OpsService[]};

export type MemoryFact = {
  id: string;
  content: string;
  entity: string;
  resolvedTo: string;
  trust: number;
  sources: number;
  updatedAt: string;
};
export type MemoryResponse = Available & {facts?: MemoryFact[]; profile?: string};

export type CostRow = {
  id: string;
  profile: string;
  provider: string;
  model: string;
  spend: number;
  calls: number;
  tokens: number;
};
export type CostResponse = Available & {rows?: CostRow[]};

export type TypedDecision = {
  id: string;
  kind: 'noul' | 'choice' | 'score';
  statement: string;
  confidence: number;
  shadow: boolean;
  outcome?: string;
  decidedBy: string;
  at: string;
};
export type DecisionsResponse = Available & {decisions?: TypedDecision[]};

export type LedgerEntry = {
  id: string;
  what: string;
  who: string;
  why: string;
  rollback: string;
  at: string;
};
export type GovernanceResponse = Available & {ledger?: LedgerEntry[]};

export async function getAgents(): Promise<AgentsResponse> {
  return api<AgentsResponse>('/api/agents');
}
export async function getOps(): Promise<OpsResponse> {
  return api<OpsResponse>('/api/ops');
}
export async function getMemory(): Promise<MemoryResponse> {
  return api<MemoryResponse>('/api/memory');
}
export async function getCost(): Promise<CostResponse> {
  return api<CostResponse>('/api/cost');
}
export async function getDecisions(): Promise<DecisionsResponse> {
  return api<DecisionsResponse>('/api/decisions');
}
export async function getGovernance(): Promise<GovernanceResponse> {
  return api<GovernanceResponse>('/api/governance');
}

// ── sub-agents: live spawn rows nested under their parent bot ───────────────
// Backed by the container's real /opt/data/spawn-ledger.json with /proc
// liveness checks. When nothing is spawned, `available` is true and
// `subagents` is EMPTY with a reason — the roster must never invent rows.
export type SubAgent = {
  parent: string;
  id: string;
  title: string;
  status: 'live' | string;
  startedAt: string;
  age?: string;
  pid?: number | null;
};
export type SubAgentsResponse = Available & {subagents?: SubAgent[]};

export async function getSubAgents(): Promise<SubAgentsResponse> {
  return api<SubAgentsResponse>('/api/subagents');
}

// ── Wave 6 P3: multi-agent groups ────────────────────────────────────────────
export type GroupTranscriptEntry = {
  at: string;
  round: number;
  from: string;
  kind: 'message' | 'error';
  text: string;
  detail?: string;
};

export type Group = {
  id: string;
  name: string;
  members: string[];
  computerAgent: string;
  round: number;
  transcript: GroupTranscriptEntry[];
  sessionLens: Record<string, number>;
  createdAt: string;
};

export type GroupTurnResult = {
  bot: string;
  text?: string;
  error?: boolean;
  detail?: string;
};

export async function getGroups(): Promise<GroupsResponse> {
  return api<GroupsResponse>('/api/groups');
}
export type GroupsResponse = Available & {groups?: Group[]};

export async function createGroup(body: {
  name: string;
  members: string[];
  computer_agent?: string;
}): Promise<{created: boolean; group: Group}> {
  return api('/api/groups', {method: 'POST', body: JSON.stringify(body)});
}

export async function getGroup(gid: string): Promise<Available & {group?: Group}> {
  return api<Available & {group?: Group}>(`/api/groups/${gid}`);
}

export async function deleteGroup(gid: string): Promise<{deleted: boolean}> {
  return api(`/api/groups/${gid}`, {method: 'DELETE'});
}

export async function postGroupTurn(
  gid: string,
  text: string,
): Promise<{ok: boolean; results: GroupTurnResult[]; group: Group}> {
  return api(`/api/groups/${gid}/turn`, {
    method: 'POST',
    body: JSON.stringify({text}),
  });
}

// ── Wave 6 P4: bot creation with consent ─────────────────────────────────────
export type BotProposal = {
  id: string;
  bot_id: string;
  name: string;
  role: string;
  proposed_by: string;
  status: 'proposed' | 'approved' | 'rejected' | 'registered';
  created_at: string;
  approved_by: string | null;
  created_result?: {bot_id: string; actions: string[]} | null;
};

export type BotProposalsResponse = Available & {proposals?: BotProposal[]};

export async function getBotProposals(): Promise<BotProposalsResponse> {
  return api<BotProposalsResponse>('/api/bot-proposals');
}

export async function createBotProposal(body: {
  name: string;
  role: string;
  proposed_by?: string;
}): Promise<{proposed: boolean; proposal: BotProposal}> {
  return api('/api/bot-proposals', {method: 'POST', body: JSON.stringify(body)});
}

export async function approveBotProposal(pid: string): Promise<{
  approved: boolean;
  proposal: BotProposal;
}> {
  return api(`/api/bot-proposals/${pid}/approve`, {method: 'POST'});
}

export async function rejectBotProposal(pid: string): Promise<{
  rejected: boolean;
  proposal: BotProposal;
}> {
  return api(`/api/bot-proposals/${pid}/reject`, {method: 'POST'});
}

export async function createApprovedBot(pid: string): Promise<{
  created: boolean;
  bot: Bot;
  proposal: BotProposal;
  org_members: string[];
}> {
  return api(`/api/bot-proposals/${pid}/create`, {method: 'POST'});
}

export async function deleteBotProposal(pid: string): Promise<{deleted: boolean}> {
  return api(`/api/bot-proposals/${pid}`, {method: 'DELETE'});
}

// ── bot edit / delete + orphan reconciliation (frozen contract) ──────────────
//
//   PATCH  /api/bots/{bot_id}          body: subset of {name,title,description,icon,color}
//           200 {updated, bot} · 409 {detail} shipped/unknown-field · 404 {detail}
//   DELETE /api/bots/{bot_id}          200 {deleted, bot_id, removed, org_removed}
//           · 409 {detail} principal/governor · 404 {detail}
//   GET    /api/orphans                200 {profiles, shipped, rostered, note}
//   POST   /api/orphans/{name}/adopt   200 {adopted, bot}
//   DELETE /api/orphans/{name}         200 {deleted, profile, removed, roster_row}
//
// Every error response carries {detail}, so the typed wrappers surface the
// backend's reason rather than a bare status code.

/**
 * Product taxonomy (binding): principal and governor are SHIPPED/LOCKED.
 * The UI never offers edit or delete for them, and the backend independently
 * refuses with 409 — this set is what drives the "locked" affordance.
 */
export const SHIPPED_BOT_IDS: ReadonlySet<string> = new Set(['principal', 'governor']);
export function isShippedBot(bot: Pick<Bot, 'id'>): boolean {
  return SHIPPED_BOT_IDS.has(bot.id);
}

export type BotEditableMeta = {
  name: string;
  title: string;
  description: string;
  icon: string;
  color: string;
};

export type BotMetaRow = {
  id: string;
  name: string;
  title: string;
  icon: string;
  color: string;
  order: number;
  description: string;
  createdBy?: string;
  createdFrom?: string;
};

export type UpdateBotResult = {updated: boolean; bot: BotMetaRow};
export type DeleteBotResult = {
  deleted: boolean;
  bot_id: string;
  removed: string[];
  org_removed: boolean;
};

/**
 * Like `api`, but on a non-ok response it parses the JSON error body and
 * throws an Error carrying the backend's `detail` (409 shipped/unknown-field,
 * 404 unknown) so dialogs can show the real reason, not "PATCH ... -> 409".
 */
export async function apiWithDetail<T>(
  method: 'PATCH' | 'DELETE' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: {'Content-Type': 'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // non-JSON error body — fall through to the status-code message
  }
  if (!res.ok) {
    const detail = (payload as {detail?: string} | null)?.detail;
    throw new Error(detail ?? `${method} ${path} -> ${res.status}`);
  }
  return payload as T;
}

/** PATCH /api/bots/{bot_id} — any subset of the editable meta fields. */
export async function updateBot(
  botId: string,
  patch: Partial<BotEditableMeta>,
): Promise<UpdateBotResult> {
  return apiWithDetail<UpdateBotResult>('PATCH', `/api/bots/${encodeURIComponent(botId)}`, patch);
}

/** DELETE /api/bots/{bot_id} — refuses (409) for principal/governor. */
export async function deleteBot(botId: string): Promise<DeleteBotResult> {
  return apiWithDetail<DeleteBotResult>('DELETE', `/api/bots/${encodeURIComponent(botId)}`);
}

/** GET /api/orphans — real profiles on disk the roster cannot see. */
export type OrphanShape = 'orphan-profile' | 'subagent-artifact';

export type OrphanProfile = {
  id: string;
  name: string;
  path: string;
  sizeBytes: number;
  hasSoul: boolean;
  hasConfig: boolean;
  gatewayRunning: boolean;
  shape: OrphanShape;
  createdAt: string;
};

export type OrphansResponse = {
  profiles: OrphanProfile[];
  shipped: string[];
  rostered: string[];
  note?: string;
};

export type AdoptOrphanResult = {adopted: boolean; bot: BotMetaRow};
export type PurgeOrphanResult = {
  deleted: boolean;
  profile: string;
  removed: string[];
  roster_row: boolean;
};

export async function listOrphans(): Promise<OrphansResponse> {
  return api<OrphansResponse>('/api/orphans');
}

export async function adoptOrphan(name: string): Promise<AdoptOrphanResult> {
  return apiWithDetail<AdoptOrphanResult>(
    'POST',
    `/api/orphans/${encodeURIComponent(name)}/adopt`,
  );
}

export async function purgeOrphan(name: string): Promise<PurgeOrphanResult> {
  return apiWithDetail<PurgeOrphanResult>(
    'DELETE',
    `/api/orphans/${encodeURIComponent(name)}`,
  );
}

export type ReapArtifactsResult = {
  reaped: string[];
  count: number;
};

/** Reap every empty-shell profile (sub-agent debris). Never touches a real
 *  orphan profile — those need an explicit adopt or purge. */
export async function reapSubagentArtifacts(): Promise<ReapArtifactsResult> {
  return apiWithDetail<ReapArtifactsResult>('POST', '/api/orphans/reap');
}

