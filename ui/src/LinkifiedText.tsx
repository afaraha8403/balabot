import type { ReactNode } from 'react';

export type PlainTextPart =
  | { type: 'text'; value: string }
  | { type: 'link'; value: string; href: string };

const URL_OR_EMAIL_PATTERN =
  /(?:https?:\/\/[^\s]+)|(?:[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;

export function plainTextLinkParts(text: string): PlainTextPart[] {
  if (!text) return [{ type: 'text', value: '' }];
  const parts: PlainTextPart[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = URL_OR_EMAIL_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    const val = match[0];
    const isEmail = val.includes('@') && !val.startsWith('http');
    const href = isEmail ? `mailto:${val}` : val;
    parts.push({ type: 'link', value: val, href });
    lastIndex = match.index + val.length;
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', value: text.slice(lastIndex) });
  }

  return parts.length > 0 ? parts : [{ type: 'text', value: text }];
}

/**
 * Split plain user-message text into literal runs and tappable links.
 * User bubbles stay plain text on web and mobile. Bold, headings, and other
 * markdown remain characters. Only explicit URLs and email addresses are links.
 */
export function LinkifiedText({ children }: { children: string }): ReactNode {
  return (
    <>
      {plainTextLinkParts(children).map((part, index) =>
        part.type === 'text' ? (
          part.value
        ) : (
          <a
            key={index}
            href={part.href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-link underline"
            style={{ color: 'var(--link, #3b82f6)', textDecoration: 'underline' }}
          >
            {part.value}
          </a>
        ),
      )}
    </>
  );
}
