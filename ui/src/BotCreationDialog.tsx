import {useCallback, useEffect, useState} from 'react';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {VStack} from '@astryxdesign/core/VStack';
import {HStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {Button} from '@astryxdesign/core/Button';
import {Banner} from '@astryxdesign/core/Banner';
import {TextInput} from '@astryxdesign/core/TextInput';
import {TextArea} from '@astryxdesign/core/TextArea';
import {Token} from '@astryxdesign/core/Token';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Timestamp} from '@astryxdesign/core/Timestamp';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {
  approveBotProposal,
  createApprovedBot,
  createBotProposal,
  getBotProposals,
  rejectBotProposal,
  type Bot,
  type BotProposal,
} from './api';
import {IconWarning} from './icons';

type Props = {
  bots: Bot[];
  onClose: () => void;
  /** Called when a bot is registered so App reloads the roster. */
  onFleetChanged?: () => void;
};

const STATUS_VARIANT: Record<BotProposal['status'], 'neutral' | 'warning' | 'error' | 'success'> = {
  proposed: 'warning',
  approved: 'success',
  rejected: 'error',
  registered: 'success',
};

/**
 * Bot creation with consent (Wave 6 P4): propose -> human approval -> create
 * -> fleet registration. The Approve button is the human's explicit consent
 * act; the backend refuses creation from anything not yet approved.
 */
export function BotCreationDialog({bots, onClose, onFleetChanged}: Props) {
  const [proposals, setProposals] = useState<BotProposal[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [unavailableReason, setUnavailableReason] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [proposer, setProposer] = useState('user');
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await getBotProposals();
      if (r.available === false) {
        setAvailable(false);
        setUnavailableReason(r.reason ?? 'unavailable');
        return;
      }
      setAvailable(true);
      setProposals(r.proposals ?? []);
    } catch (e) {
      setAvailable(false);
      setUnavailableReason((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const propose = async () => {
    if (!name.trim() || !role.trim()) return;
    setBusy(true);
    try {
      await createBotProposal({
        name: name.trim(),
        role: role.trim(),
        proposed_by: proposer,
      });
      setName('');
      setRole('');
      setBanner('');
      await load();
    } catch (e) {
      setBanner((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      setBanner('');
      await load();
    } catch (e) {
      setBanner((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pending = proposals.filter(p => p.status === 'proposed');
  const decided = proposals.filter(p => p.status !== 'proposed');

  return (
    <Dialog
      isOpen
      onOpenChange={open => !open && onClose()}
      purpose="form">
      <DialogHeader
        title="Create a bot — with your consent"
        subtitle="Propose → you approve → create → fleet registration. Nothing is created without explicit human approval."
        onOpenChange={onClose}
      />
      <VStack gap={3} padding={4} height="fill">
        {banner ? (
          <Banner status="error" title="Bot creation" description={banner}
                  onDismiss={() => setBanner('')} />
        ) : null}
        {available === false ? (
          <Banner status="warning" title="Proposals unavailable"
                  description={unavailableReason} />
        ) : null}

        <VStack gap={3} maxWidth={560}>
          <Text type="body" weight="semibold">Propose a new bot</Text>
          <TextInput
            label="Bot name"
            value={name}
            onChange={setName}
            placeholder="e.g. Research Scout"
            description="Becomes the bot's fleet id (slugified)."
          />
          <TextArea
            label="Role"
            value={role}
            onChange={setRole}
            placeholder="What is this bot for?"
            description="Stored as metadata; nothing runs until you approve."
          />
          <HStack gap={2} vAlign="end">
            <Button
              label="Propose bot"
              variant="secondary"
              isDisabled={!name.trim() || !role.trim() || busy}
              isLoading={busy}
              onClick={() => void propose()}
            />
            <Text type="supporting">
              Proposer: {proposer === 'user' ? 'you (the operator)' : proposer}
            </Text>
          </HStack>
        </VStack>

        <VStack gap={2}>
          <Text type="body" weight="semibold">
            Awaiting your approval {pending.length ? `(${pending.length})` : ''}
          </Text>
          {available === true && pending.length === 0 ? (
            <EmptyState
              isCompact
              title="Nothing waiting"
              description="No pending proposals. Bots are never created without a proposal and your approval."
            />
          ) : null}
          {pending.map(p => (
            <VStack key={p.id} gap={2} padding={3}>
              <HStack gap={2} vAlign="center" wrap="wrap">
                <StatusDot variant="warning" label="proposed" />
                <Text type="body" weight="semibold">{p.name}</Text>
                <Token label={`by ${p.proposed_by}`} size="sm" />
                <Timestamp value={p.created_at} format="date_time" />
              </HStack>
              <Text type="supporting">{p.role}</Text>
              <Text type="supporting">fleet id: {p.bot_id}</Text>
              <HStack gap={2}>
                {/* The human's explicit consent act. */}
                <Button
                  label="Approve (human consent)"
                  variant="primary"
                  size="sm"
                  isDisabled={busy}
                  isLoading={busy}
                  onClick={() => void act(() => approveBotProposal(p.id))}
                />
                <Button
                  label="Reject"
                  variant="ghost"
                  size="sm"
                  isDisabled={busy}
                  isLoading={busy}
                  onClick={() => void act(() => rejectBotProposal(p.id))}
                />
              </HStack>
            </VStack>
          ))}
        </VStack>

        {decided.length ? (
          <VStack gap={2}>
            <Text type="body" weight="semibold">Decided</Text>
            {decided.map(p => (
              <VStack key={p.id} gap={1} padding={2}>
                <HStack gap={2} vAlign="center" wrap="wrap">
                  <StatusDot variant={STATUS_VARIANT[p.status]}
                             label={p.status} />
                  <Text type="body">{p.name}</Text>
                  <Token label={p.proposed_by} size="sm" />
                  {p.status === 'approved' ? (
                    <Button
                      label="Create & register"
                      variant="secondary"
                      size="sm"
                      isDisabled={busy}
                      isLoading={busy}
                      onClick={() =>
                        void act(async () => {
                          const r = await createApprovedBot(p.id);
                          onFleetChanged?.();
                          return r;
                        })
                      }
                    />
                  ) : null}
                </HStack>
                {p.status === 'registered' && p.created_result ? (
                  <Text type="supporting">
                    Registered {p.created_result.bot_id} ·{' '}
                    {p.created_result.actions.length} provisioning steps.
                  </Text>
                ) : null}
              </VStack>
            ))}
          </VStack>
        ) : null}

        {available === false ? (
          <EmptyState
            title="Proposal store unavailable"
            description={unavailableReason || 'The container reports no proposal store.'}
            icon={<IconWarning />}
          />
        ) : null}
      </VStack>
    </Dialog>
  );
}
