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
};

export type Session = {
  id: string;
  botId: string;
  title: string;
  messages: ChatMessage[];
  handoffs: Handoff[];
  createdAt: number;
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

  const emit = (piece: string) => {
    acc += piece;
    onToken(acc);
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
      choices?: {delta?: {content?: string}}[];
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
