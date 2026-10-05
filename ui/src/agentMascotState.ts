/**
 * Pure, typed resolver for the agent mascot's animation and expression state.
 *
 * Precedence hierarchy (explicit & justified):
 * 1. `needs_you`: Human input/approval/secret required. Highest priority because
 *    the agent is paused and cannot proceed without user action.
 * 2. `error`: Health check down or turn failed. Outranks active operations since
 *    work cannot succeed reliably in an error state.
 * 3. `tool`: External tool execution in flight (terminal, browser, file edit).
 *    More concrete/specific than general reasoning.
 * 4. `thinking`: Reasoning/chain-of-thought stream active prior to or alongside output.
 * 5. `working`: Active response generation or text streaming.
 * 6. `finished`: Transient success marker immediately after a turn lands.
 * 7. `sleeping`: Disconnected, offline, or absent session.
 * 8. `idle`: Ready and waiting for user prompt (default online state).
 */

export type MascotState =
  | 'idle'
  | 'thinking'
  | 'working'
  | 'tool'
  | 'needs_you'
  | 'error'
  | 'finished'
  | 'sleeping';

export interface MascotSignals {
  /** Active or pending human intervention */
  activeIntervention?: {state?: string; status?: string} | null;
  interventions?: Array<{state?: string; status?: string}> | null;
  hasPendingIntervention?: boolean;

  /** Pending secret requests awaiting user submission */
  secretCards?: unknown[] | null;
  hasPendingSecret?: boolean;

  /** Pending draft skill/action cards awaiting user review */
  draftCards?: unknown[] | null;
  hasPendingDraft?: boolean;

  /** Explicit flag indicating user action is needed */
  needsYou?: boolean;

  /** Health probe result (`false` indicates API down) */
  healthOk?: boolean | null;

  /** Explicit failure flag or error message */
  hasError?: boolean;
  errorMessage?: string | null;

  /** Active tool calls running or pending */
  toolCalls?: Array<{status?: string}> | null;
  hasActiveTool?: boolean;

  /** Streamed chain-of-thought / reasoning text */
  streamThinking?: string | null;
  isThinking?: boolean;

  /** Streaming response / working flag */
  isStreaming?: boolean;
  isWorking?: boolean;

  /** Transient finished state after turn completion */
  isFinished?: boolean;

  /** Session presence (`false` indicates no active session) */
  hasSession?: boolean;

  /** Explicit offline indicator */
  isOffline?: boolean;
}

/**
 * Resolves the agent's mascot visual state strictly from real telemetry signals.
 *
 * Pure function: no React dependencies, no timers, no fake progress loops.
 */
export function resolveMascotState(signals: MascotSignals = {}): MascotState {
  // 1. needs_you: pending intervention, secret request, or draft card
  const hasIntervention =
    Boolean(signals.hasPendingIntervention) ||
    (signals.activeIntervention != null &&
      (signals.activeIntervention.state === 'pending' ||
        signals.activeIntervention.status === 'pending')) ||
    (Array.isArray(signals.interventions) &&
      signals.interventions.some(
        i => i && (i.state === 'pending' || i.status === 'pending'),
      ));

  const hasSecret =
    Boolean(signals.hasPendingSecret) ||
    (Array.isArray(signals.secretCards) && signals.secretCards.length > 0);

  const hasDraft =
    Boolean(signals.hasPendingDraft) ||
    (Array.isArray(signals.draftCards) && signals.draftCards.length > 0);

  if (signals.needsYou || hasIntervention || hasSecret || hasDraft) {
    return 'needs_you';
  }

  // 2. error: API health check failure or explicit turn error
  if (
    signals.hasError ||
    signals.healthOk === false ||
    Boolean(signals.errorMessage)
  ) {
    return 'error';
  }

  // 3. tool: active tool call executing or pending
  const hasTool =
    Boolean(signals.hasActiveTool) ||
    (Array.isArray(signals.toolCalls) &&
      signals.toolCalls.some(
        t => t && (t.status === 'running' || t.status === 'pending'),
      ));

  if (hasTool) {
    return 'tool';
  }

  // 4. thinking: streamThinking present or explicit thinking flag
  const isThinking =
    Boolean(signals.isThinking) ||
    (typeof signals.streamThinking === 'string' &&
      signals.streamThinking.trim().length > 0);

  if (isThinking) {
    return 'thinking';
  }

  // 5. working: streaming response text or working flag
  if (signals.isStreaming || signals.isWorking) {
    return 'working';
  }

  // 6. finished: turn just landed (transient)
  if (signals.isFinished) {
    return 'finished';
  }

  // 7. sleeping: offline or no session
  if (signals.isOffline === true || signals.hasSession === false) {
    return 'sleeping';
  }

  // 8. idle: default state when connected
  return 'idle';
}
