import type {Dispatch, SetStateAction} from 'react';
import {getSessions} from './api';
import type {ServerSession, Session, SessionsResponse} from './api';

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
 * Add a server session row into the local Session[] surface. The server is
 * the source of truth for the conversation REGISTER (id/botId/purpose/spans);
 * message bodies stay in the browser and are merged in as they exist here.
 * A session already present locally keeps its messages; one that is not gets
 * an empty thread (or, for the server rows, none at all — the register is what
 * we read from the server, not the transcripts).
 */
export function mergeServerSession(
  sessions: Session[],
  row: ServerSession,
  botId: string,
): Session[] {
  const realBot = row.botId || botId; // never accept an empty botId
  if (!realBot) return sessions;
  const existing = sessions.find(s => s.id === row.id);
  if (existing) {
    return sessions.map(s =>
      s.id === row.id
        ? {...s, botId: s.botId || realBot, title: row.title || s.title,
           purpose: row.purpose ?? s.purpose,
           topicSpans: row.topicSpans ?? s.topicSpans,
           localOnly: false}
        : s,
    );
  }
  return [
    ...sessions,
    {
      id: row.id,
      botId: realBot,
      title: row.title || 'Untitled conversation',
      purpose: row.purpose || '',
      messages: [],
      handoffs: [],
      createdAt: row.createdAt ?? Date.now(),
      topicSpans: row.topicSpans ?? [],
      localOnly: false,
    },
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
      return next;
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