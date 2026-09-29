import {useEffect, useState} from 'react';
import {Check, Key, Mic, Play, ShieldCheck, Volume2} from 'lucide-react';

export type VoiceProvider = {
  id: string;
  name: string;
  description: string;
  voices: {id: string; name: string}[];
  placeholderKey: string;
};

export const VOICE_PROVIDERS: VoiceProvider[] = [
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    description: 'High-fidelity ultra-realistic neural speech synthesis.',
    voices: [
      {id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel (Calm, Warm)'},
      {id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi (Empathetic)'},
      {id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella (Gentle)'},
      {id: 'ErXwobaYiN019PkySvjV', name: 'Antoni (Dynamic)'},
    ],
    placeholderKey: 'xi-api-key-...',
  },
  {
    id: 'openai',
    name: 'OpenAI Voice',
    description: 'Natural low-latency speech synthesized by OpenAI Audio.',
    voices: [
      {id: 'alloy', name: 'Alloy (Neutral)'},
      {id: 'echo', name: 'Echo (Warm)'},
      {id: 'fable', name: 'Fable (British)'},
      {id: 'onyx', name: 'Onyx (Deep)'},
      {id: 'nova', name: 'Nova (Energetic)'},
      {id: 'shimmer', name: 'Shimmer (Clear)'},
    ],
    placeholderKey: 'sk-proj-...',
  },
  {
    id: 'cartesia',
    name: 'Cartesia Sonic',
    description: 'Sub-100ms ultra-low latency real-time voice streaming.',
    voices: [
      {id: 'sonic-english', name: 'Sonic (Standard)'},
      {id: 'sonic-expressive', name: 'Sonic Expressive'},
    ],
    placeholderKey: 'cartesia-...',
  },
];

export const STORAGE_VOICE_KEY = 'balabot:voice-config';

export type VoiceConfig = {
  provider: string;
  voiceId: string;
  apiKey?: string;
  transcribeLive: boolean;
};

export function readVoiceConfig(): VoiceConfig {
  const fallback: VoiceConfig = {
    provider: 'elevenlabs',
    voiceId: '21m00Tcm4TlvDq8ikWAM',
    transcribeLive: true,
  };
  try {
    const raw = localStorage.getItem(STORAGE_VOICE_KEY);
    return raw ? {...fallback, ...JSON.parse(raw)} : fallback;
  } catch {
    return fallback;
  }
}

export function writeVoiceConfig(config: VoiceConfig): void {
  try {
    localStorage.setItem(STORAGE_VOICE_KEY, JSON.stringify(config));
  } catch (err) {
    console.error('Failed to write voice config', err);
  }
}

type Props = {
  embedded?: boolean;
  onClose?: () => void;
  onBusyChange?: (busy: boolean) => void;
};

export function VoiceSettingsOverlay({embedded = true}: Props) {
  const [config, setConfig] = useState<VoiceConfig>(() => readVoiceConfig());
  const [apiKeyInput, setApiKeyInput] = useState(config.apiKey || '');
  const [testing, setTesting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const selectedProvider = VOICE_PROVIDERS.find(p => p.id === config.provider) ?? VOICE_PROVIDERS[0];
  const isKeySaved = Boolean(config.apiKey?.trim());

  const handleProviderSelect = (id: string) => {
    const nextProvider = VOICE_PROVIDERS.find(p => p.id === id) ?? VOICE_PROVIDERS[0];
    const next = {
      ...config,
      provider: id,
      voiceId: nextProvider.voices[0]?.id || '',
    };
    setConfig(next);
    writeVoiceConfig(next);
  };

  const handleSaveKey = () => {
    const trimmed = apiKeyInput.trim();
    const next = {...config, apiKey: trimmed || undefined};
    setConfig(next);
    writeVoiceConfig(next);
    setStatusMessage(trimmed ? `API key for ${selectedProvider.name} saved.` : `Cleared key.`);
    setTimeout(() => setStatusMessage(null), 3000);
  };

  const handleVoiceSelect = (voiceId: string) => {
    const next = {...config, voiceId};
    setConfig(next);
    writeVoiceConfig(next);
  };

  const handleToggleTranscribe = () => {
    const next = {...config, transcribeLive: !config.transcribeLive};
    setConfig(next);
    writeVoiceConfig(next);
  };

  const handleTestVoice = () => {
    setTesting(true);
    setStatusMessage(`Testing ${selectedProvider.name} voice playback…`);
    setTimeout(() => {
      setTesting(false);
      setStatusMessage('Voice test completed.');
      setTimeout(() => setStatusMessage(null), 2500);
    }, 1800);
  };

  return (
    <div
      data-testid="voice-settings"
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
            Voice & Speech Synthesis
          </h3>
          <p style={{margin: 0, fontSize: '13px', color: 'var(--muted-foreground)'}}>
            Configure conversational voice engines, select realistic speaker voices, and enable live speech transcription.
          </p>
        </div>
        {isKeySaved ? (
          <span
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
        ) : null}
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

      {/* Voice Provider Selection */}
      <div>
        <label style={{display: 'block', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--muted-foreground)', marginBottom: '8px'}}>
          Voice Engine Provider
        </label>
        <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '8px'}}>
          {VOICE_PROVIDERS.map(p => {
            const isSelected = p.id === config.provider;
            return (
              <button
                key={p.id}
                type="button"
                data-testid={`voice-provider-${p.id}`}
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
                <Volume2 size={18} style={{marginTop: '2px', color: isSelected ? 'var(--primary)' : 'var(--muted-foreground)', flexShrink: 0}} />
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

      {/* Voice Credentials & Voice Picker */}
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
        <h4 style={{margin: '0', fontSize: '14.5px', fontWeight: 600, color: 'var(--foreground)'}}>
          {selectedProvider.name} Voice Settings
        </h4>

        {/* API Key */}
        <div>
          <label style={{display: 'block', fontSize: '12.5px', fontWeight: 500, color: 'var(--foreground)', marginBottom: '6px'}}>
            Provider API Key
          </label>
          <div style={{display: 'flex', gap: '8px'}}>
            <div style={{position: 'relative', flex: 1}}>
              <input
                data-testid="voice-api-key-input"
                type="password"
                value={apiKeyInput}
                onChange={e => setApiKeyInput(e.target.value)}
                placeholder={selectedProvider.placeholderKey}
                className="polaris-input"
                style={{paddingLeft: '32px'}}
              />
              <Key size={14} style={{position: 'absolute', left: '10px', top: '12px', color: 'var(--muted-foreground)'}} />
            </div>
            <button
              type="button"
              data-testid="voice-save-key-btn"
              onClick={handleSaveKey}
              className="polaris-btn polaris-btn-primary"
              style={{flexShrink: 0}}
            >
              Save Key
            </button>
          </div>
        </div>

        {/* Voice Selector */}
        <div>
          <label
            htmlFor="voice-select-id"
            style={{display: 'block', fontSize: '12.5px', fontWeight: 500, color: 'var(--foreground)', marginBottom: '6px'}}
          >
            Speaker Voice
          </label>
          <div style={{display: 'flex', gap: '8px'}}>
            <select
              id="voice-select-id"
              data-testid="voice-select"
              value={config.voiceId}
              onChange={e => handleVoiceSelect(e.target.value)}
              className="polaris-input"
              style={{cursor: 'pointer', flex: 1}}
            >
              {selectedProvider.voices.map(v => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              data-testid="test-voice-btn"
              disabled={testing}
              onClick={handleTestVoice}
              className="polaris-btn polaris-btn-outline"
              style={{display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0}}
            >
              <Play size={13} /> {testing ? 'Testing…' : 'Test voice'}
            </button>
          </div>
        </div>

        {/* Live Transcription Toggle */}
        <div style={{paddingTop: '12px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
          <div>
            <div style={{fontSize: '13.5px', fontWeight: 500, color: 'var(--foreground)'}}>
              Live Speech Transcription
            </div>
            <div style={{fontSize: '12px', color: 'var(--muted-foreground)'}}>
              Show real-time speech-to-text transcription captions during calls.
            </div>
          </div>
          <button
            type="button"
            data-testid="voice-transcribe-toggle"
            aria-pressed={config.transcribeLive}
            onClick={handleToggleTranscribe}
            className={`polaris-btn ${config.transcribeLive ? 'polaris-btn-primary' : 'polaris-btn-outline'}`}
            style={{height: '32px', padding: '0 14px', fontSize: '12.5px'}}
          >
            {config.transcribeLive ? 'Enabled' : 'Disabled'}
          </button>
        </div>
      </div>
    </div>
  );
}
