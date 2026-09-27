import {useRef, useState} from 'react';
import {HStack} from '@astryxdesign/core/Stack';
import {VStack} from '@astryxdesign/core/VStack';
import {Text} from '@astryxdesign/core/Text';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Button} from '@astryxdesign/core/Button';
import {Token} from '@astryxdesign/core/Token';
import {Timestamp} from '@astryxdesign/core/Timestamp';
import {Avatar} from '@astryxdesign/core/Avatar';
import {Selector} from '@astryxdesign/core/Selector';
import {IconClose, IconConcealOrWarning, IconError, IconSuccess} from './icons';
import type {Bot} from './api';
import {
  ChatMessage as ChatMessageRow,
  ChatMessageBubble,
} from '@astryxdesign/core/Chat';
import {postOrgSecret, type SecretCard, type SecretSaveResult} from './api';

type ShareChoice = 'self' | 'all' | 'choose' | 'another-org';

type Props = {
  card: SecretCard;
  /** The fleet's bots — the real share targets. */
  bots: Bot[];
  onResolve: (requestId: string, status: SecretCard['status']) => void;
};

/**
 * In-chat secret request card — "the interface is in the chat, the value never is".
 *
 * SECURITY INVARIANT (do not refactor away):
 * The secret VALUE is read from the password input's DOM ref at submit time,
 * POSTed straight to POST /api/org/secrets, and the field is cleared
 * immediately after. The value NEVER enters React state — no useState, no
 * store, no chat message, no transcript render, no console.log. The only
 * state in this component is share choice, save result metadata (name,
 * fingerprint, granted scope), and error text.
 */
export function SecretRequestCard({card, bots, onResolve}: Props) {
  // The ONLY reference to the value: the DOM input itself. Never mirrored
  // into component state — read it from the ref at submit time only.
  const valueInputRef = useRef<HTMLInputElement | null>(null);
  const [share, setShare] = useState<ShareChoice>('self');
  const [chosenBot, setChosenBot] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [result, setResult] = useState<SecretSaveResult | null>(null);
  const [error, setError] = useState('');

  const resolved = card.status !== undefined;
  const isAccessRequest = card.kind === 'secret_access_request';

  /** Wipe the value from the DOM the moment we no longer need it. */
  const clearValue = () => {
    if (valueInputRef.current) valueInputRef.current.value = '';
  };

  const cancel = () => {
    clearValue();
    onResolve(card.requestId, {state: 'cancelled'});
  };

  const save = async () => {
    // Read the value straight from the DOM at submit time — it has never
    // passed through React state at any point in this component's life.
    const value = valueInputRef.current?.value ?? '';
    if (!value) return;
    setIsSaving(true);
    setError('');
    try {
      const shareValue =
        share === 'self'
          ? [card.bot]
          : share === 'choose'
            ? chosenBot
              ? [chosenBot]
              : []
            : share; // 'all'
      const res = await postOrgSecret({
        name: card.name,
        value,
        share: shareValue,
      });
      setResult(res);
      onResolve(card.requestId, {
        state: 'saved',
        fingerprint: res.fingerprint ?? '',
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      // Clear the field in every path — success and failure. The value never
      // outlives this function.
      clearValue();
      setIsSaving(false);
    }
  };

  const grantedScope = (res: SecretSaveResult): string => {
    const g = res.granted_to;
    if (Array.isArray(g) && g.length > 0) return g.join(', ');
    return res.share_scope ?? 'unknown scope';
  };

  return (
    <ChatMessageRow
      sender="system"
      avatar={<Avatar name={card.bot || 'bot'} size="md" tooltip={false} />}>
      <ChatMessageBubble
        variant="ghost"
        name={
          <Text type="supporting" weight="semibold" color="secondary">
            Secret request
          </Text>
        }>
        <VStack gap={3} maxWidth={420}>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <IconConcealOrWarning isAccess={isAccessRequest} />
            <Text weight="semibold">{card.name}</Text>
            <Token label={card.bot || 'bot'} size="sm" color="blue" />
            <Timestamp value={new Date(card.at).toISOString()} format="time" />
          </HStack>

          {card.description ? (
            <Text type="supporting">{card.description}</Text>
          ) : null}

          {resolved ? (
            card.status?.state === 'saved' ? (
              <HStack gap={2} vAlign="center" wrap="wrap">
                <IconSuccess color="green" />
                <Text type="supporting">
                  Saved. Fingerprint {card.status.fingerprint || '—'}
                  {result ? ` · shared with: ${grantedScope(result)}` : ''}
                </Text>
              </HStack>
            ) : card.status?.state === 'denied' && isAccessRequest ? (
              <Text type="supporting">Access request handled.</Text>
            ) : (
              <Text type="supporting">Request cancelled.</Text>
            )
          ) : isAccessRequest ? (
            // Secret access grants have no real backend: /api/org/grants is a
            // stub in the current server. An honest disabled state beats a
            // control that pretends to grant.
            <Text type="supporting" color="secondary">
              This bot is asking to reuse an existing secret. Access grants are
              not backed by the current server, so approve/deny is disabled
              until a grants endpoint exists.
            </Text>
          ) : (
            <VStack gap={3}>
              {/* Uncontrolled password input: the value lives ONLY in the
                  DOM. Never add a value/onChange state pair here. */}
              <VStack gap={1} width="100%">
                <Text type="supporting" weight="semibold">
                  Value for {card.name}
                </Text>
                <input
                  ref={valueInputRef}
                  type="password"
                  autoComplete="off"
                  placeholder="Paste the value — it is sent straight to the secret store"
                  disabled={isSaving}
                  style={{
                    width: '100%',
                    padding: 'var(--spacing-2) var(--spacing-3)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-surface)',
                    color: 'var(--color-text)',
                    font: 'inherit',
                  }}
                />
                <Text type="supporting">
                  Sent straight to the secret store — never through the chat.
                </Text>
              </VStack>

              <Selector
                label="Share with"
                value={share}
                onChange={v => setShare((v as ShareChoice) ?? 'self')}
                size="sm"
                placeholder="Who may read this secret"
                options={[
                  {value: 'self', label: `${card.bot || 'This bot'} only`},
                  {value: 'all', label: 'All bots'},
                  {value: 'choose', label: 'Choose bots…'},
                  {value: 'another-org', label: 'Another org… (no org registry on this server)', disabled: true},
                ]}
                width="100%"
              />
              {share === 'choose' && bots.length > 0 ? (
                <Selector
                  label="Bots"
                  value={chosenBot}
                  onChange={v => setChosenBot(v ?? '')}
                  size="sm"
                  placeholder="Pick a bot"
                  options={bots.map(b => ({value: b.id, label: b.name}))}
                  width="100%"
                />
              ) : null}

              {error ? (
                <HStack gap={2} vAlign="center">
                  <IconError color="red" />
                  <Text type="supporting">{error}</Text>
                </HStack>
              ) : null}

              <HStack gap={2} hAlign="end">
                <Button
                  label="Cancel"
                  variant="ghost"
                  size="sm"
                  isDisabled={isSaving}
                  onClick={cancel}
                />
                <Button
                  label="Save"
                  variant="primary"
                  size="sm"
                  isLoading={isSaving}
                  onClick={() => void save()}
                />
              </HStack>
            </VStack>
          )}
        </VStack>
      </ChatMessageBubble>
    </ChatMessageRow>
  );
}

export function SecretCardDismissButton({onDismiss}: {onDismiss: () => void}) {
  return (
    <IconButton
      label="Dismiss"
      size="sm"
      variant="ghost"
      icon={<IconClose />}
      onClick={onDismiss}
    />
  );
}
