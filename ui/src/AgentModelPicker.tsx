import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Cpu, Search, Check, ChevronDown, Sparkles, X, Zap } from 'lucide-react';
import { getAvailableModels, updateBotModel, type Bot, type ModelInfo } from './api';

type Props = {
  bot: Bot;
  onModelChange: (modelId: string) => void;
  fullWidth?: boolean;
};

// In-memory module cache for auto-discovered models across agent switches
let cachedDiscoveredModels: ModelInfo[] | null = null;

const CURATED_MODELS = [
  'anthropic/claude-3.7-sonnet',
  'anthropic/claude-3.5-sonnet',
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'deepseek/deepseek-r1',
  'deepseek/deepseek-chat',
  'meta-llama/llama-3.3-70b-instruct',
  'google/gemini-2.0-flash-001',
  'qwen/qwen-2.5-coder-32b-instruct',
];

export function AgentModelPicker({ bot, onModelChange, fullWidth }: Props) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>(() => cachedDiscoveredModels || []);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const activeModelId = bot.model || 'anthropic/claude-3.5-sonnet';

  // Format short model name for trigger display
  const shortModelLabel = useMemo(() => {
    const found = models.find(m => m.id === activeModelId);
    if (found) return found.name || found.id.split('/').pop() || found.id;
    return activeModelId.split('/').pop() || activeModelId;
  }, [models, activeModelId]);

  // Load models on mount or when opening
  useEffect(() => {
    let mounted = true;
    if (!cachedDiscoveredModels || cachedDiscoveredModels.length === 0) {
      setLoading(true);
      getAvailableModels()
        .then(res => {
          if (mounted && res && res.models) {
            cachedDiscoveredModels = res.models;
            setModels(res.models);
          }
        })
        .catch(err => {
          console.warn('Failed to load auto-discovered models:', err);
        })
        .finally(() => {
          if (mounted) setLoading(false);
        });
    } else {
      setModels(cachedDiscoveredModels);
    }
    return () => {
      mounted = false;
    };
  }, [open]);

  // Handle outside click & escape key
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  // Focus search input when popover opens
  useEffect(() => {
    if (open) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    } else {
      setSearch('');
    }
  }, [open]);

  // Filter out batch variants that break interactive chat (BB-035)
  const isBatchVariant = (id: string) => id.includes(':batch') || id.endsWith('-batch');

  // Filter models based on search term (excluding batch variants)
  const filteredModels = useMemo(() => {
    const interactive = models.filter(m => !isBatchVariant(m.id));
    const q = search.trim().toLowerCase();
    if (!q) return interactive;
    return interactive.filter(m =>
      m.id.toLowerCase().includes(q) ||
      m.name.toLowerCase().includes(q) ||
      m.provider.toLowerCase().includes(q)
    );
  }, [models, search]);

  // Quick picks when query is empty
  const quickPicks = useMemo(() => {
    if (search.trim()) return [];
    const set = new Set(CURATED_MODELS);
    return models.filter(m => set.has(m.id) && !isBatchVariant(m.id));
  }, [models, search]);

  const handleSelectModel = async (modelId: string) => {
    if (saving || modelId === activeModelId) {
      setOpen(false);
      return;
    }
    setSaving(true);
    try {
      await updateBotModel(bot.id, modelId);
      onModelChange(modelId);
    } catch (err) {
      console.error('Failed to update bot model:', err);
    } finally {
      setSaving(false);
      setOpen(false);
    }
  };

  const formatContextLength = (len?: number) => {
    if (!len) return null;
    if (len >= 1_000_000) return `${Math.round(len / 1_000_000)}M ctx`;
    if (len >= 1000) return `${Math.round(len / 1000)}k ctx`;
    return `${len} ctx`;
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        display: fullWidth ? 'flex' : 'inline-flex',
        alignItems: 'center',
        width: fullWidth ? '100%' : 'auto',
      }}
    >
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        title={`Model for ${bot.name}: ${activeModelId} (Click to change)`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: fullWidth ? 'space-between' : 'flex-start',
          gap: '8px',
          padding: fullWidth ? '8px 12px' : '3px 8px',
          borderRadius: fullWidth ? '8px' : '6px',
          background: 'var(--surface-subtle, rgba(255, 255, 255, 0.05))',
          border: '1px solid var(--border-color, rgba(255, 255, 255, 0.12))',
          color: 'var(--foreground, #ececec)',
          fontSize: fullWidth ? '13px' : '12px',
          fontWeight: 500,
          cursor: 'pointer',
          outline: 'none',
          width: fullWidth ? '100%' : 'auto',
          maxWidth: fullWidth ? 'none' : '220px',
          transition: 'all 0.15s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
          <Zap size={14} style={{ color: 'var(--accent, #38bdf8)', flexShrink: 0 }} />
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: fullWidth ? '260px' : '160px',
            }}
          >
            {shortModelLabel}
          </span>
        </div>
        <ChevronDown
          size={13}
          style={{
            color: 'var(--muted-foreground, #888)',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s ease',
            flexShrink: 0,
          }}
        />
      </button>

      {/* Popover Dropdown */}
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            width: fullWidth ? '100%' : '380px',
            maxWidth: '420px',
            maxHeight: '460px',
            background: 'var(--surface-overlay, #18181b)',
            border: '1px solid var(--border-color, rgba(255, 255, 255, 0.15))',
            borderRadius: '10px',
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45), 0 2px 6px rgba(0, 0, 0, 0.25)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Header & Search */}
          <div
            style={{
              padding: '10px 12px 8px',
              borderBottom: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
              background: 'var(--surface-header, rgba(255, 255, 255, 0.02))',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '8px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Cpu size={14} style={{ color: 'var(--accent, #38bdf8)' }} />
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--foreground, #fff)' }}>
                  Model for {bot.name}
                </span>
              </div>
              <span style={{ fontSize: '11px', color: 'var(--muted-foreground, #888)' }}>
                {models.length} discovered
              </span>
            </div>

            {/* Search Input Bar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 10px',
                borderRadius: '6px',
                background: 'var(--surface-input, rgba(0, 0, 0, 0.35))',
                border: '1px solid var(--border-color, rgba(255, 255, 255, 0.12))',
              }}
            >
              <Search size={14} style={{ color: 'var(--muted-foreground, #888)', flexShrink: 0 }} />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search models (e.g. claude, gpt, deepseek)..."
                style={{
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'var(--foreground, #fff)',
                  fontSize: '12px',
                  width: '100%',
                }}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    color: 'var(--muted-foreground, #888)',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Scrollable Model List */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '6px',
            }}
          >
            {loading && models.length === 0 ? (
              <div
                style={{
                  padding: '24px 16px',
                  textAlign: 'center',
                  color: 'var(--muted-foreground, #888)',
                  fontSize: '12px',
                }}
              >
                Discovering models from provider...
              </div>
            ) : filteredModels.length === 0 ? (
              <div
                style={{
                  padding: '24px 16px',
                  textAlign: 'center',
                  color: 'var(--muted-foreground, #888)',
                  fontSize: '12px',
                }}
              >
                No models match "{search}"
              </div>
            ) : (
              <>
                {/* Quick Picks Header if empty search */}
                {quickPicks.length > 0 && (
                  <div style={{ marginBottom: '6px' }}>
                    <div
                      style={{
                        padding: '4px 8px',
                        fontSize: '10px',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        color: 'var(--muted-foreground, #71717a)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      <Sparkles size={11} style={{ color: 'var(--accent, #38bdf8)' }} />
                      Recommended Models
                    </div>
                    {quickPicks.map(m => (
                      <ModelRow
                        key={`quick-${m.id}`}
                        model={m}
                        isSelected={m.id === activeModelId}
                        onSelect={() => handleSelectModel(m.id)}
                        formatContext={formatContextLength}
                      />
                    ))}
                    <div
                      style={{
                        margin: '6px 4px',
                        borderBottom: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
                      }}
                    />
                    <div
                      style={{
                        padding: '4px 8px',
                        fontSize: '10px',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        color: 'var(--muted-foreground, #71717a)',
                      }}
                    >
                      All Discovered Models ({models.length})
                    </div>
                  </div>
                )}

                {/* Main Filtered List */}
                {filteredModels.map(m => (
                  <ModelRow
                    key={m.id}
                    model={m}
                    isSelected={m.id === activeModelId}
                    onSelect={() => handleSelectModel(m.id)}
                    formatContext={formatContextLength}
                  />
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ModelRow({
  model,
  isSelected,
  onSelect,
  formatContext,
}: {
  model: ModelInfo;
  isSelected: boolean;
  onSelect: () => void;
  formatContext: (len?: number) => string | null;
}) {
  const [hovered, setHovered] = useState(false);

  const contextStr = formatContext(model.context_length);

  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '7px 10px',
        borderRadius: '6px',
        cursor: 'pointer',
        background: isSelected
          ? 'var(--accent-subtle, rgba(56, 189, 248, 0.12))'
          : hovered
          ? 'var(--surface-hover, rgba(255, 255, 255, 0.06))'
          : 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
        transition: 'background 0.1s ease',
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span
            style={{
              fontSize: '12px',
              fontWeight: isSelected ? 600 : 500,
              color: isSelected ? 'var(--accent, #38bdf8)' : 'var(--foreground, #ececec)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {model.name}
          </span>
          {contextStr && (
            <span
              style={{
                fontSize: '10px',
                padding: '1px 5px',
                borderRadius: '4px',
                background: 'rgba(255, 255, 255, 0.06)',
                color: 'var(--muted-foreground, #a1a1aa)',
                flexShrink: 0,
              }}
            >
              {contextStr}
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: '11px',
            color: 'var(--muted-foreground, #71717a)',
            fontFamily: 'monospace',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginTop: '2px',
          }}
        >
          {model.id}
        </div>
      </div>

      {isSelected && (
        <Check size={14} style={{ color: 'var(--accent, #38bdf8)', flexShrink: 0 }} />
      )}
    </div>
  );
}
