import {useState} from 'react';
import {Card} from '@astryxdesign/core/Card';
import {HStack} from '@astryxdesign/core/Stack';
import {VStack} from '@astryxdesign/core/VStack';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Button} from '@astryxdesign/core/Button';
import {Badge} from '@astryxdesign/core/Badge';
import {IconCheck, IconDraft, IconSend} from './icons';
import type {DraftCardData} from './api';

type Props = {
  draft: DraftCardData;
  onSend: (updated: DraftCardData) => void;
  onDiscard: (id: string) => void;
};

/**
 * Editable draft card for email and Slack messages (GrokBot spec):
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
      <Card variant="muted" padding={3}>
        <HStack gap={2} vAlign="center">
          <IconCheck size="sm" color="success" />
          <Text type="supporting" color="secondary">
            {isEmail ? `Email sent to ${to}` : `Message sent to ${subjectOrChannel}`}
          </Text>
        </HStack>
      </Card>
    );
  }

  if (status === 'discarded') {
    return (
      <Card variant="muted" padding={3}>
        <HStack gap={2} vAlign="center">
          <Text type="supporting" color="secondary">
            {title} draft discarded.
          </Text>
        </HStack>
      </Card>
    );
  }

  return (
    <Card variant="default" padding={4}>
      <VStack gap={3}>
        <HStack gap={2} vAlign="center" justify="between">
          <HStack gap={2} vAlign="center">
            <IconDraft size="md" color="accent" />
            <Text type="body" weight="semibold">
              {title}
            </Text>
          </HStack>
          <Badge label="Editable Draft" variant="neutral" />
        </HStack>

        <TextInput
          label={isEmail ? 'To' : 'Channel / User'}
          value={to}
          onChange={setTo}
          size="sm"
          placeholder={isEmail ? 'recipient@example.com' : '#channel-name'}
        />

        <TextInput
          label={isEmail ? 'Subject' : 'Topic / Thread'}
          value={subjectOrChannel}
          onChange={setSubjectOrChannel}
          size="sm"
          placeholder={isEmail ? 'Email subject line' : 'Topic or thread key'}
        />

        <VStack gap={1} align="start" width="100%">
          <Text type="supporting" size="xsm" weight="medium">
            Message Body
          </Text>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={5}
            style={{
              width: '100%',
              padding: '8px 12px',
              fontFamily: 'inherit',
              fontSize: '14px',
              backgroundColor: 'var(--input)',
              color: 'var(--foreground)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              resize: 'vertical',
            }}
          />
        </VStack>

        <HStack gap={2} vAlign="center">
          <Button
            label={sendLabel}
            variant="primary"
            size="sm"
            icon={<IconSend />}
            onClick={handleSend}
          />
          <Button
            label="Discard"
            variant="ghost"
            size="sm"
            onClick={handleDiscard}
          />
        </HStack>
      </VStack>
    </Card>
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
