import {useState} from 'react';
import type {Bot} from './api';

type Props = {
  bot: Pick<Bot, 'name'>;
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
};

/**
 * Polaris AlertDialog confirmation before clearing all conversation history for a bot.
 */
export function ClearConversationDialog({bot, onCancel, onConfirm}: Props) {
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setClearing(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not clear conversation');
      setClearing(false);
    }
  };

  return (
    <div
      className="polaris-dialog-backdrop"
      onClick={e => {
        if (e.target === e.currentTarget && !clearing) onCancel();
      }}
    >
      <div className="polaris-dialog-content" role="alertdialog" aria-modal="true">
        <h2 className="polaris-dialog-title">Clear {bot.name}’s conversation?</h2>
        <p className="polaris-dialog-desc">
          This permanently removes every message and stops current work. The chat remains
          available.
        </p>
        {error ? (
          <p
            style={{fontSize: '13px', color: 'var(--destructive)', marginBottom: '12px'}}
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <div style={{display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px'}}>
          <button
            type="button"
            className="polaris-btn polaris-btn-outline"
            disabled={clearing}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="polaris-btn polaris-btn-destructive"
            disabled={clearing}
            onClick={() => void handleConfirm()}
          >
            {clearing ? 'Clearing…' : 'Clear'}
          </button>
        </div>
      </div>
    </div>
  );
}
