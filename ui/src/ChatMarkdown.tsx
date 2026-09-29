import { memo, useCallback, useRef, useState, useMemo } from 'react';
import { Markdown } from '@astryxdesign/core/Markdown';
import { Copy, Check } from 'lucide-react';

export type ChatMarkdownProps = {
  children: string;
  streaming?: boolean;
  isStreaming?: boolean;
};

/**
 * Closes unclosed code fences (``` or ~~~) during live streaming
 * so syntax blocks render properly as code while arriving over SSE.
 */
export function closeUnterminatedFence(markdown: string): string {
  let openFence: { marker: '`' | '~'; length: number } | undefined;

  for (const line of markdown.split('\n')) {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!match?.[1]) continue;

    const marker = match[1][0] as '`' | '~';
    if (!openFence) {
      openFence = { marker, length: match[1].length };
      continue;
    }

    if (
      marker === openFence.marker &&
      match[1].length >= openFence.length &&
      (match[2] ?? '').trim() === ''
    ) {
      openFence = undefined;
    }
  }

  return openFence ? `${markdown}\n${openFence.marker.repeat(openFence.length)}` : markdown;
}

/**
 * Ensures incomplete markdown table delimiter rows or trailing pipe rows
 * are completed during live streaming so the table renders as a table
 * while streaming, not only after stream closes.
 */
export function closeUnterminatedTable(markdown: string): string {
  const lines = markdown.split('\n');
  if (lines.length === 0) return markdown;
  const lastLine = lines[lines.length - 1];

  // If the last line is a delimiter row or table row that started with | but is unclosed
  if (lines.length >= 2 && lastLine.trim().startsWith('|')) {
    const prevLine = lines[lines.length - 2].trim();
    if (prevLine.startsWith('|') && prevLine.endsWith('|')) {
      const headerCols = prevLine.split('|').length - 2;
      // If lastLine is an incomplete delimiter row like "| ---"
      if (/^\|\s*:?-+:?\s*(\|?\s*:?-+:?\s*)*$/.test(lastLine.trim())) {
        const currentDelimCols = lastLine.trim().split('|').filter(c => c.trim().length > 0).length;
        const missing = Math.max(0, headerCols - currentDelimCols);
        if (missing > 0) {
          lines[lines.length - 1] = lastLine + ' --- |'.repeat(missing);
          return lines.join('\n');
        } else if (!lastLine.trim().endsWith('|')) {
          lines[lines.length - 1] = lastLine + ' |';
          return lines.join('\n');
        }
      }
    }
  }

  if (lastLine.trim().startsWith('|') && !lastLine.trim().endsWith('|')) {
    lines[lines.length - 1] = lastLine + ' |';
    return lines.join('\n');
  }

  return markdown;
}

function CodeBlock({ code, language: _language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | undefined>(undefined);

  const handleCopy = useCallback(() => {
    if (!navigator.clipboard) return;
    navigator.clipboard
      .writeText(code)
      .then(() => {
        setCopied(true);
        window.clearTimeout(resetTimerRef.current);
        resetTimerRef.current = window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }, [code]);

  return (
    <div
      className="rk-chat-markdown-pre-wrap group/code"
      style={{ position: 'relative', margin: '0.65em 0' }}
    >
      <pre
        style={{
          margin: 0,
          padding: '0.8em 0.9em',
          backgroundColor: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: '0.75em',
          overflowX: 'auto',
          fontSize: '0.84em',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          color: 'var(--foreground)',
        }}
      >
        <code>{code}</code>
      </pre>
      <button
        type="button"
        className="rk-chat-markdown-copy"
        data-testid="rk-code-copy"
        onClick={handleCopy}
        aria-label={copied ? 'Copied' : 'Copy code'}
        title={copied ? 'Copied' : 'Copy code'}
      >
        {copied ? <Check size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={2} />}
      </button>
    </div>
  );
}

/**
 * Polaris ChatMarkdown component with:
 * - per-block copy buttons
 * - auto-closing code fences during live streaming
 * - live streaming table support
 * - animated cursor during stream
 */
export const ChatMarkdown = memo(function ChatMarkdown({
  children,
  streaming = false,
  isStreaming = false,
}: ChatMarkdownProps) {
  const activeStreaming = streaming || isStreaming;
  const processedText = useMemo(() => {
    if (!activeStreaming) return children;
    let text = closeUnterminatedFence(children);
    text = closeUnterminatedTable(text);
    return text;
  }, [children, activeStreaming]);

  const components = useMemo(
    () => ({
      code: CodeBlock,
    }),
    [],
  );

  return (
    <div className={activeStreaming ? 'rk-chat-markdown rk-chat-markdown-streaming' : 'rk-chat-markdown'}>
      <Markdown isStreaming={activeStreaming} autolink="gfm" components={components}>
        {processedText}
      </Markdown>
      {activeStreaming ? <span aria-hidden="true" className="rk-chat-markdown-cursor" /> : null}
    </div>
  );
});
