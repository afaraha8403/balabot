/**
 * Section grouping and organization for BalaBot roster (Polaris re-base).
 *
 * Persists user-defined sections, collapsed section state, and per-bot
 * section assignments across browser sessions in localStorage.
 */

export type BotSection = {
  id: string;
  name: string;
};

const SECTIONS_KEY = 'balabot.botSections.v1';
const ASSIGNMENTS_KEY = 'balabot.botSectionAssignments.v1';
const COLLAPSED_KEY = 'balabot.collapsedSections.v1';

export const DEFAULT_BOT_SECTIONS: BotSection[] = [
  { id: 'sec-ops', name: 'Ops' },
  { id: 'sec-governance', name: 'Governance' },
  { id: 'sec-dev', name: 'Dev' },
];

export function loadBotSections(): BotSection[] {
  try {
    const raw = localStorage.getItem(SECTIONS_KEY);
    if (!raw) return DEFAULT_BOT_SECTIONS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_BOT_SECTIONS;
  } catch {
    return DEFAULT_BOT_SECTIONS;
  }
}

export function saveBotSections(sections: BotSection[]): void {
  try {
    localStorage.setItem(SECTIONS_KEY, JSON.stringify(sections));
  } catch {
    /* ignore */
  }
}

export function loadBotSectionAssignments(): Record<string, string | null> {
  try {
    const raw = localStorage.getItem(ASSIGNMENTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveBotSectionAssignments(assignments: Record<string, string | null>): void {
  try {
    localStorage.setItem(ASSIGNMENTS_KEY, JSON.stringify(assignments));
  } catch {
    /* ignore */
  }
}

export function saveBotSectionAssignment(botId: string, sectionId: string | null): void {
  const assignments = loadBotSectionAssignments();
  if (sectionId === null) {
    delete assignments[botId];
  } else {
    assignments[botId] = sectionId;
  }
  saveBotSectionAssignments(assignments);
}

export function loadCollapsedSections(): string[] {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveCollapsedSections(keys: string[]): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(keys));
  } catch {
    /* ignore */
  }
}

export function createBotSection(name: string): BotSection {
  const sections = loadBotSections();
  const id = `sec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const newSection: BotSection = { id, name: name.trim() };
  sections.push(newSection);
  saveBotSections(sections);
  return newSection;
}

export function renameBotSection(sectionId: string, newName: string): void {
  const sections = loadBotSections();
  const trimmed = newName.trim();
  const next = sections.map(s => (s.id === sectionId ? { ...s, name: trimmed } : s));
  saveBotSections(next);
}
