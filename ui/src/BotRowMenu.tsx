import {MoreMenu} from '@astryxdesign/core/MoreMenu';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import type {DropdownMenuOption} from '@astryxdesign/core/DropdownMenu';
import {isShippedBot, type Bot} from './api';

type Props = {
  bot: Bot;
  onEdit: (bot: Bot) => void;
  onDelete: (bot: Bot) => void;
};

/**
 * Per-bot affordance on the roster. Product taxonomy is binding:
 *  - principal / governor are SHIPPED/LOCKED — they get a locked indicator
 *    and no edit/delete items are ever rendered for them.
 *  - every other roster bot is persistent and user-editable/deletable.
 * Sub-agents are not roster bots and never reach this component.
 */
export function BotRowMenu({bot, onEdit, onDelete}: Props) {
  if (isShippedBot(bot)) {
    return (
      <StatusDot
        variant="neutral"
        label="Shipped · locked"
        tooltip={`${bot.name} is part of the shipped product — it cannot be edited or deleted.`}
      />
    );
  }
  const items: DropdownMenuOption[] = [
    {id: 'edit', label: 'Edit…', onClick: () => onEdit(bot)},
    {id: 'delete', label: 'Delete…', variant: 'destructive', onClick: () => onDelete(bot)},
  ];
  return (
    <MoreMenu
      label={`Manage ${bot.name}`}
      variant="ghost"
      size="sm"
      items={items}
    />
  );
}
