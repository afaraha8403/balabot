import {useEffect, useState} from 'react';
import {Brain, Check, Database, HardDrive, ShieldCheck} from 'lucide-react';

export type MemoryProviderOption = {
  id: string;
  name: string;
  description: string;
  icon: typeof Brain;
};

export const MEMORY_PROVIDERS: MemoryProviderOption[] = [
  {
    id: 'local',
    name: 'Local Holographic Memory',
    description: 'Embedded SQLite vector and graph index under /opt/data/memory.',
    icon: HardDrive,
  },
  {
    id: 'supermemory',
    name: 'Supermemory Cloud',
    description: 'High-speed cloud vector search with continuous profile synthesis.',
    icon: Brain,
  },
  {
    id: 'serenity',
    name: 'Serenity Vector Store',
    description: 'Enterprise semantic search with role-based document access.',
    icon: Database,
  },
];

export const STORAGE_MEMORY_KEY = 'balabot:memory-config';

export type MemoryConfig = {
  provider: string;
  defaultScope: 'isolated' | 'shared';
  apiKey?: string;
  endpoint?: string;
  chunkSize: number;
};

export function readMemoryConfig(): MemoryConfig {
  const fallback: MemoryConfig = {
    provider: 'local',
    defaultScope: 'isolated',
    chunkSize: 512,
  };
  try {
    const raw = localStorage.getItem(STORAGE_MEMORY_KEY);
    return raw ? {...fallback, ...JSON.parse(raw)} : fallback;
  } catch {
    return fallback;
  }
}

export function writeMemoryConfig(config: MemoryConfig): void {
  try {
    localStorage.setItem(STORAGE_MEMORY_KEY, JSON.stringify(config));
  } catch (err) {
    console.error('Failed to write memory config', err);
  }
}

type Props = {
  embedded?: boolean;
  onClose?: () => void;
};

export function MemorySettingsOverlay({embedded = true}: Props) {
  const [config, setConfig] = useState<MemoryConfig>(() => readMemoryConfig());
  const [apiKeyInput, setApiKeyInput] = useState(config.apiKey || '');
  const [endpointInput, setEndpointInput] = useState(config.endpoint || '');
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const selectedProvider = MEMORY_PROVIDERS.find(p => p.id === config.provider) ?? MEMORY_PROVIDERS[0];

  const handleProviderSelect = (id: string) => {
    const next = {...config, provider: id};
    setConfig(next);
    writeMemoryConfig(next);
  };

  const handleScopeSelect = (scope: 'isolated' | 'shared') => {
    const next = {...config, defaultScope: scope};
    setConfig(next);
    writeMemoryConfig(next);
  };

  const handleSaveConnection = () => {
    const next = {
      ...config,
      apiKey: apiKeyInput.trim() || undefined,
      endpoint: endpointInput.trim() || undefined,
    };
    setConfig(next);
    writeMemoryConfig(next);
    setStatusNotice(`Memory configuration saved (${selectedProvider.name} · ${config.defaultScope} scope).`);
    setTimeout(() => setStatusNotice(null), 3000);
  };

  return (
    <div
      data-testid="memory-settings"
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
          Holographic Memory & Knowledge Base
        </h3>
        <p style={{margin: 0, fontSize: '13px', color: 'var(--muted-foreground)'}}>
          Configure vector embeddings, document chunking, and memory sharing scopes across the fleet.
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

      {/* Default Memory Scope Picker */}
      <div
        data-testid="memory-scope-picker"
        style={{
          padding: '16px',
          borderRadius: 'var(--radius-lg, 12px)',
          border: '1px solid var(--border)',
          backgroundColor: 'var(--card)',
        }}
      >
        <label style={{display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--foreground)', marginBottom: '4px'}}>
          Default Memory Scope
        </label>
        <p style={{margin: '0 0 12px 0', fontSize: '12.5px', color: 'var(--muted-foreground)'}}>
          Isolated memories remain strictly partitioned per agent profile. Shared memories are recalled by all agents in this space.
        </p>
        <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px'}}>
          {(['isolated', 'shared'] as const).map(scope => {
            const isSelected = config.defaultScope === scope;
            return (
              <button
                key={scope}
                type="button"
                data-testid={`scope-btn-${scope}`}
                aria-pressed={isSelected}
                onClick={() => handleScopeSelect(scope)}
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
                <span>{scope === 'isolated' ? 'Isolated (Per-Profile)' : 'Shared (Space Fleet)'}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Vector Provider Selection */}
      <div>
        <label style={{display: 'block', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--muted-foreground)', marginBottom: '8px'}}>
          Vector Index Provider
        </label>
        <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '8px'}}>
          {MEMORY_PROVIDERS.map(p => {
            const isSelected = p.id === config.provider;
            const Icon = p.icon;
            return (
              <button
                key={p.id}
                type="button"
                data-testid={`memory-provider-${p.id}`}
                aria-pressed={isSelected}
                onClick={() => handleProviderSelect(p.id)}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px',
                  padding: '12px',
                  borderRadius: 'var(--radius-md, 10px)',
                  border: isSelected ? '1px solid var(--ring)' : '1px solid var(--border)',
                  backgroundColor: isSelected ? 'var(--accent)' : 'var(--card)',
                  color: 'var(--foreground)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 120ms ease',
                }}
              >
                <Icon size={18} style={{marginTop: '2px', color: isSelected ? 'var(--primary)' : 'var(--muted-foreground)', flexShrink: 0}} />
                <div>
                  <div style={{fontWeight: 600, fontSize: '13px'}}>{p.name}</div>
                  <div style={{fontSize: '11.5px', color: 'var(--muted-foreground)', marginTop: '2px', lineHeight: 1.3}}>
                    {p.description}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Provider Details & Credentials */}
      <div
        style={{
          padding: '18px',
          borderRadius: 'var(--radius-lg, 12px)',
          border: '1px solid var(--border)',
          backgroundColor: 'var(--card)',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
        }}
      >
        <h4 style={{margin: '0', fontSize: '14px', fontWeight: 600, color: 'var(--foreground)'}}>
          {selectedProvider.name} Parameters
        </h4>

        {config.provider !== 'local' && (
          <>
            <div>
              <label style={{display: 'block', fontSize: '12px', color: 'var(--muted-foreground)', marginBottom: '4px'}}>
                Provider API Key
              </label>
              <input
                type="password"
                value={apiKeyInput}
                onChange={e => setApiKeyInput(e.target.value)}
                placeholder="Enter provider key"
                className="polaris-input"
              />
            </div>
            <div>
              <label style={{display: 'block', fontSize: '12px', color: 'var(--muted-foreground)', marginBottom: '4px'}}>
                Endpoint URL
              </label>
              <input
                type="text"
                value={endpointInput}
                onChange={e => setEndpointInput(e.target.value)}
                placeholder="https://..."
                className="polaris-input"
              />
            </div>
          </>
        )}

        <div style={{display: 'flex', alignItems: 'center', gap: '16px'}}>
          <div style={{flex: 1}}>
            <label style={{display: 'block', fontSize: '12px', color: 'var(--muted-foreground)', marginBottom: '4px'}}>
              Document Chunk Size (Tokens)
            </label>
            <input
              type="number"
              value={config.chunkSize}
              onChange={e => {
                const next = {...config, chunkSize: parseInt(e.target.value, 10) || 512};
                setConfig(next);
                writeMemoryConfig(next);
              }}
              className="polaris-input"
            />
          </div>
          <button
            type="button"
            data-testid="save-memory-settings-btn"
            onClick={handleSaveConnection}
            className="polaris-btn polaris-btn-primary"
            style={{marginTop: '20px', flexShrink: 0}}
          >
            Save Memory Settings
          </button>
        </div>
      </div>
    </div>
  );
}
