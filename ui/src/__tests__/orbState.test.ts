import {describe, expect, it} from 'vitest';
import {
  resolveMascotState,
  type MascotSignals,
  type MascotState,
} from '../orbState';

describe('orbState mascot resolver', () => {
  it('resolves idle by default when online with session', () => {
    expect(resolveMascotState({})).toBe('idle');
    expect(resolveMascotState({hasSession: true})).toBe('idle');
  });

  it('resolves sleeping when offline or without session', () => {
    expect(resolveMascotState({hasSession: false})).toBe('sleeping');
    expect(resolveMascotState({isOffline: true})).toBe('sleeping');
  });

  it('resolves finished when turn just landed', () => {
    expect(resolveMascotState({isFinished: true})).toBe('finished');
  });

  it('resolves working when streaming without tool or thinking', () => {
    expect(resolveMascotState({isStreaming: true})).toBe('working');
    expect(resolveMascotState({isWorking: true})).toBe('working');
  });

  it('resolves thinking when streamThinking is present', () => {
    expect(resolveMascotState({isStreaming: true, streamThinking: 'Let me think...'})).toBe('thinking');
    expect(resolveMascotState({isThinking: true})).toBe('thinking');
  });

  it('reuses OrbState families for recognized active tools', () => {
    expect(
      resolveMascotState({
        toolCalls: [{tool: 'web_search', status: 'running'} as any],
      }),
    ).toBe('searching');

    expect(
      resolveMascotState({
        toolCalls: [{tool: 'write_file', status: 'running'} as any],
      }),
    ).toBe('composing');

    expect(
      resolveMascotState({
        toolCalls: [{tool: 'bash', status: 'running'} as any],
      }),
    ).toBe('solving');

    expect(
      resolveMascotState({
        toolCalls: [{tool: 'delegate_task', status: 'running'} as any],
      }),
    ).toBe('connecting');
  });

  it('resolves tool when an unclassified tool is running or pending', () => {
    expect(
      resolveMascotState({
        isStreaming: true,
        streamThinking: 'Thinking',
        toolCalls: [{status: 'running'}],
      }),
    ).toBe('tool');
    expect(
      resolveMascotState({
        toolCalls: [{status: 'pending'}],
      }),
    ).toBe('tool');
    expect(resolveMascotState({hasActiveTool: true})).toBe('tool');
  });

  it('resolves error when healthOk is false or hasError is set', () => {
    expect(resolveMascotState({healthOk: false})).toBe('error');
    expect(
      resolveMascotState({
        healthOk: false,
        isStreaming: true,
        toolCalls: [{status: 'running'}],
      }),
    ).toBe('error');
    expect(resolveMascotState({hasError: true})).toBe('error');
    expect(resolveMascotState({errorMessage: 'Failed to connect'})).toBe('error');
  });

  it('resolves needs_you on pending intervention, secret, or draft', () => {
    expect(resolveMascotState({needsYou: true})).toBe('needs_you');
    expect(resolveMascotState({activeIntervention: {state: 'pending'}})).toBe('needs_you');
    expect(resolveMascotState({interventions: [{status: 'pending'}]})).toBe('needs_you');
    expect(resolveMascotState({secretCards: [{id: 'sec-1'}]})).toBe('needs_you');
    expect(resolveMascotState({draftCards: [{id: 'draft-1'}]})).toBe('needs_you');
    expect(resolveMascotState({hasPendingIntervention: true})).toBe('needs_you');
    expect(resolveMascotState({hasPendingSecret: true})).toBe('needs_you');
    expect(resolveMascotState({hasPendingDraft: true})).toBe('needs_you');
  });

  describe('precedence order boundaries: needs_you > error > tool > thinking > working > finished > idle > sleeping', () => {
    it('boundary: needs_you takes precedence over error', () => {
      const errorOnly: MascotSignals = {
        healthOk: false,
        hasError: true,
      };
      expect(resolveMascotState(errorOnly)).toBe('error');

      // Boundary flip: adding intervention flips answer from error to needs_you
      const withIntervention: MascotSignals = {
        ...errorOnly,
        needsYou: true,
      };
      expect(resolveMascotState(withIntervention)).toBe('needs_you');
    });

    it('boundary: error takes precedence over tool', () => {
      const toolOnly: MascotSignals = {
        hasActiveTool: true,
        toolCalls: [{tool: 'bash', status: 'running'} as any],
      };
      expect(resolveMascotState(toolOnly)).toBe('solving');

      // Boundary flip: healthOk: false flips answer to error
      expect(resolveMascotState({...toolOnly, healthOk: false})).toBe('error');
    });

    it('boundary: tool takes precedence over thinking', () => {
      const thinkingOnly: MascotSignals = {
        streamThinking: 'Analyzing logs...',
      };
      expect(resolveMascotState(thinkingOnly)).toBe('thinking');

      // Boundary flip: running tool takes precedence
      expect(
        resolveMascotState({
          ...thinkingOnly,
          toolCalls: [{tool: 'grep', status: 'running'} as any],
        }),
      ).toBe('searching');
    });

    it('boundary: thinking takes precedence over working', () => {
      const workingOnly: MascotSignals = {
        isStreaming: true,
      };
      expect(resolveMascotState(workingOnly)).toBe('working');

      // Boundary flip: adding reasoning text flips to thinking
      expect(
        resolveMascotState({
          ...workingOnly,
          streamThinking: 'Drafting plan...',
        }),
      ).toBe('thinking');
    });

    it('boundary: working takes precedence over finished', () => {
      const finishedOnly: MascotSignals = {
        isFinished: true,
      };
      expect(resolveMascotState(finishedOnly)).toBe('finished');

      // Boundary flip: new turn streaming takes precedence over transient finished
      expect(
        resolveMascotState({
          ...finishedOnly,
          isStreaming: true,
        }),
      ).toBe('working');
    });

    it('boundary: finished takes precedence over idle', () => {
      expect(resolveMascotState({hasSession: true})).toBe('idle');
      expect(resolveMascotState({hasSession: true, isFinished: true})).toBe('finished');
    });

    it('boundary: finished takes precedence over sleeping', () => {
      expect(resolveMascotState({hasSession: false})).toBe('sleeping');
      expect(resolveMascotState({hasSession: false, isFinished: true})).toBe('finished');
    });

    it('boundary: idle takes precedence over sleeping when session exists', () => {
      expect(resolveMascotState({hasSession: true})).toBe('idle');
      expect(resolveMascotState({hasSession: false})).toBe('sleeping');
    });
  });
});
