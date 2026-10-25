/**
 * OpenUI Request Descriptor & Superseding Resolution
 *
 * Tracks OpenUI interactive cards across a conversation transcript.
 * When the same request is repeated or updated in a subsequent turn,
 * earlier panels are identified as superseded so their action buttons
 * can be disabled, preventing duplicate actions on stale cards.
 */

import { extractOpenUI } from './OpenUIRenderer';

export interface OpenUIRequestDescriptor {
  type: string;
  name?: string;
  role?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  title?: string;
  rawCode: string;
}

/**
 * Parses an OpenUI Lang code block into a structured request descriptor.
 */
export function parseOpenUIRequestDescriptor(openuiCode: string): OpenUIRequestDescriptor | null {
  if (!openuiCode || typeof openuiCode !== 'string') return null;

  const trimmed = openuiCode.trim();

  // 1. HireAgentCard("role", "name", "desc", "skills")
  // Handles single, double, or backtick quotes and multiline parameters
  const hireRegex = /HireAgentCard\s*\(\s*(['"`])([\s\S]*?)\1\s*,\s*(['"`])([\s\S]*?)\3/i;
  const hireMatch = trimmed.match(hireRegex);
  if (hireMatch) {
    return {
      type: 'HireAgentCard',
      role: hireMatch[2].trim(),
      name: hireMatch[4].trim(),
      rawCode: trimmed,
    };
  }

  // 2. ConfirmButtons("confirmLabel", "cancelLabel")
  const confirmRegex = /ConfirmButtons\s*\(\s*(['"`])([\s\S]*?)\1\s*,\s*(['"`])([\s\S]*?)\3/i;
  const confirmMatch = trimmed.match(confirmRegex);
  if (confirmMatch) {
    return {
      type: 'ConfirmButtons',
      confirmLabel: confirmMatch[2].trim(),
      cancelLabel: confirmMatch[4].trim(),
      rawCode: trimmed,
    };
  }

  // 3. Card / CardHeader("title", ...)
  const cardRegex = /(?:Card|CardHeader)\s*\(\s*(['"`])([\s\S]*?)\1/i;
  const cardMatch = trimmed.match(cardRegex);
  if (cardMatch) {
    return {
      type: 'Card',
      title: cardMatch[2].trim(),
      rawCode: trimmed,
    };
  }

  // 4. Generic root = ComponentName("arg1", ...)
  const genericRegex = /root\s*=\s*([A-Za-z0-9_]+)\s*\(\s*(['"`])([\s\S]*?)\2/i;
  const genericMatch = trimmed.match(genericRegex);
  if (genericMatch) {
    return {
      type: genericMatch[1],
      name: genericMatch[3].trim(),
      rawCode: trimmed,
    };
  }

  return null;
}

/**
 * Normalizes text for loose equivalence matching (stripping punctuation and whitespace).
 */
function normalizeKey(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Evaluates whether two OpenUI cards represent the SAME request or an UPDATED version of the request.
 * Returns false if they represent distinct, unrelated requests.
 */
export function isOpenUISameOrUpdatedRequest(
  older: OpenUIRequestDescriptor,
  newer: OpenUIRequestDescriptor
): boolean {
  if (older.type !== newer.type) {
    return false;
  }

  // A. HireAgentCard: same or updated agent request
  if (older.type === 'HireAgentCard') {
    const olderName = normalizeKey(older.name || '');
    const newerName = normalizeKey(newer.name || '');
    const olderRole = normalizeKey(older.role || '');
    const newerRole = normalizeKey(newer.role || '');

    // Match on bot system identifier (e.g. "quill" === "quill")
    if (olderName && newerName && olderName === newerName) {
      return true;
    }

    // Match on role title (e.g. "blogwriter" === "blogwriter")
    if (olderRole && newerRole && olderRole === newerRole) {
      return true;
    }

    // Match on role specialization update (e.g. "blogwriter" inside "blogwriterseo")
    if (olderRole && newerRole && (olderRole.includes(newerRole) || newerRole.includes(olderRole))) {
      return true;
    }

    // Different bot and different role -> NOT the same request
    return false;
  }

  // B. ConfirmButtons: match on same confirm label
  if (older.type === 'ConfirmButtons') {
    if (older.confirmLabel && newer.confirmLabel) {
      return normalizeKey(older.confirmLabel) === normalizeKey(newer.confirmLabel);
    }
  }

  // C. Generic component with matching title or name
  if (older.title && newer.title) {
    return normalizeKey(older.title) === normalizeKey(newer.title);
  }

  if (older.name && newer.name) {
    return normalizeKey(older.name) === normalizeKey(newer.name);
  }

  return false;
}

/**
 * Scans a list of chat messages and returns the set of message indices whose OpenUI cards
 * have been superseded by a subsequent repeated or updated request in a later turn.
 */
export function findSupersededOpenUIMessageIndices(
  messages: Array<{ content: string }>
): Set<number> {
  const superseded = new Set<number>();
  if (!messages || messages.length === 0) return superseded;

  // Extract descriptors for all messages with OpenUI
  const items: Array<{ index: number; descriptor: OpenUIRequestDescriptor } | null> = messages.map(
    (m, idx) => {
      const parsed = extractOpenUI(m.content);
      if (!parsed.hasOpenUI) return null;
      const descriptor = parseOpenUIRequestDescriptor(parsed.openuiCode);
      if (!descriptor) return null;
      return { index: idx, descriptor };
    }
  );

  // Check each card against subsequent cards
  for (let i = 0; i < items.length; i++) {
    const current = items[i];
    if (!current) continue;

    for (let j = i + 1; j < items.length; j++) {
      const later = items[j];
      if (!later) continue;

      if (isOpenUISameOrUpdatedRequest(current.descriptor, later.descriptor)) {
        superseded.add(current.index);
        break; // Once superseded, proceed to next message
      }
    }
  }

  return superseded;
}
