import type {OrbState} from 'thinking-orbs';
import type {ToolProgress} from './api';

export type {OrbState};

/**
 * Translate real agent activity into the vocabulary the UI uses.
 *
 * The gateway reports each tool invocation on `hermes.tool.progress`, so the
 * orb no longer has to guess: it can say what the agent is actually doing. The
 * rule is that a specific state is only claimed when the tool genuinely falls in
 * that family — anything unrecognised stays `working` rather than picking a
 * decorative animation. An orb reading "searching" while the agent edits a file
 * is the same class of dishonesty as a fabricated chat preview.
 */
export function orbStateForTool(tool: string | undefined): OrbState {
  if (!tool) return 'working';
  const t = tool.toLowerCase();

  if (/(search|find|grep|glob|web|browse|browser|fetch|scrape|crawl|lookup|research|arxiv|polymarket)/.test(t)) {
    return 'searching';
  }
  if (/(write|edit|patch|create|append|doc|slide|deck|sheet|ppt|docx|xlsx|pdf|render|video|image|media)/.test(t)) {
    return 'composing';
  }
  if (/(terminal|shell|bash|exec|run|command|code|python|node|test|build|compile|lint)/.test(t)) {
    return 'solving';
  }
  if (/(delegate|spawn|agent|send|message|email|mail|task|handoff|notify|slack|telegram)/.test(t)) {
    return 'connecting';
  }
  return 'working';
}

/** Astryx's ChatToolCalls says 'complete'; the gateway says 'completed'. */
export type ToolCallStatus = 'pending' | 'running' | 'complete' | 'error';

export function toToolCallStatus(status: ToolProgress['status']): ToolCallStatus {
  return status === 'completed' ? 'complete' : status;
}

/**
 * The gateway emits the SAME toolCallId twice — once `running`, once
 * `completed`. Appending blindly would show every tool twice, so merge on id and
 * let the later frame win. The `label` (the target) arrives on the running frame
 * and is absent from the completion frame, so it has to survive the merge.
 */
export function mergeToolProgress(list: ToolProgress[], next: ToolProgress): ToolProgress[] {
  const i = list.findIndex(t => t.toolCallId === next.toolCallId);
  if (i === -1) return [...list, next];
  const merged = {...list[i], ...next, label: next.label ?? list[i].label};
  const out = list.slice();
  out[i] = merged;
  return out;
}

/** The tool to narrate right now: the most recent one still in flight. */
export function activeTool(list: ToolProgress[]): ToolProgress | undefined {
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].status === 'running' || list[i].status === 'pending') return list[i];
  }
  return undefined;
}

/**
 * Visual expression and motion state for the agent mascot.
 *
 * Reuses the existing `OrbState` tool families (`working`, `searching`, `composing`,
 * `solving`, `connecting`) plus a generic `'tool'` fallback when an active tool has not
 * yet been classified by name.
 *
 * Additional states that `OrbState` genuinely cannot express:
 * - `idle`: Agent is connected and ready, with an active session, but not actively executing.
 *   `OrbState` only models active tool execution families, not baseline readiness.
 * - `thinking`: Agent is streaming introspective reasoning/chain-of-thought prior to
 *   or alongside actions. `OrbState` models task execution, not reasoning introspection.
 * - `needs_you`: Execution is paused because human intervention, approval of an action/draft,
 *   or a sensitive credential submission is required. `OrbState` has no concept of a
 *   human-in-the-loop pause.
 * - `error`: Gateway health probe failure or execution failure. `OrbState` only models forward
 *   progress, not failure or disconnected health.
 * - `finished`: Transient celebration/completion state immediately after a turn lands.
 *   `OrbState` has no celebratory turn-completion marker.
 * - `sleeping`: Disconnected, offline, or absent session. `OrbState` has no offline representation.
 */
export type MascotState =
  | OrbState
  | 'tool'
  | 'idle'
  | 'thinking'
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
  toolCalls?: Array<{tool?: string; status?: string}> | null;
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
 * Precedence hierarchy (explicit & justified):
 * 1. `needs_you`: Human input/approval/secret required. Highest priority because
 *    the agent is paused and cannot proceed without user action.
 * 2. `error`: Health check down or turn failed. Outranks active operations since
 *    work cannot succeed reliably in an error state.
 * 3. `tool` / `OrbState` tool families (`searching` | `composing` | `solving` | `connecting` | `working`):
 *    Active tool execution in flight. Reuses `orbStateForTool()` when a tool name is present.
 *    More concrete and specific than introspective reasoning.
 * 4. `thinking`: Reasoning/chain-of-thought stream active prior to or alongside output.
 * 5. `working`: Active response generation or text streaming without specialized tool execution.
 * 6. `finished`: Transient success marker immediately after a turn lands.
 * 7. `idle`: Ready and waiting for user prompt (default online state with active session).
 * 8. `sleeping`: Disconnected, offline, or absent session.
 *
 * Pure function: no React dependencies, no timers, no fake progress loops.
 */
export function resolveMascotState(signals: MascotSignals = {}): MascotState {
  // 1. needs_you: pending intervention, secret request, or draft card
  const hasIntervention =
    Boolean(signals.needsYou) ||
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

  if (hasIntervention || hasSecret || hasDraft) {
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

  // 3. tool / OrbState families: active tool call executing or pending
  const inFlightTool = Array.isArray(signals.toolCalls)
    ? (activeTool(signals.toolCalls as ToolProgress[]) as {tool?: string; status?: string} | undefined)
    : undefined;

  const hasTool =
    Boolean(signals.hasActiveTool) ||
    Boolean(inFlightTool) ||
    (Array.isArray(signals.toolCalls) &&
      signals.toolCalls.some(
        t => t && (t.status === 'running' || t.status === 'pending'),
      ));

  if (hasTool) {
    if (inFlightTool?.tool) {
      return orbStateForTool(inFlightTool.tool);
    }
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

  // 7. idle vs 8. sleeping
  if (signals.isOffline === true || signals.hasSession === false) {
    return 'sleeping';
  }

  return 'idle';
}
