import {useEffect, useState} from 'react';
import {Switch} from '@astryxdesign/core/Switch';
import {isShippedBot, updateBot, type Bot, type BotEditableMeta} from './api';
import {BotAvatar} from './BotAvatar';

type Props = {
  bot: Bot;
  showThinking: boolean;
  onShowThinkingChange: (checked: boolean) => void;
  onClose: () => void;
  onUpdated: (botId: string) => void;
  onOpenKnowledge?: () => void;
};

/**
 * Polaris right-panel BotSettings:
 * Allows editing non-shipped bot metadata (name, title, description, color).
 * Shipped bots (principal, governor) are locked: the backend refuses PATCH (409)
 * and the form disables editing affordances.
 */
export function BotSettings({bot, showThinking, onShowThinkingChange, onClose, onUpdated, onOpenKnowledge}: Props) {
  const [name, setName] = useState(bot.name);
  const [title, setTitle] = useState(bot.title || '');
  const [description, setDescription] = useState(bot.description || '');
  const [color, setColor] = useState(bot.color || 'teal');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const shipped = isShippedBot(bot);

  useEffect(() => {
    setName(bot.name);
    setTitle(bot.title || '');
    setDescription(bot.description || '');
    setColor(bot.color || 'teal');
    setError(null);
    setSuccess(null);
  }, [bot]);

  const handleSave = async () => {
    if (shipped || saving) return;
    setSaving(true);
    setError(null);
    setSuccess(null);

    const patch: Partial<BotEditableMeta> = {};
    if (name.trim() && name.trim() !== bot.name) patch.name = name.trim();
    if (title.trim() !== (bot.title || '')) patch.title = title.trim();
    if (description !== (bot.description || '')) patch.description = description;
    if (color.trim() !== (bot.color || '')) patch.color = color.trim();

    if (Object.keys(patch).length === 0) {
      setSaving(false);
      onClose();
      return;
    }

    try {
      await updateBot(bot.id, patch);
      onUpdated(bot.id);
      setSuccess('Settings saved');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-testid="bot-settings" style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
      {/* Header */}
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '1px solid var(--border)'}}>
        <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
          <BotAvatar identity={bot.id} color={color} size={36} />
          <div>
            <h3 style={{margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--foreground)'}}>
              {bot.name}
            </h3>
            <span style={{fontSize: '12px', color: 'var(--muted-foreground)'}}>
              {shipped ? 'Shipped system bot' : 'Custom bot settings'}
            </span>
          </div>
        </div>
        <button
          type="button"
          aria-label="Close settings"
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--muted-foreground)',
            cursor: 'pointer',
            padding: '4px',
            borderRadius: '4px',
            display: 'inline-flex',
            alignItems: 'center',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {shipped ? (
        <div
          style={{
            padding: '10px 12px',
            fontSize: '12.5px',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            color: 'var(--primary)',
            borderRadius: '8px',
            lineHeight: 1.4,
          }}
        >
          <strong>{bot.name}</strong> is a shipped system bot. Its identity and core profile are locked
          to ensure fleet governance stability.
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          style={{
            padding: '8px 12px',
            fontSize: '12.5px',
            color: 'var(--destructive)',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            borderRadius: '6px',
          }}
        >
          {error}
        </div>
      ) : null}

      {success ? (
        <div
          style={{
            padding: '8px 12px',
            fontSize: '12.5px',
            color: 'var(--success, #22c55e)',
            backgroundColor: 'rgba(34, 197, 94, 0.1)',
            borderRadius: '6px',
          }}
        >
          {success}
        </div>
      ) : null}

      {/* Display preference (local, not a bot meta patch — usable on shipped bots too) */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          padding: '10px 12px',
          borderRadius: '8px',
          border: '1px solid var(--border)',
          backgroundColor: 'var(--muted)',
        }}
      >
        <span style={{fontSize: '13px', fontWeight: 600, color: 'var(--foreground)'}}>
          Display
        </span>
        <Switch
          label="Show thinking"
          value={showThinking}
          onChange={onShowThinkingChange}
          description="Show the bot's reasoning as a collapsible note under each reply."
        />
      </div>

      {/* Field inputs */}
      <div style={{display: 'flex', flexDirection: 'column', gap: '14px'}}>
        <div>
          <label
            htmlFor="bot-settings-name"
            style={{display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--muted-foreground)', marginBottom: '4px'}}
          >
            Name
          </label>
          <input
            id="bot-settings-name"
            className="polaris-input"
            value={name}
            disabled={shipped || saving}
            onChange={e => setName(e.target.value)}
          />
        </div>

        <div>
          <label
            htmlFor="bot-settings-title"
            style={{display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--muted-foreground)', marginBottom: '4px'}}
          >
            Title
          </label>
          <input
            id="bot-settings-title"
            className="polaris-input"
            value={title}
            disabled={shipped || saving}
            placeholder="e.g. Research Specialist, QA Scout"
            onChange={e => setTitle(e.target.value)}
          />
        </div>

        <div>
          <label
            htmlFor="bot-settings-desc"
            style={{display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--muted-foreground)', marginBottom: '4px'}}
          >
            Description
          </label>
          <textarea
            id="bot-settings-desc"
            value={description}
            disabled={shipped || saving}
            rows={4}
            placeholder="What this bot is for"
            onChange={e => setDescription(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              fontFamily: 'inherit',
              fontSize: '13px',
              backgroundColor: 'var(--input)',
              color: 'var(--foreground)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md, 10px)',
              boxSizing: 'border-box',
              resize: 'vertical',
            }}
          />
        </div>

        <div>
          <label
            htmlFor="bot-settings-color"
            style={{display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--muted-foreground)', marginBottom: '4px'}}
          >
            Color theme
          </label>
          <input
            id="bot-settings-color"
            className="polaris-input"
            value={color}
            disabled={shipped || saving}
            placeholder="e.g. teal, indigo, amber, violet"
            onChange={e => setColor(e.target.value)}
          />
        </div>

        {!shipped ? (
          <div style={{display: 'flex', gap: '8px', marginTop: '6px'}}>
            <button
              type="button"
              className="polaris-btn polaris-btn-primary"
              disabled={saving || !name.trim()}
              onClick={() => void handleSave()}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button
              type="button"
              className="polaris-btn polaris-btn-outline"
              disabled={saving}
              onClick={onClose}
            >
              Cancel
            </button>
          </div>
        ) : null}
      </div>

      {onOpenKnowledge ? (
        <div style={{marginTop: '8px', paddingTop: '16px', borderTop: '1px solid var(--border)'}}>
          <button
            type="button"
            className="polaris-btn polaris-btn-outline"
            style={{width: '100%', justifyContent: 'center'}}
            onClick={onOpenKnowledge}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
              <path d="M6 6h10" />
              <path d="M6 10h10" />
            </svg>
            <span>{bot.name} Memory &amp; Knowledge</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
