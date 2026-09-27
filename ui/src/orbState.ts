import type {OrbState} from 'thinking-orbs';
import type {ToolProgress} from './api';

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
