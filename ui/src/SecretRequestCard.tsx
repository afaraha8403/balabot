import {useState} from 'react';
import {HStack} from '@astryxdesign/core/Stack';
import {VStack} from '@astryxdesign/core/VStack';
import {Text} from '@astryxdesign/core/Text';
import {Icon} from '@astryxdesign/core/Icon';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Button} from '@astryxdesign/core/Button';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Selector} from '@astryxdesign/core/Selector';
import {Token} from '@astryxdesign/core/Token';
import {Timestamp} from '@astryxdesign/core/Timestamp';
import {Avatar} from '@astryxdesign/core/Avatar';
import {IconClose, IconConcealOrWarning, IconError, IconSuccess} from './icons';
import type {Bot} from './api';
import {
  ChatMessage as ChatMessageRow,
  ChatMessageBubble,
} from '@astryxdesign/core/Chat';
import {
  postOrgSecret,
  postOrgGrant,
  type SecretCard,
} from './api';

type Props = {
  card: SecretCard;
  /** The fleet's bots — the real share targets now that there is no org layer. */
  bots: Bot[];
  onResolve: (requestId: string, status: SecretCard['status']) => void;
};

/**
 * In-chat secret request card. The value is typed into a PASSWORD input and
 * POSTed DIRECTLY to the backend from here — it is never dispatched as a chat
 * message, never lifted into parent state beyond the input, and never rendered
 * anywhere. After Save the input is cleared immediately and only the
 * name + fingerprint confirmation remains.
 */
export function SecretRequestCard({card, bots, onResolve}: Props) {
  // The ONLY state that ever holds the value; cleared right after the POST.
  const [value, setValue] = useState('');
  const [share, setShare] = useState('all');
  const [chooseBots, setChooseBots] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const resolved = card.status !== undefined;
  const isAccessRequest = card.kind === 'secret_access_request';

  const cancel = () => onResolve(card.requestId, {state: 'cancelled'});

  const approveAccess = async () => {
    setIsSaving(true);
    setError('');
    try {
      await postOrgGrant({
        principal: card.bot,
        kind: 'secret',
        name: card.name,
        action: 'grant',
      });
      onResolve(card.requestId, {state: 'denied'}); // approved — reuse denial slot as "handled"
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const denyAccess = async () => {
    setIsSaving(true);
    setError('');
    try {
      await postOrgGrant({
        principal: card.bot,
        kind: 'secret',
        name: card.name,
        action: 'revoke',
      });
      onResolve(card.requestId, {state: 'denied'});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const save = async () => {
    if (!value) return;
    setIsSaving(true);
    setError('');
    try {
      const shareValue = share === 'choose' ? chooseBots : share;
      const result = await postOrgSecret({
        name: card.name,
        value,
        share: shareValue,
      });
      // Clear the input IMMEDIATELY after the POST — before any re-render
      // path could snapshot it. The value never lives anywhere else.
      setValue('');
      onResolve(card.requestId, {
        state: 'saved',
        fingerprint: result.fingerprint ?? '',
      });
    } catch (e) {
      setError((e as Error).message);
      // Still clear: never leave the value sitting in the field on failure.
      setValue('');
    } finally {
      setIsSaving(false);
    }
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
          {isAccessRequest && card.reason ? (
            <Text type="supporting">Reason: {card.reason}</Text>
          ) : null}

          {resolved ? (
            card.status?.state === 'saved' ? (
              <HStack gap={2} vAlign="center" wrap="wrap">
                <IconSuccess color="green" />
                <Text type="supporting">
                  Saved. Fingerprint {card.status.fingerprint || '—'}
                </Text>
              </HStack>
            ) : card.status?.state === 'denied' && isAccessRequest ? (
              <Text type="supporting">Access request handled.</Text>
            ) : (
              <Text type="supporting">Request cancelled.</Text>
            )
          ) : isAccessRequest ? (
            <HStack gap={2}>
              <Button
                label="Approve"
                variant="primary"
                size="sm"
                isLoading={isSaving}
                onClick={() => void approveAccess()}
              />
              <Button
                label="Deny"
                variant="secondary"
                size="sm"
                isDisabled={isSaving}
                onClick={() => void denyAccess()}
              />
            </HStack>
          ) : (
            <VStack gap={3}>
              <TextInput
                label={`Value for ${card.name}`}
                type="password"
                value={value}
                onChange={setValue}
                size="sm"
                isRequired
                autoComplete="off"
                description="Sent straight to the org secret store — never through the chat."
                width="100%"
              />
              <Selector
                label="Share with"
                value={share}
                onChange={v => setShare(v ?? 'all')}
                size="sm"
                options={[
                  {value: 'self', label: 'Only this bot'},
                  {value: 'all', label: 'All bots'},
                  {value: 'choose', label: 'Choose bots'},
                ]}
                width="100%"
              />
              {share === 'choose' && bots.length > 0 ? (
                <Selector
                  label="Bots"
                  value={chooseBots[0] ?? ''}
                  onChange={v => setChooseBots(v ? [v] : [])}
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
                  onClick={() => {
                    setValue('');
                    onResolve(card.requestId, {state: 'cancelled'});
                  }}
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
