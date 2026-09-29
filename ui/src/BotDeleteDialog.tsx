import {useState} from 'react';
import {deleteBot, isShippedBot, type Bot, type DeleteBotResult} from './api';

type Props = {
  bot: Bot;
  onClose: () => void;
  /** Called after a successful DELETE so App reloads the roster and reselects. */
  onDeleted: (result: DeleteBotResult) => void;
};

/**
 * Polaris AlertDialog frame with typed confirmation for deleting a persistent bot:
 * The human must type the bot's name and check the organizational content checkbox
 * to unlock the destructive button. DELETE refuses principal/governor server-side (409);
 * this dialog additionally enforces isShippedBot client-side.
 */
export function BotDeleteDialog({bot, onClose, onDeleted}: Props) {
  const [confirmText, setConfirmText] = useState('');
  const [ackOrg, setAckOrg] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const shipped = isShippedBot(bot);
  const armed = !shipped && confirmText.trim() === bot.name && ackOrg;

  const doDelete = async () => {
    if (!armed || busy) return;
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

  if (shipped) {
    return (
      <div
        className="polaris-dialog-backdrop"
        onClick={e => e.target === e.currentTarget && onClose()}
      >
        <div className="polaris-dialog-content" role="alertdialog" aria-modal="true">
          <h2 className="polaris-dialog-title">Protected Bot</h2>
          <p className="polaris-dialog-desc">
            {bot.name} is a shipped system bot and cannot be deleted.
          </p>
          <div style={{display: 'flex', justifyContent: 'flex-end', marginTop: '16px'}}>
            <button
              type="button"
              className="polaris-btn polaris-btn-outline"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="polaris-dialog-backdrop"
      onClick={e => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="polaris-dialog-content"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-bot-title"
      >
        <h2 id="delete-bot-title" className="polaris-dialog-title">
          Delete {bot.name}?
        </h2>
        <p className="polaris-dialog-desc">
          Its conversation, files, and routines will be permanently deleted. Bots it created stay
          in your list.
        </p>

        {error ? (
          <p
            style={{
              fontSize: '13px',
              color: 'var(--destructive)',
              marginBottom: '12px',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              padding: '8px 12px',
              borderRadius: '8px',
            }}
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <div style={{display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '20px'}}>
          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              fontSize: '13px',
              color: 'var(--foreground)',
              cursor: 'pointer',
              lineHeight: 1.4,
            }}
          >
            <input
              type="checkbox"
              checked={ackOrg}
              disabled={busy}
              onChange={e => setAckOrg(e.target.checked)}
              style={{marginTop: '2px'}}
            />
            <span>I understand shared org content owned by this bot may be removed too.</span>
          </label>

          <div>
            <label
              htmlFor="confirm-bot-delete-input"
              style={{
                display: 'block',
                fontSize: '13px',
                color: 'var(--muted-foreground)',
                marginBottom: '6px',
              }}
            >
              Type &ldquo;<strong>{bot.name}</strong>&rdquo; to confirm
            </label>
            <input
              id="confirm-bot-delete-input"
              type="text"
              className="polaris-input"
              value={confirmText}
              disabled={busy}
              placeholder={bot.name}
              onChange={e => setConfirmText(e.target.value)}
              autoComplete="off"
            />
            <span
              style={{
                display: 'block',
                fontSize: '12px',
                color: 'var(--muted-foreground)',
                marginTop: '4px',
              }}
            >
              Confirmation is typed, not clicked — no accidental deletes.
            </span>
          </div>
        </div>

        <div style={{display: 'flex', justifyContent: 'flex-end', gap: '8px'}}>
          <button
            type="button"
            className="polaris-btn polaris-btn-outline"
            disabled={busy}
            onClick={onClose}
          >
            Keep bot
          </button>
          <button
            type="button"
            className="polaris-btn polaris-btn-destructive"
            disabled={!armed || busy}
            onClick={() => void doDelete()}
          >
            {busy ? 'Deleting…' : `Delete ${bot.name}`}
          </button>
        </div>
      </div>
    </div>
  );
}
