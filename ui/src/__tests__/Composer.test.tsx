import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Composer,
  resolveMentionPickerKey,
  serializeComposerPrompt,
  truncateSlashDescription,
} from '../Composer';
import * as api from '../api';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return {
    ...actual,
    uploadAttachment: vi.fn(),
  };
});

describe('Composer - Keyboard Guardrails & Pure Helpers', () => {
  describe('resolveMentionPickerKey', () => {
    it('returns { type: "send" } when Enter is pressed without Shift and no picker is open', () => {
      const action = resolveMentionPickerKey({
        key: 'Enter',
        shiftKey: false,
        isComposing: false,
        optionCount: 0,
        highlightedIndex: 0,
      });
      expect(action).toEqual({ type: 'send' });
    });

    it('returns { type: "none" } when Shift+Enter is pressed (Shift+Enter does not send)', () => {
      const action = resolveMentionPickerKey({
        key: 'Enter',
        shiftKey: true,
        isComposing: false,
        optionCount: 0,
        highlightedIndex: 0,
      });
      expect(action).toEqual({ type: 'none' });
    });

    it('returns { type: "none" } on Enter when isComposing is true (IME composition guardrail)', () => {
      const action = resolveMentionPickerKey({
        key: 'Enter',
        shiftKey: false,
        isComposing: true,
        optionCount: 0,
        highlightedIndex: 0,
      });
      expect(action).toEqual({ type: 'none' });
    });

    it('ignores navigation keys during IME composition even when options are present', () => {
      expect(
        resolveMentionPickerKey({
          key: 'ArrowDown',
          isComposing: true,
          optionCount: 5,
          highlightedIndex: 0,
        }),
      ).toEqual({ type: 'none' });

      expect(
        resolveMentionPickerKey({
          key: 'Enter',
          isComposing: true,
          optionCount: 5,
          highlightedIndex: 0,
        }),
      ).toEqual({ type: 'none' });
    });

    it('navigates options with ArrowUp/ArrowDown when picker is open', () => {
      const down = resolveMentionPickerKey({
        key: 'ArrowDown',
        shiftKey: false,
        isComposing: false,
        optionCount: 3,
        highlightedIndex: 0,
      });
      expect(down).toEqual({ type: 'move', index: 1 });

      const up = resolveMentionPickerKey({
        key: 'ArrowUp',
        shiftKey: false,
        isComposing: false,
        optionCount: 3,
        highlightedIndex: 0,
      });
      expect(up).toEqual({ type: 'move', index: 2 }); // wraps around
    });

    it('completes selection on Enter or Tab when picker is open', () => {
      const enter = resolveMentionPickerKey({
        key: 'Enter',
        shiftKey: false,
        isComposing: false,
        optionCount: 3,
        highlightedIndex: 1,
      });
      expect(enter).toEqual({ type: 'complete', index: 1 });

      const tab = resolveMentionPickerKey({
        key: 'Tab',
        shiftKey: false,
        isComposing: false,
        optionCount: 3,
        highlightedIndex: 2,
      });
      expect(tab).toEqual({ type: 'complete', index: 2 });
    });

    it('dismisses picker on Escape', () => {
      const esc = resolveMentionPickerKey({
        key: 'Escape',
        isComposing: false,
        optionCount: 3,
        highlightedIndex: 0,
      });
      expect(esc).toEqual({ type: 'dismiss' });
    });
  });

  describe('serializeComposerPrompt', () => {
    it('serializes plain text without skill or mentions', () => {
      expect(serializeComposerPrompt('hello world', null, [])).toBe('hello world');
    });

    it('prefixes mentions before draft text', () => {
      expect(
        serializeComposerPrompt('review this code', null, [{ name: 'auditor' }, { name: 'lead' }]),
      ).toBe('@auditor @lead review this code');
    });

    it('prefixes skill command on the first line when skill is selected', () => {
      expect(
        serializeComposerPrompt('analyze performance', { name: 'profiler' }, []),
      ).toBe('/profiler\nanalyze performance');
    });
  });

  describe('truncateSlashDescription', () => {
    it('truncates long descriptions cleanly with ellipsis', () => {
      const long = 'This is a very long description that exceeds the normal maximum character allowance and should be cleanly trimmed.';
      const truncated = truncateSlashDescription(long, 40);
      expect(truncated.length).toBeLessThanOrEqual(40);
      expect(truncated.endsWith('…')).toBe(true);
    });

    it('leaves short descriptions untouched', () => {
      expect(truncateSlashDescription('Short help', 40)).toBe('Short help');
    });
  });
});

describe('Composer Component - DOM & Interaction Guardrails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('submits on Enter press but NOT on Shift+Enter', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onStop = vi.fn();

    render(
      <Composer
        isStreaming={false}
        onSubmit={onSubmit}
        onStop={onStop}
        botName="TestBot"
      />,
    );

    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;

    // Type text
    await user.type(textarea, 'First line');

    // Press Shift+Enter -> MUST NOT submit
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(onSubmit).not.toHaveBeenCalled();

    // Press plain Enter -> MUST submit
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('First line', [], undefined);
    expect(textarea.value).toBe('');
  });

  it('prevents submission on Enter while IME composition is active', async () => {
    const onSubmit = vi.fn();
    const onStop = vi.fn();

    render(
      <Composer
        isStreaming={false}
        onSubmit={onSubmit}
        onStop={onStop}
        botName="TestBot"
      />,
    );

    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;

    // Set value
    fireEvent.change(textarea, { target: { value: 'Chinese input in progress' } });

    // Simulate IME Enter event where isComposing is true
    fireEvent.keyDown(textarea, {
      key: 'Enter',
      keyCode: 229,
      nativeEvent: { isComposing: true },
    });

    expect(onSubmit).not.toHaveBeenCalled();

    // Simulate regular Enter (isComposing: false) -> sends
    fireEvent.keyDown(textarea, {
      key: 'Enter',
      keyCode: 13,
      nativeEvent: { isComposing: false },
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('Chinese input in progress', [], undefined);
  });

  it('refuses attachments exceeding the 25 MB ceiling with a visible refusal error', async () => {
    const onSubmit = vi.fn();
    const onStop = vi.fn();

    const { container } = render(
      <Composer
        isStreaming={false}
        onSubmit={onSubmit}
        onStop={onStop}
        botName="TestBot"
      />,
    );

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeInTheDocument();

    // Create a mock 26 MB file
    const largeFile = new File(['x'], 'giant-archive.pdf', { type: 'application/pdf' });
    Object.defineProperty(largeFile, 'size', { value: 26 * 1024 * 1024 });

    fireEvent.change(fileInput, { target: { files: [largeFile] } });

    // Visible error appears
    const errorEl = await screen.findByTestId('composer-attachment-error');
    expect(errorEl).toBeInTheDocument();
    expect(errorEl).toHaveTextContent(/is too large \(26\.0 MB\)\. Exceeds the 25 MB limit\./i);

    // API upload was NOT called
    expect(api.uploadAttachment).not.toHaveBeenCalled();
  });

  it('refuses attachments with unsupported MIME/extension types with a visible refusal error', async () => {
    const onSubmit = vi.fn();
    const onStop = vi.fn();

    const { container } = render(
      <Composer
        isStreaming={false}
        onSubmit={onSubmit}
        onStop={onStop}
        botName="TestBot"
      />,
    );

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

    // Create an unsupported .exe file
    const unsupportedFile = new File(['binary content'], 'script.exe', { type: 'application/x-msdownload' });
    Object.defineProperty(unsupportedFile, 'size', { value: 1024 });

    fireEvent.change(fileInput, { target: { files: [unsupportedFile] } });

    const errorEl = await screen.findByTestId('composer-attachment-error');
    expect(errorEl).toBeInTheDocument();
    expect(errorEl).toHaveTextContent(/Unsupported file type "\.exe" for "script\.exe"/i);
    expect(api.uploadAttachment).not.toHaveBeenCalled();
  });

  it('accepts and renders valid attachment within whitelist and size limit', async () => {
    const onSubmit = vi.fn();
    const onStop = vi.fn();

    vi.mocked(api.uploadAttachment).mockResolvedValueOnce({
      id: 'att_123',
      name: 'notes.txt',
      size: 1024,
      mime_type: 'text/plain',
    });

    const { container } = render(
      <Composer
        isStreaming={false}
        onSubmit={onSubmit}
        onStop={onStop}
        botName="TestBot"
      />,
    );

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const validFile = new File(['valid text content'], 'notes.txt', { type: 'text/plain' });
    Object.defineProperty(validFile, 'size', { value: 1024 });

    fireEvent.change(fileInput, { target: { files: [validFile] } });

    await waitFor(() => {
      expect(api.uploadAttachment).toHaveBeenCalledWith(validFile);
    });

    expect(await screen.findByText('notes.txt')).toBeInTheDocument();
    expect(screen.queryByTestId('composer-attachment-error')).not.toBeInTheDocument();
  });
});
