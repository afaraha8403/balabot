import {useState, useEffect} from 'react';
import {ShieldCheck, ShieldAlert} from 'lucide-react';

export const STORAGE_APPROVAL_RULES_KEY = 'balabot.approvalRules.v1';

export type ApprovalRule = {
  id: string;
  effect: 'require_approval' | 'auto_allow';
  matchKind: 'tool_class' | 'tool_name';
  matchValue: string;
};

export type ApprovalRulesConfig = {
  rules: ApprovalRule[];
  autoReviewEnabled: boolean;
};

export function loadApprovalRules(): ApprovalRulesConfig {
  const fallback: ApprovalRulesConfig = {
    rules: [],
    autoReviewEnabled: false,
  };
  try {
    const raw = localStorage.getItem(STORAGE_APPROVAL_RULES_KEY);
    return raw ? {...fallback, ...JSON.parse(raw)} : fallback;
  } catch {
    return fallback;
  }
}

export function saveApprovalRules(config: ApprovalRulesConfig): void {
  try {
    localStorage.setItem(STORAGE_APPROVAL_RULES_KEY, JSON.stringify(config));
  } catch (err) {
    console.error('Failed to write approval rules', err);
  }
}

type Props = {
  embedded?: boolean;
  onClose?: () => void;
};

function describeRule(rule: ApprovalRule): string {
  if (rule.effect === 'require_approval') {
    if (rule.matchKind === 'tool_class') {
      return `Ask before ${rule.matchValue} tools`;
    }
    return `Ask before ${rule.matchValue}`;
  }
  if (rule.matchKind === 'tool_class') {
    return `Auto-allow ${rule.matchValue} tools`;
  }
  return `Auto-allow ${rule.matchValue}`;
}

/**
 * Approval rules settings panel exposing which tool classes / tool names
 * require human approval before execution, auto-approve allow-list, and deny-list.
 *
 * Persists to localStorage under `balabot.approvalRules.v1`.
 */
export function ApprovalRulesSettings({embedded = true}: Props) {
  const [config, setConfig] = useState<ApprovalRulesConfig>(() => loadApprovalRules());
  const [newToolClass, setNewToolClass] = useState('');
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const handleAddRule = (effect: 'require_approval' | 'auto_allow', matchValue: string) => {
    if (!matchValue.trim()) return;

    const newRule: ApprovalRule = {
      id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      effect,
      matchKind: 'tool_class',
      matchValue: matchValue.trim(),
    };

    const next = {
      ...config,
      rules: [...config.rules, newRule],
    };
    setConfig(next);
    saveApprovalRules(next);
    setNewToolClass('');
    showNotice(`Added ${effect === 'require_approval' ? 'approval' : 'allow'} rule for "${matchValue.trim()}".`);
  };

  const handleRemoveRule = (id: string) => {
    const next = {
      ...config,
      rules: config.rules.filter(r => r.id !== id),
    };
    setConfig(next);
    saveApprovalRules(next);
    showNotice('Rule removed.');
  };

  const handleToggleAutoReview = (enabled: boolean) => {
    const next = {...config, autoReviewEnabled: enabled};
    setConfig(next);
    saveApprovalRules(next);
    showNotice(`Auto-review ${enabled ? 'enabled' : 'disabled'}.`);
  };

  const showNotice = (message: string) => {
    setStatusNotice(message);
    setTimeout(() => setStatusNotice(null), 3000);
  };

  const presetRules = [
    {label: 'Ask before external email tools', value: 'email'},
    {label: 'Ask before purchase tools', value: 'purchase'},
    {label: 'Ask before file deletion tools', value: 'file_delete'},
  ];

  return (
    <div
      data-testid="approval-rules-settings"
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
          Tool Approval Rules
        </h3>
        <p style={{margin: 0, fontSize: '13px', color: 'var(--muted-foreground)'}}>
          Bots execute tools automatically by default. Add exceptions for tool classes that require your review first.
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

      {/* Auto-review toggle */}
      <div
        data-testid="auto-review-toggle"
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
            checked={config.autoReviewEnabled}
            onChange={e => handleToggleAutoReview(e.target.checked)}
            style={{
              width: '18px',
              height: '18px',
              cursor: 'pointer',
              accentColor: 'var(--primary)',
            }}
          />
          <div>
            <div style={{fontSize: '13px', fontWeight: 600, color: 'var(--foreground)'}}>
              Flag unexpected tool actions
            </div>
            <div style={{fontSize: '12px', color: 'var(--muted-foreground)', marginTop: '2px'}}>
              Automatically pause execution when a bot attempts an action outside its stated plan.
            </div>
          </div>
        </label>
      </div>

      {/* Preset rule shortcuts */}
      <div
        style={{
          padding: '16px',
          borderRadius: 'var(--radius-lg, 12px)',
          border: '1px solid var(--border)',
          backgroundColor: 'var(--card)',
        }}
      >
        <label style={{display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--foreground)', marginBottom: '8px'}}>
          Quick presets
        </label>
        <div style={{display: 'flex', flexDirection: 'column', gap: '6px'}}>
          {presetRules.map(preset => {
            const alreadyExists = config.rules.some(
              r => r.effect === 'require_approval' && r.matchValue === preset.value,
            );
            return (
              <button
                key={preset.value}
                type="button"
                disabled={alreadyExists}
                onClick={() => handleAddRule('require_approval', preset.value)}
                style={{
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-md, 8px)',
                  border: '1px solid var(--border)',
                  backgroundColor: alreadyExists ? 'var(--muted)' : 'var(--background)',
                  color: alreadyExists ? 'var(--muted-foreground)' : 'var(--foreground)',
                  cursor: alreadyExists ? 'not-allowed' : 'pointer',
                  fontSize: '12.5px',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                  transition: 'all 120ms ease',
                }}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom rule input */}
      <div
        style={{
          padding: '16px',
          borderRadius: 'var(--radius-lg, 12px)',
          border: '1px solid var(--border)',
          backgroundColor: 'var(--card)',
        }}
      >
        <label style={{display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--foreground)', marginBottom: '8px'}}>
          Add custom rule
        </label>
        <div style={{display: 'flex', gap: '8px'}}>
          <input
            type="text"
            data-testid="custom-rule-input"
            placeholder="Tool class (e.g. database_write)"
            value={newToolClass}
            onChange={e => setNewToolClass(e.target.value)}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 'var(--radius-md, 8px)',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--background)',
              color: 'var(--foreground)',
              fontSize: '13px',
              fontFamily: 'inherit',
            }}
          />
          <button
            type="button"
            data-testid="add-approval-rule-btn"
            disabled={!newToolClass.trim()}
            onClick={() => handleAddRule('require_approval', newToolClass)}
            style={{
              padding: '8px 16px',
              borderRadius: 'var(--radius-md, 8px)',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--primary)',
              color: 'var(--primary-foreground)',
              cursor: newToolClass.trim() ? 'pointer' : 'not-allowed',
              fontSize: '13px',
              fontWeight: 600,
              fontFamily: 'inherit',
              opacity: newToolClass.trim() ? 1 : 0.5,
            }}
          >
            Add
          </button>
        </div>
      </div>

      {/* Current rules list */}
      <div
        style={{
          padding: '16px',
          borderRadius: 'var(--radius-lg, 12px)',
          border: '1px solid var(--border)',
          backgroundColor: 'var(--card)',
        }}
      >
        <label style={{display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--foreground)', marginBottom: '8px'}}>
          Active rules
        </label>
        {config.rules.length === 0 ? (
          <p style={{margin: 0, fontSize: '12.5px', color: 'var(--muted-foreground)'}}>
            No rules. All tools execute automatically.
          </p>
        ) : (
          <ul
            data-testid="approval-rules-list"
            style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            {config.rules.map(rule => (
              <li
                key={rule.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-md, 8px)',
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--background)',
                }}
              >
                <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                  {rule.effect === 'require_approval' ? (
                    <ShieldAlert size={14} style={{color: 'var(--warning, #f59e0b)', flexShrink: 0}} />
                  ) : (
                    <ShieldCheck size={14} style={{color: 'var(--success, #22c55e)', flexShrink: 0}} />
                  )}
                  <span style={{fontSize: '12.5px', color: 'var(--foreground)'}}>
                    {describeRule(rule)}
                  </span>
                </div>
                <button
                  type="button"
                  data-testid={`remove-rule-${rule.id}`}
                  onClick={() => handleRemoveRule(rule.id)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-sm, 6px)',
                    border: '1px solid var(--border)',
                    backgroundColor: 'transparent',
                    color: 'var(--muted-foreground)',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontFamily: 'inherit',
                    transition: 'all 120ms ease',
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
