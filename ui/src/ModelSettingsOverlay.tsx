import {useEffect, useState} from 'react';
import {Check, Key, Cpu, Sparkles, ShieldCheck} from 'lucide-react';

export type ModelProvider = {
  id: string;
  name: string;
  description: string;
  defaultModel: string;
  models: {id: string; label: string}[];
  placeholderKey: string;
  docsUrl?: string;
};

export const MODEL_PROVIDERS: ModelProvider[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Universal gateway for open and proprietary foundation models.',
    defaultModel: 'deepseek/deepseek-v4.1-flash',
    models: [
      {id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek v4.1 Flash (Recommended)'},
      {id: 'anthropic/claude-3.7-sonnet', label: 'Claude 3.7 Sonnet'},
      {id: 'openai/gpt-4o', label: 'OpenAI GPT-4o'},
      {id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B Instruct'},
    ],
    placeholderKey: 'sk-or-v1-...',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Direct Anthropic API key for Claude 3.5 & 3.7 families.',
    defaultModel: 'claude-3-7-sonnet-20250219',
    models: [
      {id: 'claude-3-7-sonnet-20250219', label: 'Claude 3.7 Sonnet'},
      {id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet'},
      {id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku'},
    ],
    placeholderKey: 'sk-ant-api03-...',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'Official OpenAI developer platform models.',
    defaultModel: 'gpt-4o',
    models: [
      {id: 'gpt-4o', label: 'GPT-4o (Omni)'},
      {id: 'gpt-4o-mini', label: 'GPT-4o Mini'},
      {id: 'o3-mini', label: 'o3-mini Reasoning'},
    ],
    placeholderKey: 'sk-proj-...',
  },
  {
    id: 'google',
    name: 'Google Gemini',
    description: 'Gemini 2.0 and 2.5 multimodal models via Google AI Studio.',
    defaultModel: 'gemini-2.0-flash',
    models: [
      {id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash'},
      {id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro'},
    ],
    placeholderKey: 'AIzaSy...',
  },
  {
    id: 'groq',
    name: 'Groq',
    description: 'Ultra-low latency inference on custom LPU silicon.',
    defaultModel: 'llama-3.3-70b-versatile',
    models: [
      {id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile'},
      {id: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B'},
    ],
    placeholderKey: 'gsk_...',
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    description: 'La Plateforme models: Mistral Large, Pixtral & Codestral.',
    defaultModel: 'mistral-large-latest',
    models: [
      {id: 'mistral-large-latest', label: 'Mistral Large'},
      {id: 'pixtral-12b-2409', label: 'Pixtral 12B Vision'},
      {id: 'codestral-latest', label: 'Codestral'},
    ],
    placeholderKey: 'mistral-...',
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    description: 'Local LLMs running on your desktop or LAN host.',
    defaultModel: 'llama3.2:latest',
    models: [
      {id: 'llama3.2:latest', label: 'Llama 3.2'},
      {id: 'qwen2.5-coder:latest', label: 'Qwen 2.5 Coder'},
      {id: 'deepseek-r1:latest', label: 'DeepSeek R1'},
    ],
    placeholderKey: 'http://localhost:11434',
  },
  {
    id: 'openai-compatible',
    name: 'OpenAI Compatible',
    description: 'Any self-hosted or proxy endpoint implementing the OpenAI /v1 API.',
    defaultModel: 'default',
    models: [{id: 'default', label: 'Custom Model'}],
    placeholderKey: 'sk-...',
  },
];

export const STORAGE_KEYS_KEY = 'balabot:model-keys';
export const STORAGE_SETTINGS_KEY = 'balabot:model-settings';

export type SavedModelSettings = {
  defaultProvider: string;
  defaultModel: string;
  contextWindow: number;
  maxTokens: number;
  thinkingLevel: 'off' | 'low' | 'medium' | 'high';
};

export function readSavedKeys(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function writeSavedKeys(keys: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEYS_KEY, JSON.stringify(keys));
  } catch (err) {
    console.error('Failed to persist model keys in localStorage', err);
  }
}

export function readSavedSettings(): SavedModelSettings {
  const fallback: SavedModelSettings = {
    defaultProvider: 'openrouter',
    defaultModel: 'deepseek/deepseek-v4.1-flash',
    contextWindow: 128000,
    maxTokens: 8192,
    thinkingLevel: 'medium',
  };
  try {
    const raw = localStorage.getItem(STORAGE_SETTINGS_KEY);
    return raw ? {...fallback, ...JSON.parse(raw)} : fallback;
  } catch {
    return fallback;
  }
}

export function writeSavedSettings(settings: SavedModelSettings): void {
  try {
    localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(settings));
  } catch (err) {
    console.error('Failed to persist model settings in localStorage', err);
  }
}

type Props = {
  embedded?: boolean;
  onClose?: () => void;
};

/**
 * Polaris ModelSettingsOverlay:
 * Full provider catalog, model selector, inference limits, and durable API key persistence.
 */
export function ModelSettingsOverlay({embedded = true}: Props) {
  const [providerId, setProviderId] = useState<string>('openrouter');
  const [savedKeys, setSavedKeys] = useState<Record<string, string>>(() => readSavedKeys());
  const [settings, setSettings] = useState<SavedModelSettings>(() => readSavedSettings());
  const [apiKeyInput, setApiKeyInput] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSavedRecently, setIsSavedRecently] = useState(false);

  // Sync state on provider switch or mount
  useEffect(() => {
    const keys = readSavedKeys();
    setSavedKeys(keys);
    setApiKeyInput(keys[providerId] || '');
  }, [providerId]);

  const currentProvider = MODEL_PROVIDERS.find(p => p.id === providerId) ?? MODEL_PROVIDERS[0];
  const isKeySaved = Boolean(savedKeys[providerId]?.trim());
  const isDefaultProvider = settings.defaultProvider === providerId;

  const handleSaveKey = () => {
    const trimmed = apiKeyInput.trim();
    const nextKeys = {...savedKeys, [providerId]: trimmed};
    if (!trimmed) {
      delete nextKeys[providerId];
    }
    writeSavedKeys(nextKeys);
    setSavedKeys(nextKeys);

    setIsSavedRecently(true);
    setStatusMessage(trimmed ? `API key for ${currentProvider.name} saved durable in storage.` : `Cleared key for ${currentProvider.name}.`);
    setTimeout(() => setIsSavedRecently(false), 3000);
  };

  const handleSetAsDefault = (modelId?: string) => {
    const nextSettings: SavedModelSettings = {
      ...settings,
      defaultProvider: providerId,
      defaultModel: modelId || currentProvider.defaultModel,
    };
    writeSavedSettings(nextSettings);
    setSettings(nextSettings);
    setStatusMessage(`Default fleet provider set to ${currentProvider.name} (${nextSettings.defaultModel}).`);
  };

  const handleModelChange = (modelId: string) => {
    const nextSettings: SavedModelSettings = {
      ...settings,
      defaultModel: modelId,
      ...(isDefaultProvider ? {defaultModel: modelId} : {}),
    };
    writeSavedSettings(nextSettings);
    setSettings(nextSettings);
  };

  const handleLimitsChange = (field: 'contextWindow' | 'maxTokens' | 'thinkingLevel', val: any) => {
    const nextSettings = {...settings, [field]: val};
    writeSavedSettings(nextSettings);
    setSettings(nextSettings);
  };

  return (
    <div
      data-testid="models-settings"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'}}>
        <div>
          <h3 style={{margin: '0 0 4px 0', fontSize: '15px', fontWeight: 600, color: 'var(--foreground)'}}>
            Model & Provider Configuration
          </h3>
          <p style={{margin: 0, fontSize: '13px', color: 'var(--muted-foreground)'}}>
            Connect LLM provider credentials and select primary reasoning models for the agent fleet.
          </p>
        </div>
        {isKeySaved ? (
          <span
            data-testid="provider-connected-badge"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '9999px',
              backgroundColor: 'rgba(34, 197, 94, 0.15)',
              color: 'var(--success, #22c55e)',
              fontSize: '12px',
              fontWeight: 600,
            }}
          >
            <Check size={13} strokeWidth={2.5} /> Connected
          </span>
        ) : (
          <span
            data-testid="provider-unconnected-badge"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '9999px',
              backgroundColor: 'var(--muted)',
              color: 'var(--muted-foreground)',
              fontSize: '12px',
            }}
          >
            Not configured
          </span>
        )}
      </div>

      {statusMessage ? (
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
          <span>{statusMessage}</span>
        </div>
      ) : null}

      {/* Provider Selector Grid */}
      <div>
        <label style={{display: 'block', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--muted-foreground)', marginBottom: '8px'}}>
          Select Provider
        </label>
        <div
          data-testid="model-provider-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '8px',
          }}
        >
          {MODEL_PROVIDERS.map(p => {
            const isSelected = p.id === providerId;
            const hasKey = Boolean(savedKeys[p.id]?.trim());
            return (
              <button
                key={p.id}
                type="button"
                data-testid={`provider-card-${p.id}`}
                aria-pressed={isSelected}
                onClick={() => setProviderId(p.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-md, 10px)',
                  border: isSelected ? '1px solid var(--ring)' : '1px solid var(--border)',
                  backgroundColor: isSelected ? 'var(--accent)' : 'var(--card)',
                  color: isSelected ? 'var(--foreground)' : 'var(--foreground)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 120ms ease',
                }}
              >
                <div style={{minWidth: 0}}>
                  <div style={{fontWeight: 600, fontSize: '13.5px'}}>{p.name}</div>
                  <div style={{fontSize: '11.5px', color: 'var(--muted-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                    {hasKey ? 'Key connected' : 'No key saved'}
                  </div>
                </div>
                {hasKey ? (
                  <Check size={14} style={{color: 'var(--success, #22c55e)', flexShrink: 0}} />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active Provider Details & Credential Box */}
      <div
        style={{
          padding: '18px',
          borderRadius: 'var(--radius-lg, 12px)',
          border: '1px solid var(--border)',
          backgroundColor: 'var(--card)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
          <div>
            <h4 style={{margin: '0 0 2px 0', fontSize: '14.5px', fontWeight: 600, color: 'var(--foreground)'}}>
              {currentProvider.name} Credentials
            </h4>
            <p style={{margin: 0, fontSize: '12.5px', color: 'var(--muted-foreground)'}}>
              {currentProvider.description}
            </p>
          </div>
          <button
            type="button"
            data-testid="set-default-provider-btn"
            className="polaris-btn polaris-btn-outline"
            onClick={() => handleSetAsDefault()}
            style={{fontSize: '12px', height: '28px', padding: '0 10px'}}
          >
            {isDefaultProvider ? 'Current Fleet Default' : 'Set as Fleet Default'}
          </button>
        </div>

        {/* API Key Input Row */}
        <div>
          <label
            htmlFor="model-api-key-input"
            style={{display: 'block', fontSize: '12.5px', fontWeight: 500, color: 'var(--foreground)', marginBottom: '6px'}}
          >
            API Key / Endpoint Token
          </label>
          <div style={{display: 'flex', gap: '8px'}}>
            <div style={{position: 'relative', flex: 1}}>
              <input
                id="model-api-key-input"
                data-testid="model-api-key-input"
                type="password"
                value={apiKeyInput}
                onChange={e => setApiKeyInput(e.target.value)}
                placeholder={currentProvider.placeholderKey}
                className="polaris-input"
                style={{paddingLeft: '32px'}}
              />
              <Key size={14} style={{position: 'absolute', left: '10px', top: '12px', color: 'var(--muted-foreground)'}} />
            </div>
            <button
              type="button"
              data-testid="model-save-btn"
              onClick={handleSaveKey}
              className="polaris-btn polaris-btn-primary"
              style={{flexShrink: 0, padding: '0 16px'}}
            >
              {isSavedRecently ? 'Saved!' : 'Save Key'}
            </button>
          </div>
          <p style={{margin: '6px 0 0 0', fontSize: '11.5px', color: 'var(--muted-foreground)'}}>
            Keys are saved durably in localStorage and re-read on reload. Never transmitted in logs or plaintext chat.
          </p>
        </div>

        {/* Default Model Selection for this Provider */}
        <div>
          <label
            htmlFor="model-selection-select"
            style={{display: 'block', fontSize: '12.5px', fontWeight: 500, color: 'var(--foreground)', marginBottom: '6px'}}
          >
            Active Model
          </label>
          <select
            id="model-selection-select"
            data-testid="model-select"
            value={settings.defaultModel}
            onChange={e => handleModelChange(e.target.value)}
            className="polaris-input"
            style={{cursor: 'pointer'}}
          >
            {currentProvider.models.map(m => (
              <option key={m.id} value={m.id}>
                {m.label} ({m.id})
              </option>
            ))}
          </select>
        </div>

        {/* Model Limit Parameters */}
        <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', paddingTop: '8px', borderTop: '1px solid var(--border)'}}>
          <div>
            <label style={{display: 'block', fontSize: '12px', color: 'var(--muted-foreground)', marginBottom: '4px'}}>
              Context Window
            </label>
            <input
              type="number"
              value={settings.contextWindow}
              onChange={e => handleLimitsChange('contextWindow', parseInt(e.target.value, 10) || 128000)}
              className="polaris-input"
              style={{height: '34px'}}
            />
          </div>

          <div>
            <label style={{display: 'block', fontSize: '12px', color: 'var(--muted-foreground)', marginBottom: '4px'}}>
              Max Output Tokens
            </label>
            <input
              type="number"
              value={settings.maxTokens}
              onChange={e => handleLimitsChange('maxTokens', parseInt(e.target.value, 10) || 8192)}
              className="polaris-input"
              style={{height: '34px'}}
            />
          </div>

          <div>
            <label style={{display: 'block', fontSize: '12px', color: 'var(--muted-foreground)', marginBottom: '4px'}}>
              Reasoning Effort
            </label>
            <select
              value={settings.thinkingLevel}
              onChange={e => handleLimitsChange('thinkingLevel', e.target.value as any)}
              className="polaris-input"
              style={{height: '34px', cursor: 'pointer'}}
            >
              <option value="off">Off (Fastest)</option>
              <option value="low">Low Reasoning</option>
              <option value="medium">Medium (Balanced)</option>
              <option value="high">High Reasoning (Deep)</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
