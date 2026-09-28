import {MoreMenu} from '@astryxdesign/core/MoreMenu';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import type {DropdownMenuOption} from '@astryxdesign/core/DropdownMenu';
import {isShippedBot, type Bot} from './api';

type Props = {
  bot: Bot;
  isPinned?: boolean;
  isHidden?: boolean;
  onTogglePin?: (bot: Bot) => void;
  onToggleHide?: (bot: Bot) => void;
  onDuplicate?: (bot: Bot) => void;
  onEdit?: (bot: Bot) => void;
  onDelete?: (bot: Bot) => void;
};

/**
 * Per-bot affordance on the roster:
 *  - Pin / Unpin keeps active bots at the top of the sidebar.
 *  - Hide / Unhide moves the bot into the "Hidden Bots" drawer.
 *  - Duplicate clones the bot's configuration into `<name> copy`.
 *  - principal / governor are SHIPPED/LOCKED — edit and delete are excluded.
 */
export function BotRowMenu({
  bot,
  isPinned,
  isHidden,
  onTogglePin,
  onToggleHide,
  onDuplicate,
  onEdit,
  onDelete,
}: Props) {
  const shipped = isShippedBot(bot);
  const items: DropdownMenuOption[] = [];

  if (onTogglePin) {
    items.push({
      id: 'pin',
      label: isPinned ? 'Unpin' : 'Pin to top',
      onClick: () => onTogglePin(bot),
    });
  }

  if (onToggleHide) {
    items.push({
      id: 'hide',
      label: isHidden ? 'Unhide' : 'Hide from sidebar',
      onClick: () => onToggleHide(bot),
    });
  }

  if (onDuplicate) {
    items.push({
      id: 'duplicate',
      label: 'Duplicate Bot',
      onClick: () => onDuplicate(bot),
    });
  }

  if (!shipped) {
    if (onEdit) {
      items.push({
        id: 'edit',
        label: 'Edit Profile…',
        onClick: () => onEdit(bot),
      });
    }
    if (onDelete) {
      items.push({
        id: 'delete',
        label: 'Delete…',
        variant: 'destructive',
        onClick: () => onDelete(bot),
      });
    }
  }

  return (
    <MoreMenu
      label={`Manage ${bot.name}`}
      variant="ghost"
      size="sm"
      items={items}
    />
  );
}

