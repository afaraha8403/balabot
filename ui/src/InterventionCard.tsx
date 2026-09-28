import {useState} from 'react';
import {Card} from '@astryxdesign/core/Card';
import {HStack} from '@astryxdesign/core/Stack';
import {VStack} from '@astryxdesign/core/VStack';
import {Text} from '@astryxdesign/core/Text';
import {Button} from '@astryxdesign/core/Button';
import {Token} from '@astryxdesign/core/Token';
import {IconAgentComputer, IconCheck, IconWarning} from './icons';
import {resolveIntervention, type InterventionPayload} from './api';

type Props = {
  intervention: InterventionPayload;
  onOpenComputer: () => void;
  onResolved?: (token: string, action: 'approve' | 'deny') => void;
};

/**
 * In-transcript human take-over card (GrokBot spec):
 * When an agent encounters a password/passkey, 2FA, CAPTCHA, or payment wall,
 * it pauses execution and posts this card. The human can open the Agent Computer,
 * complete the sensitive step, and click "Done — Continue Bot" to resume the turn.
 */
export function InterventionCard({
  intervention,
  onOpenComputer,
  onResolved,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'pending' | 'approved' | 'denied'>(
    intervention.status ?? 'pending',
  );
  const [error, setError] = useState('');

  const handleResolve = async (action: 'approve' | 'deny') => {
    setBusy(true);
    setError('');
    try {
      await resolveIntervention(intervention.resume_token, action);
      setStatus(action === 'approve' ? 'approved' : 'denied');
      onResolved?.(intervention.resume_token, action);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (status === 'approved') {
    return (
      <Card variant="muted" padding={3}>
        <HStack gap={2} vAlign="center">
          <IconCheck size="sm" color="success" />
          <Text type="supporting" color="secondary">
            Human take-over completed for {intervention.bot}. Bot resumed.
          </Text>
        </HStack>
      </Card>
    );
  }

  if (status === 'denied') {
    return (
      <Card variant="muted" padding={3}>
        <HStack gap={2} vAlign="center">
          <IconWarning size="sm" color="secondary" />
          <Text type="supporting" color="secondary">
            Take-over request for {intervention.bot} was declined.
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
            <IconWarning size="md" color="warning" />
            <Text type="body" weight="semibold">
              Action Required: Human Take-Over
            </Text>
          </HStack>
          <Token label={intervention.bot} size="sm" color="purple" />
        </HStack>

        <Text type="body">
          {intervention.reason ||
            'The bot has encountered a wall that requires human intervention (CAPTCHA, 2FA, or credentials).'}
        </Text>

        {intervention.hint ? (
          <Text type="supporting" color="secondary">
            Hint: {intervention.hint}
          </Text>
        ) : null}

        {intervention.url ? (
          <HStack gap={1} vAlign="center">
            <Text type="supporting" size="xsm" color="secondary">
              URL:
            </Text>
            <Token label={intervention.url} size="sm" />
          </HStack>
        ) : null}

        {error ? (
          <HStack gap={1} vAlign="center">
            <IconWarning size="sm" color="error" />
            <Text type="supporting" color="secondary">
              {error}
            </Text>
          </HStack>
        ) : null}


        <HStack gap={2} vAlign="center" wrap="wrap">
          <Button
            label="Open Agent Computer"
            variant="secondary"
            size="sm"
            icon={<IconAgentComputer />}
            onClick={onOpenComputer}
          />
          <Button
            label="Done — Continue Bot"
            variant="primary"
            size="sm"
            isLoading={busy}
            onClick={() => void handleResolve('approve')}
          />
          <Button
            label="Decline"
            variant="ghost"
            size="sm"
            isDisabled={busy}
            onClick={() => void handleResolve('deny')}
          />
        </HStack>
      </VStack>
    </Card>
  );
}
