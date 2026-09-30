import type {Dispatch, SetStateAction} from 'react';
import {getSessions} from './api';
import type {ChatMessage, ServerMessage, ServerSession, Session, SessionsResponse} from './api';

const KEY = 'balabot.sessions.v1';
const LAST_KEY = 'balabot.lastBot.v1';
/** User preference: reveal the agent's reasoning ("thinking") stream. Hidden by default. */
const SHOW_THINKING_KEY = 'balabot.showThinking.v1';
const PINNED_BOTS_KEY = 'balabot.pinnedBots.v1';
const HIDDEN_BOTS_KEY = 'balabot.hiddenBots.v1';

export function loadShowThinking(): boolean {
  try {
    return localStorage.getItem(SHOW_THINKING_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveShowThinking(value: boolean) {
  try {
    localStorage.setItem(SHOW_THINKING_KEY, value ? 'true' : 'false');
  } catch {
    /* ignore */
  }
}

export function loadPinnedBots(): string[] {

  try {
    const raw = localStorage.getItem(PINNED_BOTS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function savePinnedBots(ids: string[]) {
  try {
    localStorage.setItem(PINNED_BOTS_KEY, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

export function loadHiddenBots(): string[] {
  try {
    const raw = localStorage.getItem(HIDDEN_BOTS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function saveHiddenBots(ids: string[]) {
  try {
    localStorage.setItem(HIDDEN_BOTS_KEY, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

const UNREAD_BOTS_KEY = 'balabot.unreadBots.v1';

export function loadUnreadBots(): string[] {
  try {
    const raw = localStorage.getItem(UNREAD_BOTS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function saveUnreadBots(ids: string[]) {
  try {
    localStorage.setItem(UNREAD_BOTS_KEY, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}


/**
 * Sort conversation messages by server-authoritative timestamp (`at`).
 * Every client adopts the server `created_at` the moment the fanout/merge
 * matches its optimistic copy, so both clients compute the same order at
 * every instant — even while one of the two messages has not yet adopted
 * its server `seq`. Ordering never depends on whether a sequence number is
 * present. `seq` only breaks ties between messages that share an instant
 * (unsequenced locals sort after sequenced at the same timestamp).
 */
export function sortMessages(messages: ChatMessage[]): ChatMessage[] {
  return [...messages].sort((a, b) => {
    const atDiff = (a.at || 0) - (b.at || 0);
    if (atDiff !== 0) return atDiff;
    return ((a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER));
  });
}

/**
 * Merge incoming server-authoritative transcript messages with existing
 * client state. Deduplicates by message_id, sequence number, or content/role match.
 * Preserves optimistic UI properties (toolCalls, thinking, reactions) while updating
 * server sequence and ID.
 */
export function mergeServerMessages(
  existing: ChatMessage[],
  incoming: ServerMessage[],
): ChatMessage[] {
  if (!incoming || incoming.length === 0) return existing;

  // Filter out default onboarding placeholder if real messages exist
  const withoutOnboarding = existing.filter(
    m => m.seq !== undefined || m.role !== 'assistant' || !m.content.startsWith('Hey — good to meet you'),
  );

  const result = [...withoutOnboarding];
  for (const sm of incoming) {
    const idx = result.findIndex(
      m => (sm.message_id && (m.id === sm.message_id || m.id === `msg-${sm.message_id}`)) ||
           (m.seq !== undefined && m.seq === sm.seq) ||
           (m.role === sm.role && m.content === sm.content && (!m.seq || m.seq === sm.seq)),
    );
    if (idx >= 0) {
      // The server echo of a locally-originated message: adopt the server
      // sequence AND its created_at so this copy carries the same timestamp
      // everywhere. Never append a second copy; in-place update only.
      const adoptedAt = sm.created_at ? (Date.parse(sm.created_at) || 0) : 0;
      result[idx] = {
        ...result[idx],
        id: sm.message_id || result[idx].id,
        seq: sm.seq,
        at: adoptedAt || result[idx].at,
      };
    } else {
      result.push({
        id: sm.message_id,
        role: sm.role as 'user' | 'assistant' | 'system',
        content: sm.content,
        at: sm.created_at ? Date.parse(sm.created_at) || Date.now() : Date.now(),
        seq: sm.seq,
      });
    }
  }
  return sortMessages(result);
}

/**
 * Add a server session row into the local Session[] surface. The server is
 * the source of truth for the conversation register and transcript.
 */
export function mergeServerSession(
  sessions: Session[],
  row: ServerSession,
  botId: string,
): Session[] {
  const realBot = row.botId || botId; // never accept an empty botId
  if (!realBot) return sessions;
  const existing = sessions.find(s => s.id === row.id);
  const rawCreatedAt = row.createdAt || (row as any).lastActivity;
  const idTs = row.id.startsWith('s_') ? parseInt(row.id.split('_')[1], 10) : NaN;
  const createdAt = rawCreatedAt
    ? (typeof rawCreatedAt === 'number' ? rawCreatedAt : (Date.parse(rawCreatedAt) || 0))
    : (!isNaN(idTs) && idTs > 0 ? idTs : 0);
  if (existing) {
    return sessions.map(s =>
      s.id === row.id
        ? {...s, botId: s.botId || realBot, title: row.title || s.title,
           purpose: row.purpose ?? s.purpose,
           topicSpans: row.topicSpans ?? s.topicSpans,
           createdAt: createdAt || s.createdAt,
           localOnly: false}
        : s,
    );
  }
  return [
    {
      id: row.id,
      botId: realBot,
      title: row.title || 'Untitled conversation',
      purpose: row.purpose || '',
      messages: [],
      handoffs: [],
      createdAt,
      topicSpans: row.topicSpans ?? [],
      localOnly: false,
    },
    ...sessions,
  ];
}

/**
 * Fetch the server's conversation register for `botId` and merge it into the
 * local session list. Returns null when the server is honestly unavailable —
 * callers keep the localStorage cache in that case, and the merged list marks
 * server-backed rows as the source of truth.
 */
export async function syncSessionsFromServer(
  botId: string,
  setSessions: Dispatch<SetStateAction<Session[]>>,
): Promise<SessionsResponse | null> {
  if (!botId) return null;
  try {
    const res = await getSessions(botId);
    if (res.available === false) return res; // honest unavailable — keep cache
    setSessions(prev => {
      let next = prev;
      for (const row of res.sessions ?? []) {
        next = mergeServerSession(next, row, botId);
      }
      return [...next].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    });
    return res;
  } catch {
    return null; // network failure — offline cache remains
  }
}

export function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Session[];
    if (!Array.isArray(parsed) || parsed.length === 0) return [];
    // Older sessions predate handoffs; backfill so rendering never crashes.
    const mapped = parsed
      .map(s => ({...s, handoffs: s.handoffs ?? []}))
      // Purge ghost sessions: a session with no botId can never match the
      // per-bot filter, so it is unreachable — invisible and undeletable.
      // Only message-less ghosts are dropped; nothing with content is discarded.
      .filter(s => !!s.botId || (s.messages?.length ?? 0) > 0);
    // No seeded demo: an empty store yields an empty roster. A conversation only
    // exists because an agent or the owner actually had one.
    return mapped;
  } catch {
    return [];
  }
}

export function saveSessions(sessions: Session[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(sessions));
  } catch {
    /* storage full or unavailable */
  }
}

export function loadLastBot(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

export function saveLastBot(botId: string) {
  try {
    localStorage.setItem(LAST_KEY, botId);
  } catch {
    /* ignore */
  }
}

export function newSession(botId: string, title: string): Session {
  return {
    id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    botId,
    title: title || 'New chat',
    messages: [],
    handoffs: [],
    createdAt: Date.now(),
  };
}

/**
 * "A: msgs 1-40 · B: 41-90" — the session's topic spans, rendered as one
 * compact line. Every session is responsible for something; this makes the
 * responsibility record visible instead of hiding it in the store.
 */
export function topicSpanLabel(
  spans: {topic: string; start_seq: number; end_seq: number}[] | undefined,
): string {
  if (!spans || spans.length === 0) return '';
  return spans.map(s => `${s.topic}: msgs ${s.start_seq}-${s.end_seq}`).join(' · ');
}