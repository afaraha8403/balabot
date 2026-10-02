import {useEffect, useState} from 'react';
import {Check, MessageSquare, ShieldCheck} from 'lucide-react';

export const STORAGE_MESSAGING_KEY = 'balabot.messagingSettings.v1';

export type MessagingSettings = {
  enabled: boolean;
  defaultChannel: 'instant' | 'normal' | 'batch';
  quietHoursStart: number;
  quietHoursEnd: number;
};

export function loadMessagingSettings(): MessagingSettings {
  const fallback: MessagingSettings = {
    enabled: true,
    defaultChannel: 'normal',
    quietHoursStart: 22,
    quietHoursEnd: 7,
  };
  try {
    const raw = localStorage.getItem(STORAGE_MESSAGING_KEY);
    return raw ? {...fallback, ...JSON.parse(raw)} : fallback;
  } catch {
    return fallback;
  }
}

export function saveMessagingSettings(settings: MessagingSettings): void {
  try {
    localStorage.setItem(STORAGE_MESSAGING_KEY, JSON.stringify(settings));
  } catch (err) {
    console.error('Failed to write messaging settings', err);
  }
}

type Props = {
  embedded?: boolean;
  onClose?: () => void;
};

/**
 * Messaging settings panel for bot delivery preferences: enable/disable,
 * default channel quickness (instant, normal, batch), and quiet hours range.
 *
 * Persists to localStorage under `balabot.messagingSettings.v1`.
 */
export function MessagingSettingsOverlay({embedded = true}: Props) {
  const [settings, setSettings] = useState<MessagingSettings>(() => loadMessagingSettings());
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const handleToggle = (enabled: boolean) => {
    const next = {...settings, enabled};
    setSettings(next);
    saveMessagingSettings(next);
    showNotice(`Messaging ${enabled ? 'enabled' : 'disabled'}.`);
  };

  const handleChannelSelect = (channel: 'instant' | 'normal' | 'batch') => {
    const next = {...settings, defaultChannel: channel};
    setSettings(next);
    saveMessagingSettings(next);
    showNotice(`Default channel set to ${channel}.`);
  };

  const handleQuietHoursChange = (start: number, end: number) => {
    const next = {...settings, quietHoursStart: start, quietHoursEnd: end};
    setSettings(next);
    saveMessagingSettings(next);
    showNotice(`Quiet hours: ${start}:00 – ${end}:00.`);
  };

  const showNotice = (message: string) => {
    setStatusNotice(message);
    setTimeout(() => setStatusNotice(null), 3000);
  };

  return (
    <div
      data-testid="messaging-settings"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      <div>
        <h3 style={{margin: '0 0 4px 0', fontSize: '15px', fontWeight: 600, color: 'var(--foreground)'}}>
          Bot Messaging Preferences
        </h3>
        <p style={{margin: 0, fontSize: '13px', color: 'var(--muted-foreground)'}}>
          Control when and how quickly your bots send messages. Quiet hours apply to non-urgent notifications.
        </p>
      </div>

      {statusNotice ? (
        <div
          role="status"
          style={{
            padding: '10px 14px',
            borderRadius: 'var(--radius-md, 8px)',
            backgroundColor: 'var(--accent)',
            color: 'var(--foreground)',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <ShieldCheck size={16} style={{color: 'var(--success, #22c55e)'}} />
          <span>{statusNotice}</span>
        </div>
      ) : null}

      {/* Enable/Disable messaging */}
      <div
        data-testid="messaging-toggle"
        style={{
          padding: '16px',
          borderRadius: 'var(--radius-lg, 12px)',
          border: '1px solid var(--border)',
          backgroundColor: 'var(--card)',
        }}
      >
        <label style={{display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer'}}>
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={e => handleToggle(e.target.checked)}
            style={{
              width: '18px',
              height: '18px',
              cursor: 'pointer',
              accentColor: 'var(--primary)',
            }}
          />
          <div>
            <div style={{fontSize: '13px', fontWeight: 600, color: 'var(--foreground)'}}>
              Enable bot messaging
            </div>
            <div style={{fontSize: '12px', color: 'var(--muted-foreground)', marginTop: '2px'}}>
              When disabled, bots will not send notifications or messages.
            </div>
          </div>
        </label>
      </div>

      {/* Default channel quickness */}
      <div
        data-testid="messaging-channel-picker"
        style={{
          padding: '16px',
          borderRadius: 'var(--radius-lg, 12px)',
          border: '1px solid var(--border)',
          backgroundColor: 'var(--card)',
        }}
      >
        <label style={{display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--foreground)', marginBottom: '4px'}}>
          Default delivery speed
        </label>
        <p style={{margin: '0 0 12px 0', fontSize: '12.5px', color: 'var(--muted-foreground)'}}>
          Instant: immediate delivery. Normal: batched within minutes. Batch: digest once per day.
        </p>
        <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px'}}>
          {(['instant', 'normal', 'batch'] as const).map(channel => {
            const isSelected = settings.defaultChannel === channel;
            return (
              <button
                key={channel}
                type="button"
                data-testid={`channel-btn-${channel}`}
                aria-pressed={isSelected}
                onClick={() => handleChannelSelect(channel)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-md, 8px)',
                  border: isSelected ? '1px solid var(--ring)' : '1px solid var(--border)',
                  backgroundColor: isSelected ? 'var(--accent)' : 'transparent',
                  color: isSelected ? 'var(--foreground)' : 'var(--muted-foreground)',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: isSelected ? 600 : 400,
                  transition: 'all 120ms ease',
                }}
              >
                {isSelected ? <Check size={14} style={{color: 'var(--success, #22c55e)'}} /> : null}
                <span style={{textTransform: 'capitalize'}}>{channel}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Quiet hours range */}
      <div
        data-testid="messaging-quiet-hours"
        style={{
          padding: '16px',
          borderRadius: 'var(--radius-lg, 12px)',
          border: '1px solid var(--border)',
          backgroundColor: 'var(--card)',
        }}
      >
        <label style={{display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--foreground)', marginBottom: '4px'}}>
          Quiet hours (do not disturb)
        </label>
        <p style={{margin: '0 0 12px 0', fontSize: '12.5px', color: 'var(--muted-foreground)'}}>
          Non-urgent messages will be held during this window (24-hour format).
        </p>
        <div style={{display: 'flex', gap: '12px', alignItems: 'center'}}>
          <div style={{flex: 1}}>
            <label style={{display: 'block', fontSize: '12px', color: 'var(--muted-foreground)', marginBottom: '4px'}}>
              Start
            </label>
            <input
              type="number"
              min="0"
              max="23"
              value={settings.quietHoursStart}
              onChange={e => handleQuietHoursChange(Number(e.target.value), settings.quietHoursEnd)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 'var(--radius-md, 8px)',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--background)',
                color: 'var(--foreground)',
                fontSize: '13px',
                fontFamily: 'inherit',
              }}
            />
          </div>
          <span style={{color: 'var(--muted-foreground)', fontSize: '13px', marginTop: '20px'}}>
            –
          </span>
          <div style={{flex: 1}}>
            <label style={{display: 'block', fontSize: '12px', color: 'var(--muted-foreground)', marginBottom: '4px'}}>
              End
            </label>
            <input
              type="number"
              min="0"
              max="23"
              value={settings.quietHoursEnd}
              onChange={e => handleQuietHoursChange(settings.quietHoursStart, Number(e.target.value))}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 'var(--radius-md, 8px)',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--background)',
                color: 'var(--foreground)',
                fontSize: '13px',
                fontFamily: 'inherit',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
