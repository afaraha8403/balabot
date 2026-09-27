import type {Session} from './api';

const KEY = 'balabot.sessions.v1';
const LAST_KEY = 'balabot.lastBot.v1';
/** User preference: reveal the agent's reasoning ("thinking") stream. Hidden by default. */
const SHOW_THINKING_KEY = 'balabot.showThinking.v1';

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

export function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Session[];
    if (!Array.isArray(parsed)) return [];
    // Older sessions predate handoffs; backfill so rendering never crashes.
    return parsed.map(s => ({...s, handoffs: s.handoffs ?? []}));
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