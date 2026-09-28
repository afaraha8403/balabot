import {useState} from 'react';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {VStack} from '@astryxdesign/core/VStack';
import {HStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {Button} from '@astryxdesign/core/Button';
import {Banner} from '@astryxdesign/core/Banner';
import {TextInput} from '@astryxdesign/core/TextInput';
import {CheckboxInput} from '@astryxdesign/core/CheckboxInput';
import {deleteBot, type Bot, type DeleteBotResult} from './api';

type Props = {
  bot: Bot;
  onClose: () => void;
  /** Called after a successful DELETE so App reloads the roster and reselects. */
  onDeleted: (result: DeleteBotResult) => void;
};

/**
 * Explicit, typed confirmation for deleting a persistent bot: the human must
 * type the bot's name to unlock the destructive button. DELETE refuses
 * principal/governor server-side (409) — this dialog is only ever opened for
 * non-shipped bots, and the typed name is the second, independent guard.
 */
export function BotDeleteDialog({bot, onClose, onDeleted}: Props) {
  const [confirmText, setConfirmText] = useState('');
  const [ackOrg, setAckOrg] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const armed = confirmText.trim() === bot.name && ackOrg;

  const doDelete = async () => {
    if (!armed) return;
    setBusy(true);
    setError('');
    try {
      const result = await deleteBot(bot.id);
      onDeleted(result);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      isOpen
      onOpenChange={open => !open && onClose()}
      purpose="form">
      <DialogHeader
        title={`Delete ${bot.name}?`}
        subtitle="This removes the bot, its sessions and its memory from the fleet."
        onOpenChange={onClose}
      />
      <VStack gap={3} padding={4} maxWidth={560}>
        {error ? (
          <Banner
            status="error"
            title="Could not delete"
            description={error}
            onDismiss={() => setError('')}
          />
        ) : null}
        <Text type="body">
          You are about to permanently delete <Text weight="semibold">{bot.name}</Text> (
          {bot.title}). Its conversations, memory and knowledge base go with it.
        </Text>
        <CheckboxInput
          label="I understand shared org content owned by this bot may be removed too."
          value={ackOrg}
          onChange={setAckOrg}
        />
        <TextInput
          label={`Type "${bot.name}" to confirm`}
          value={confirmText}
          onChange={setConfirmText}
          placeholder={bot.name}
          description="Confirmation is typed, not clicked — no accidental deletes."
        />
        <HStack gap={2} vAlign="center">
          <Button
            label={`Delete ${bot.name}`}
            variant="primary"
            isDisabled={!armed || busy}
            isLoading={busy}
            onClick={() => void doDelete()}
          />
          <Button label="Keep bot" variant="ghost" isDisabled={busy} onClick={onClose} />
        </HStack>
      </VStack>
    </Dialog>
  );
}
