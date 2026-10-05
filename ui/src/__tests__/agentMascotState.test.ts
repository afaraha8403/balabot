import {describe, expect, it} from 'vitest';
import {
  resolveMascotState,
  type MascotSignals,
  type MascotState,
} from '../agentMascotState';

describe('agentMascotState resolver', () => {
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

  it('resolves working when streaming', () => {
    expect(resolveMascotState({isStreaming: true})).toBe('working');
    expect(resolveMascotState({isWorking: true})).toBe('working');
  });

  it('resolves thinking when streamThinking is present', () => {
    expect(resolveMascotState({isStreaming: true, streamThinking: 'Let me think...'})).toBe('thinking');
    expect(resolveMascotState({isThinking: true})).toBe('thinking');
  });

  it('resolves tool when a tool is running or pending', () => {
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

  describe('precedence order boundaries', () => {
    it('needs_you takes precedence over error', () => {
      const signals: MascotSignals = {
        needsYou: true,
        healthOk: false,
        hasError: true,
      };
      expect(resolveMascotState(signals)).toBe('needs_you');
    });

    it('error takes precedence over tool', () => {
      const signals: MascotSignals = {
        healthOk: false,
        hasActiveTool: true,
        toolCalls: [{status: 'running'}],
      };
      expect(resolveMascotState(signals)).toBe('error');
    });

    it('tool takes precedence over thinking', () => {
      const signals: MascotSignals = {
        toolCalls: [{status: 'running'}],
        streamThinking: 'Analyzing logs...',
      };
      expect(resolveMascotState(signals)).toBe('tool');
    });

    it('thinking takes precedence over working', () => {
      const signals: MascotSignals = {
        isStreaming: true,
        streamThinking: 'Drafting plan...',
      };
      expect(resolveMascotState(signals)).toBe('thinking');
    });

    it('working takes precedence over finished', () => {
      const signals: MascotSignals = {
        isStreaming: true,
        isFinished: true,
      };
      expect(resolveMascotState(signals)).toBe('working');
    });

    it('finished takes precedence over idle', () => {
      const signals: MascotSignals = {
        isFinished: true,
        hasSession: true,
      };
      expect(resolveMascotState(signals)).toBe('finished');
    });

    it('finished takes precedence over sleeping', () => {
      const signals: MascotSignals = {
        isFinished: true,
        hasSession: false,
      };
      expect(resolveMascotState(signals)).toBe('finished');
    });

    it('idle takes precedence over sleeping when session exists', () => {
      expect(resolveMascotState({hasSession: true})).toBe('idle');
      expect(resolveMascotState({hasSession: false})).toBe('sleeping');
    });
  });
});
