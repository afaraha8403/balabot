import {useEffect, useState} from 'react';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {VStack} from '@astryxdesign/core/VStack';
import {HStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {Button} from '@astryxdesign/core/Button';
import {Banner} from '@astryxdesign/core/Banner';
import {TextInput} from '@astryxdesign/core/TextInput';
import {TextArea} from '@astryxdesign/core/TextArea';
import {IconClose} from './icons';
import {updateBot, type Bot, type BotEditableMeta} from './api';

type Props = {
  bot: Bot;
  onClose: () => void;
  /** Called after a successful PATCH so App reloads the roster. */
  onUpdated: (botId: string) => void;
};

/**
 * Edit a persistent user-created bot's meta (name / title / description /
 * icon / color) via PATCH /api/bots/{id}. Shipped bots (principal, governor)
 * are never routed here — the roster only opens this dialog for unlocked bots.
 */
export function BotEditDialog({bot, onClose, onUpdated}: Props) {
  const [form, setForm] = useState<BotEditableMeta>({
    name: bot.name,
    title: bot.title,
    description: bot.description,
    icon: bot.icon,
    color: bot.color,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Re-seed when a different bot is edited in the same mounted dialog.
  useEffect(() => {
    setForm({
      name: bot.name,
      title: bot.title,
      description: bot.description,
      icon: bot.icon,
      color: bot.color,
    });
  }, [bot]);

  const set = (key: keyof BotEditableMeta) => (value: string) =>
    setForm(prev => ({...prev, [key]: value}));

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      // Only send fields the human actually changed — PATCH is a subset.
      const patch: Partial<BotEditableMeta> = {};
      if (form.name.trim() && form.name.trim() !== bot.name) patch.name = form.name.trim();
      if (form.title.trim() && form.title.trim() !== bot.title) patch.title = form.title.trim();
      if (form.description !== bot.description) patch.description = form.description;
      if (form.icon.trim() && form.icon.trim() !== bot.icon) patch.icon = form.icon.trim();
      if (form.color.trim() && form.color.trim() !== bot.color) patch.color = form.color.trim();
      if (Object.keys(patch).length === 0) {
        onClose();
        return;
      }
      await updateBot(bot.id, patch);
      onUpdated(bot.id);
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
      purpose="form"
      variant="fullscreen">
      <DialogHeader
        title={`Edit ${bot.name}`}
        subtitle="Changes rename and re-describe the bot everywhere it appears."
        onOpenChange={onClose}
      />
      <VStack gap={3} padding={4}>
        {error ? (
          <Banner
            status="error"
            title="Could not save"
            description={error}
            onDismiss={() => setError('')}
          />
        ) : null}
        <TextInput
          label="Name"
          value={form.name}
          onChange={set('name')}
          description="The bot's display name."
        />
        <TextInput
          label="Title"
          value={form.title}
          onChange={set('title')}
          description="One-line role shown under the name."
        />
        <TextArea
          label="Description"
          value={form.description}
          onChange={set('description')}
          placeholder="What is this bot for?"
        />
        <HStack gap={3} wrap="wrap">
          <TextInput
            label="Icon"
            value={form.icon}
            onChange={set('icon')}
            description="An emoji, e.g. 🛰"
            width={120}
          />
          <TextInput
            label="Color"
            value={form.color}
            onChange={set('color')}
            description="Token name from the theme, e.g. teal"
            width={200}
          />
        </HStack>
        <HStack gap={2} vAlign="center">
          <Button
            label="Save changes"
            variant="primary"
            isDisabled={busy || !form.name.trim() || !form.title.trim()}
            isLoading={busy}
            onClick={() => void save()}
          />
          <Button
            label="Cancel"
            variant="ghost"
            isDisabled={busy}
            onClick={onClose}
          />
        </HStack>
        <HStack gap={2} vAlign="center">
          <IconClose size="xsm" color="secondary" />
          <Text type="supporting">
            Nothing here touches a shipped bot — principal and governor are locked.
          </Text>
        </HStack>
      </VStack>
    </Dialog>
  );
}
