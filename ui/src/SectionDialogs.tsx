import {useId, useState} from 'react';
import type {Bot} from './api';
import type {BotSection} from './sections';

export function NewBotSectionDialog({
  bot,
  onCancel,
  onConfirm,
}: {
  bot: Pick<Bot, 'name'>;
  onCancel: () => void;
  onConfirm: (name: string) => Promise<void> | void;
}) {
  const nameId = useId();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onConfirm(trimmed);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not create section');
      setSaving(false);
    }
  };

  return (
    <div className="polaris-dialog-backdrop" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="polaris-dialog-content" role="dialog" aria-modal="true" aria-labelledby={`${nameId}-title`}>
        <form onSubmit={handleSubmit}>
          <h2 id={`${nameId}-title`} className="polaris-dialog-title">
            New section
          </h2>
          <p className="polaris-dialog-desc">
            Create a section and move {bot.name} into it.
          </p>
          <label htmlFor={nameId} style={{display: 'block', fontSize: '13.5px', marginBottom: '6px', color: 'var(--foreground)'}}>
            Name
          </label>
          <input
            id={nameId}
            maxLength={60}
            value={name}
            autoFocus
            onChange={e => setName(e.target.value)}
            className="polaris-input"
            placeholder="e.g. Research, Operations"
          />
          {error ? (
            <p style={{fontSize: '13px', color: 'var(--destructive)', marginTop: '8px'}} role="alert">
              {error}
            </p>
          ) : null}
          <div style={{display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px'}}>
            <button
              type="button"
              className="polaris-btn polaris-btn-outline"
              disabled={saving}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="polaris-btn polaris-btn-primary"
              disabled={saving || !name.trim()}
            >
              {saving ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function RenameBotSectionDialog({
  section,
  onCancel,
  onConfirm,
}: {
  section: Pick<BotSection, 'name'>;
  onCancel: () => void;
  onConfirm: (name: string) => Promise<void> | void;
}) {
  const nameId = useId();
  const [name, setName] = useState(section.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();
  const unchanged = trimmed === section.name;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmed || saving || unchanged) return;
    setSaving(true);
    setError(null);
    try {
      await onConfirm(trimmed);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not rename section');
      setSaving(false);
    }
  };

  return (
    <div className="polaris-dialog-backdrop" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="polaris-dialog-content" role="dialog" aria-modal="true" aria-labelledby={`${nameId}-title`}>
        <form onSubmit={handleSubmit}>
          <h2 id={`${nameId}-title`} className="polaris-dialog-title">
            Rename section
          </h2>
          <label htmlFor={nameId} style={{display: 'block', fontSize: '13.5px', marginBottom: '6px', color: 'var(--foreground)'}}>
            Name
          </label>
          <input
            id={nameId}
            maxLength={60}
            value={name}
            autoFocus
            onChange={e => setName(e.target.value)}
            className="polaris-input"
          />
          {error ? (
            <p style={{fontSize: '13px', color: 'var(--destructive)', marginTop: '8px'}} role="alert">
              {error}
            </p>
          ) : null}
          <div style={{display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px'}}>
            <button
              type="button"
              className="polaris-btn polaris-btn-outline"
              disabled={saving}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="polaris-btn polaris-btn-primary"
              disabled={saving || !trimmed || unchanged}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
