import {useState} from 'react';
import type {DraftCardData} from './api';

type Props = {
  draft: DraftCardData;
  onSend: (updated: DraftCardData) => void;
  onDiscard: (id: string) => void;
};

/**
 * Editable draft card for email and Slack messages (Polaris card tokens):
 * When a Bot prepares an external message, it surfaces this editable card.
 * The human inspects and can edit recipients, subject/channel, and body,
 * then explicitly clicks "Send email" / "Send message" or "Discard".
 */
export function DraftCard({draft, onSend, onDiscard}: Props) {
  const [to, setTo] = useState(draft.to);
  const [subjectOrChannel, setSubjectOrChannel] = useState(draft.subjectOrChannel);
  const [body, setBody] = useState(draft.body);
  const [status, setStatus] = useState<'draft' | 'sent' | 'discarded'>(draft.status);

  const isEmail = draft.kind === 'email';
  const title = isEmail ? 'New Email' : 'New Slack Message';
  const sendLabel = isEmail ? 'Send email' : 'Send message';

  const handleSend = () => {
    setStatus('sent');
    onSend({
      ...draft,
      to,
      subjectOrChannel,
      body,
      status: 'sent',
    });
  };

  const handleDiscard = () => {
    setStatus('discarded');
    onDiscard(draft.id);
  };

  if (status === 'sent') {
    return (
      <div
        data-testid="draft-card-sent"
        style={{
          border: '1px solid var(--border)',
          backgroundColor: 'var(--muted)',
          borderRadius: '16px',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '13px',
          color: 'var(--foreground)',
          maxWidth: '520px',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <span style={{color: 'var(--muted-foreground)'}}>
          {isEmail ? `Email sent to ${to}` : `Message sent to ${subjectOrChannel}`}
        </span>
      </div>
    );
  }

  if (status === 'discarded') {
    return (
      <div
        data-testid="draft-card-discarded"
        style={{
          border: '1px solid var(--border)',
          backgroundColor: 'var(--muted)',
          borderRadius: '16px',
          padding: '12px 16px',
          fontSize: '13px',
          color: 'var(--muted-foreground)',
          maxWidth: '520px',
        }}
      >
        {title} draft discarded.
      </div>
    );
  }

  return (
    <div
      data-testid="draft-card"
      style={{
        width: '100%',
        maxWidth: '520px',
        borderRadius: '20px',
        border: '1px solid var(--border)',
        backgroundColor: 'var(--card)',
        color: 'var(--card-foreground)',
        padding: '16px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        margin: '8px 0',
      }}
    >
      {/* Header */}
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px'}}>
        <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '28px',
              height: '28px',
              borderRadius: '8px',
              backgroundColor: 'var(--accent)',
              color: 'var(--foreground)',
            }}
          >
            {isEmail ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect width="20" height="16" x="2" y="4" rx="2" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4c0-1.1.9-2 2-2h8a2 2 0 0 1 2 2v5Z" />
                <path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1" />
              </svg>
            )}
          </span>
          <span style={{fontSize: '14px', fontWeight: 600, color: 'var(--foreground)'}}>
            {title}
          </span>
        </div>
        <span
          style={{
            backgroundColor: 'var(--accent)',
            color: 'var(--accent-foreground)',
            padding: '2px 8px',
            borderRadius: '9999px',
            fontSize: '11px',
            fontWeight: 500,
          }}
        >
          Editable Draft
        </span>
      </div>

      {/* Inputs */}
      <div style={{display: 'flex', flexDirection: 'column', gap: '10px'}}>
        <div style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
          <label style={{fontSize: '12px', fontWeight: 500, color: 'var(--muted-foreground)'}}>
            {isEmail ? 'To' : 'Channel / User'}
          </label>
          <input
            type="text"
            value={to}
            onChange={e => setTo(e.target.value)}
            placeholder={isEmail ? 'recipient@example.com' : '#channel-name'}
            style={{
              width: '100%',
              padding: '7px 10px',
              borderRadius: 'var(--radius-md, 8px)',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--input)',
              color: 'var(--foreground)',
              fontSize: '12.5px',
              outline: 'none',
              boxSizing: 'border-box',
              fontFamily: 'inherit',
            }}
          />
        </div>

        <div style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
          <label style={{fontSize: '12px', fontWeight: 500, color: 'var(--muted-foreground)'}}>
            {isEmail ? 'Subject' : 'Topic / Thread'}
          </label>
          <input
            type="text"
            value={subjectOrChannel}
            onChange={e => setSubjectOrChannel(e.target.value)}
            placeholder={isEmail ? 'Email subject line' : 'Topic or thread key'}
            style={{
              width: '100%',
              padding: '7px 10px',
              borderRadius: 'var(--radius-md, 8px)',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--input)',
              color: 'var(--foreground)',
              fontSize: '12.5px',
              outline: 'none',
              boxSizing: 'border-box',
              fontFamily: 'inherit',
            }}
          />
        </div>

        <div style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
          <label style={{fontSize: '12px', fontWeight: 500, color: 'var(--muted-foreground)'}}>
            Message Body
          </label>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={5}
            style={{
              width: '100%',
              padding: '8px 10px',
              borderRadius: 'var(--radius-md, 8px)',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--input)',
              color: 'var(--foreground)',
              fontSize: '12.5px',
              outline: 'none',
              resize: 'vertical',
              boxSizing: 'border-box',
              fontFamily: 'inherit',
              lineHeight: 1.5,
            }}
          />
        </div>
      </div>

      {/* Buttons */}
      <div style={{display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px'}}>
        <button
          type="button"
          onClick={handleSend}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            borderRadius: '9999px',
            border: 'none',
            backgroundColor: 'var(--primary)',
            color: 'var(--primary-foreground)',
            padding: '6px 16px',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
          <span>{sendLabel}</span>
        </button>

        <button
          type="button"
          onClick={handleDiscard}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            borderRadius: '9999px',
            border: '1px solid var(--border)',
            backgroundColor: 'transparent',
            color: 'var(--muted-foreground)',
            padding: '6px 14px',
            fontSize: '12px',
            fontWeight: 500,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <span>Discard</span>
        </button>
      </div>
    </div>
  );
}

/**
 * Parses markdown draft code blocks (e.g. ```draft:email or ```draft:slack)
 * into structured DraftCardData for in-transcript human approval.
 */
export function parseDraftsFromContent(content: string): {cleanContent: string; drafts: DraftCardData[]} {
  const regex = /```draft:(email|slack)\s*([\s\S]*?)```/gi;
  const drafts: DraftCardData[] = [];
  let match: RegExpExecArray | null;
  let idx = 1;
  while ((match = regex.exec(content)) !== null) {
    const kind = match[1].toLowerCase() as 'email' | 'slack';
    const raw = match[2];
    let to = '';
    let subjectOrChannel = '';
    let body = '';
    const lines = raw.split('\n');
    let inBody = false;
    for (const line of lines) {
      if (!inBody && (line.toLowerCase().startsWith('to:') || line.toLowerCase().startsWith('recipient:'))) {
        to = line.replace(/^(to|recipient):\s*/i, '').trim();
      } else if (!inBody && (line.toLowerCase().startsWith('subject:') || line.toLowerCase().startsWith('channel:'))) {
        subjectOrChannel = line.replace(/^(subject|channel):\s*/i, '').trim();
      } else if (!inBody && line.toLowerCase().startsWith('body:')) {
        inBody = true;
        body = line.replace(/^body:\s*/i, '');
      } else if (inBody) {
        body += (body ? '\n' : '') + line;
      } else if (!to && !subjectOrChannel) {
        body += (body ? '\n' : '') + line;
      }
    }
    drafts.push({
      id: `draft-${Date.now()}-${idx++}`,
      kind,
      to: to || (kind === 'email' ? 'recipient@example.com' : ''),
      subjectOrChannel: subjectOrChannel || (kind === 'email' ? 'Subject' : '#general'),
      body: body.trim(),
      status: 'draft',
    });
  }
  const cleanContent = content.replace(/```draft:(email|slack)\s*[\s\S]*?```/gi, '').trim();
  return {cleanContent: cleanContent || content, drafts};
}
