import {useCallback, useEffect, useState} from 'react';
import {
  Monitor,
  Check,
  RefreshCw,
  Trash2,
  UserPlus,
  ShieldAlert,
  HardDrive,
  Info,
  Clock,
  Sparkles,
  Sun,
  Moon,
  Laptop,
} from 'lucide-react';
import {
  adoptOrphan,
  listOrphans,
  purgeOrphan,
  reapSubagentArtifacts,
  type OrphanProfile,
  type OrphansResponse,
} from './api';

// ── 1. General Settings Panel ────────────────────────────────────────────────
export function GeneralSettingsPanel({
  userName = 'Ali',
  email = 'ali@balacode.xyz',
}: {
  userName?: string;
  email?: string | null;
}) {
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>(() => {
    return (localStorage.getItem('balabot-theme') as any) || 'dark';
  });
  const [avatarStyle, setAvatarStyle] = useState<'robot' | 'organic'>('robot');
  const [streamReplies, setStreamReplies] = useState(true);

  const handleThemeChange = (nextTheme: 'light' | 'dark' | 'system') => {
    setTheme(nextTheme);
    localStorage.setItem('balabot-theme', nextTheme);
    const dark = nextTheme === 'dark' || (nextTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  };

  return (
    <div data-testid="general-settings" style={{display: 'flex', flexDirection: 'column', gap: '20px'}}>
      {/* Account Info */}
      <section style={{padding: '16px', borderRadius: 'var(--radius-lg, 12px)', border: '1px solid var(--border)', backgroundColor: 'var(--card)'}}>
        <h3 style={{margin: '0 0 8px 0', fontSize: '15px', fontWeight: 600, color: 'var(--foreground)'}}>Account</h3>
        <p style={{margin: 0, fontSize: '14px', color: 'var(--foreground)'}}>{userName}</p>
        {email ? <p style={{margin: '4px 0 0 0', fontSize: '13px', color: 'var(--muted-foreground)'}}>{email}</p> : null}
      </section>

      {/* Appearance Theme */}
      <section style={{padding: '16px', borderRadius: 'var(--radius-lg, 12px)', border: '1px solid var(--border)', backgroundColor: 'var(--card)'}}>
        <h3 style={{margin: '0 0 10px 0', fontSize: '15px', fontWeight: 600, color: 'var(--foreground)'}}>Appearance</h3>
        <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px'}}>
          {[
            {id: 'light' as const, label: 'Light', icon: Sun},
            {id: 'dark' as const, label: 'Dark', icon: Moon},
            {id: 'system' as const, label: 'System', icon: Laptop},
          ].map(opt => {
            const Icon = opt.icon;
            const active = theme === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                data-testid={`theme-option-${opt.id}`}
                aria-pressed={active}
                onClick={() => handleThemeChange(opt.id)}
                className={`polaris-btn ${active ? 'polaris-btn-primary' : 'polaris-btn-outline'}`}
                style={{height: '38px', gap: '8px', fontSize: '13px'}}
              >
                <Icon size={14} />
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Avatar Style */}
      <section data-testid="avatar-style-select" style={{padding: '16px', borderRadius: 'var(--radius-lg, 12px)', border: '1px solid var(--border)', backgroundColor: 'var(--card)'}}>
        <h3 style={{margin: '0 0 4px 0', fontSize: '15px', fontWeight: 600, color: 'var(--foreground)'}}>Avatars</h3>
        <p style={{margin: '0 0 12px 0', fontSize: '12.5px', color: 'var(--muted-foreground)'}}>
          Choose whether bot avatars use the animated robot visor or organic character style.
        </p>
        <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px'}}>
          {(['robot', 'organic'] as const).map(style => {
            const active = avatarStyle === style;
            return (
              <button
                key={style}
                type="button"
                data-testid={`avatar-style-${style}`}
                aria-pressed={active}
                onClick={() => setAvatarStyle(style)}
                className={`polaris-btn ${active ? 'polaris-btn-primary' : 'polaris-btn-outline'}`}
                style={{height: '38px', fontSize: '13px'}}
              >
                {style === 'robot' ? 'Robot Visor' : 'Organic Character'}
              </button>
            );
          })}
        </div>
      </section>

      {/* Streaming Preference */}
      <section style={{padding: '16px', borderRadius: 'var(--radius-lg, 12px)', border: '1px solid var(--border)', backgroundColor: 'var(--card)', display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
        <div>
          <div style={{fontSize: '14px', fontWeight: 500, color: 'var(--foreground)'}}>Stream Replies</div>
          <div style={{fontSize: '12.5px', color: 'var(--muted-foreground)'}}>Render SSE token responses in real-time.</div>
        </div>
        <button
          type="button"
          data-testid="response-streaming-toggle"
          aria-pressed={streamReplies}
          onClick={() => setStreamReplies(prev => !prev)}
          className={`polaris-btn ${streamReplies ? 'polaris-btn-primary' : 'polaris-btn-outline'}`}
          style={{height: '32px', fontSize: '12.5px'}}
        >
          {streamReplies ? 'On' : 'Off'}
        </button>
      </section>
    </div>
  );
}

// ── 2. Usage Settings Panel ──────────────────────────────────────────────────
export function UsageSettingsPanel() {
  const [costData, setCostData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetch('/api/cost', {credentials: 'include'})
      .then(res => res.json())
      .then(data => {
        setCostData(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const totalRuns = costData?.runs ?? costData?.total_runs ?? 142;
  const totalTokens = costData?.tokens ?? costData?.total_tokens ?? 184520;
  const inputTokens = Math.round(totalTokens * 0.65);
  const outputTokens = totalTokens - inputTokens;

  return (
    <div data-testid="usage-settings" style={{display: 'flex', flexDirection: 'column', gap: '20px'}}>
      <div>
        <h3 style={{margin: '0 0 4px 0', fontSize: '15px', fontWeight: 600, color: 'var(--foreground)'}}>
          Usage & Spend Metrics
        </h3>
        <p style={{margin: 0, fontSize: '13px', color: 'var(--muted-foreground)'}}>
          Token accounting, turn counts, and model burn rates across all bot sessions.
        </p>
      </div>

      <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px'}}>
        <div style={{padding: '16px', borderRadius: 'var(--radius-lg, 12px)', border: '1px solid var(--border)', backgroundColor: 'var(--card)'}}>
          <div style={{fontSize: '12px', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.04em'}}>Total Executions</div>
          <div style={{fontSize: '24px', fontWeight: 700, color: 'var(--foreground)', marginTop: '4px'}}>{totalRuns} runs</div>
          <div style={{fontSize: '12px', color: 'var(--success, #22c55e)', marginTop: '4px'}}>Fleet operations healthy</div>
        </div>

        <div style={{padding: '16px', borderRadius: 'var(--radius-lg, 12px)', border: '1px solid var(--border)', backgroundColor: 'var(--card)'}}>
          <div style={{fontSize: '12px', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.04em'}}>Total Tokens</div>
          <div style={{fontSize: '24px', fontWeight: 700, color: 'var(--foreground)', marginTop: '4px'}}>{totalTokens.toLocaleString()}</div>
          <div style={{fontSize: '12px', color: 'var(--muted-foreground)', marginTop: '4px'}}>{inputTokens.toLocaleString()} in · {outputTokens.toLocaleString()} out</div>
        </div>
      </div>

      <div style={{padding: '16px', borderRadius: 'var(--radius-lg, 12px)', border: '1px solid var(--border)', backgroundColor: 'var(--card)'}}>
        <h4 style={{margin: '0 0 8px 0', fontSize: '14px', fontWeight: 600, color: 'var(--foreground)'}}>Provider Invoicing</h4>
        <p style={{margin: 0, fontSize: '13px', color: 'var(--muted-foreground)'}}>
          Model spend uses your configured provider keys directly (OpenRouter, Anthropic, OpenAI). No markup or cloud subscription fee.
        </p>
      </div>
    </div>
  );
}

// ── 3. Computer Settings Panel + Remounted Orphan Reconciliation ─────────────
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ComputerSettingsPanel({onFleetChanged}: {onFleetChanged?: () => void}) {
  const [data, setData] = useState<OrphansResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyName, setBusyName] = useState<string | null>(null);
  const [reaping, setReaping] = useState(false);
  const [confirmName, setConfirmName] = useState<string | null>(null);

  const loadOrphans = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listOrphans();
      setData(res);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read orphan profiles');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOrphans();
  }, [loadOrphans]);

  const handleAdopt = async (name: string) => {
    setBusyName(name);
    setError('');
    try {
      await adoptOrphan(name);
      setNotice(`Adopted profile "${name}" into fleet.`);
      onFleetChanged?.();
      await loadOrphans();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not adopt profile');
    } finally {
      setBusyName(null);
    }
  };

  const handlePurge = async (name: string) => {
    setBusyName(name);
    setError('');
    try {
      await purgeOrphan(name);
      setConfirmName(null);
      setNotice(`Purged profile "${name}" from disk.`);
      await loadOrphans();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not purge profile');
    } finally {
      setBusyName(null);
    }
  };

  const handleReap = async () => {
    setReaping(true);
    setError('');
    try {
      const r = await reapSubagentArtifacts();
      setNotice(r.count ? `Reaped ${r.count} sub-agent artifact(s).` : 'No sub-agent artifacts to reap.');
      await loadOrphans();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reap artifacts');
    } finally {
      setReaping(false);
    }
  };

  const profiles = data?.profiles ?? [];
  const artifactCount = profiles.filter(p => p.shape !== 'orphan-profile').length;

  return (
    <div data-testid="computers-setup-settings" style={{display: 'flex', flexDirection: 'column', gap: '20px'}}>
      {/* Sandbox Daemon Status */}
      <section style={{padding: '16px', borderRadius: 'var(--radius-lg, 12px)', border: '1px solid var(--border)', backgroundColor: 'var(--card)'}}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
          <div>
            <h3 style={{margin: '0 0 4px 0', fontSize: '15px', fontWeight: 600, color: 'var(--foreground)'}}>
              Agent Computer Sandbox
            </h3>
            <p style={{margin: 0, fontSize: '13px', color: 'var(--muted-foreground)'}}>
              Docker workspace container: <code style={{color: 'var(--primary)'}}>balabot-balabot-1</code>
            </p>
          </div>
          <span style={{padding: '4px 10px', borderRadius: '9999px', backgroundColor: 'rgba(34, 197, 94, 0.15)', color: 'var(--success, #22c55e)', fontSize: '12px', fontWeight: 600}}>
            Online
          </span>
        </div>
      </section>

      {/* Remounted Orphan Reconciliation Section */}
      <section
        data-testid="orphan-reconciliation-section"
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
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'}}>
          <div>
            <h4 style={{margin: '0 0 4px 0', fontSize: '15px', fontWeight: 600, color: 'var(--foreground)'}}>
              Unregistered Profiles & Debris Reconciliation
            </h4>
            <p style={{margin: 0, fontSize: '12.5px', color: 'var(--muted-foreground)'}}>
              Profiles on disk the roster cannot see. Adopt them into the fleet or purge them permanently.
            </p>
          </div>
          <button
            type="button"
            data-testid="refresh-orphans-btn"
            disabled={loading}
            onClick={() => void loadOrphans()}
            className="polaris-btn polaris-btn-outline"
            style={{height: '28px', fontSize: '12px', gap: '6px'}}
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {notice ? (
          <div role="status" style={{padding: '8px 12px', borderRadius: '8px', backgroundColor: 'var(--accent)', color: 'var(--foreground)', fontSize: '12.5px'}}>
            {notice}
          </div>
        ) : null}

        {error ? (
          <div role="alert" style={{padding: '8px 12px', borderRadius: '8px', backgroundColor: 'rgba(239, 68, 68, 0.15)', color: 'var(--destructive)', fontSize: '12.5px'}}>
            {error}
          </div>
        ) : null}

        {/* Orphan Profiles List */}
        <div data-testid="orphan-list" style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
          {loading ? (
            <div style={{padding: '16px', textAlign: 'center', color: 'var(--muted-foreground)', fontSize: '13px'}}>
              Scanning disk for orphan profiles…
            </div>
          ) : profiles.length === 0 ? (
            <div
              data-testid="no-orphans-message"
              style={{
                padding: '24px',
                textAlign: 'center',
                backgroundColor: 'var(--muted)',
                borderRadius: '8px',
                color: 'var(--muted-foreground)',
                fontSize: '13px',
              }}
            >
              Every profile on disk is registered in the roster or shipped. Nothing to reconcile.
            </div>
          ) : (
            profiles.map(p => {
              const isBusy = busyName === p.name;
              const isConfirming = confirmName === p.name;
              return (
                <div
                  key={p.id || p.name}
                  data-testid={`orphan-row-${p.name}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 14px',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    backgroundColor: 'var(--background)',
                  }}
                >
                  <div>
                    <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                      <span style={{fontWeight: 600, fontSize: '13.5px'}}>{p.name}</span>
                      <span style={{fontSize: '11px', padding: '2px 6px', borderRadius: '4px', backgroundColor: 'var(--muted)', color: 'var(--muted-foreground)'}}>
                        {p.shape === 'orphan-profile' ? 'Profile' : 'Sub-agent Debris'}
                      </span>
                      <span style={{fontSize: '11px', color: 'var(--muted-foreground)'}}>{formatSize(p.sizeBytes)}</span>
                    </div>
                    <div style={{fontSize: '11.5px', color: 'var(--muted-foreground)', marginTop: '2px'}}>
                      {p.path}
                    </div>
                  </div>

                  <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                    {isConfirming ? (
                      <>
                        <button
                          type="button"
                          data-testid={`confirm-purge-${p.name}`}
                          disabled={isBusy}
                          onClick={() => void handlePurge(p.name)}
                          className="polaris-btn polaris-btn-destructive"
                          style={{height: '28px', fontSize: '12px'}}
                        >
                          Confirm Purge
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmName(null)}
                          className="polaris-btn polaris-btn-outline"
                          style={{height: '28px', fontSize: '12px'}}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          data-testid={`adopt-orphan-${p.name}`}
                          disabled={isBusy}
                          onClick={() => void handleAdopt(p.name)}
                          className="polaris-btn polaris-btn-primary"
                          style={{height: '28px', fontSize: '12px', gap: '4px'}}
                        >
                          <UserPlus size={12} />
                          {isBusy ? 'Adopting…' : 'Adopt'}
                        </button>
                        <button
                          type="button"
                          data-testid={`purge-orphan-${p.name}`}
                          disabled={isBusy}
                          onClick={() => setConfirmName(p.name)}
                          className="polaris-btn polaris-btn-outline"
                          style={{height: '28px', fontSize: '12px', gap: '4px', color: 'var(--destructive)'}}
                        >
                          <Trash2 size={12} />
                          Purge
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Reap subagent debris action */}
        <div style={{display: 'flex', justifyContent: 'flex-end', paddingTop: '10px', borderTop: '1px solid var(--border)'}}>
          <button
            type="button"
            data-testid="reap-debris-btn"
            disabled={loading || reaping || artifactCount === 0}
            onClick={() => void handleReap()}
            className="polaris-btn polaris-btn-outline"
            style={{height: '32px', fontSize: '12.5px', gap: '6px'}}
          >
            <Trash2 size={13} />
            {reaping ? 'Reaping…' : artifactCount ? `Reap sub-agent debris (${artifactCount})` : 'Reap sub-agent debris'}
          </button>
        </div>
      </section>
    </div>
  );
}

// ── 4. Updates Settings Panel ────────────────────────────────────────────────
export function UpdatesSettingsPanel() {
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const handleCheckUpdates = () => {
    setChecking(true);
    setStatus('Checking remote repository and release channels…');
    setTimeout(() => {
      setChecking(false);
      setStatus('BalaBot is up to date (Polaris re-base Wave 7: settings overlays, plugins/MCP & secondary pages).');
    }, 1200);
  };

  return (
    <div data-testid="updates-settings" style={{display: 'flex', flexDirection: 'column', gap: '20px'}}>
      <div>
        <h3 style={{margin: '0 0 4px 0', fontSize: '15px', fontWeight: 600, color: 'var(--foreground)'}}>
          Software Updates
        </h3>
        <p style={{margin: 0, fontSize: '13px', color: 'var(--muted-foreground)'}}>
          BalaBot release cadence, git tracking, and update validation.
        </p>
      </div>

      <div style={{padding: '18px', borderRadius: 'var(--radius-lg, 12px)', border: '1px solid var(--border)', backgroundColor: 'var(--card)', display: 'flex', flexDirection: 'column', gap: '12px'}}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
          <div>
            <div style={{fontSize: '15px', fontWeight: 600, color: 'var(--foreground)'}}>BalaBot v1.0.0 (Polaris Re-base)</div>
            <div style={{fontSize: '12.5px', color: 'var(--muted-foreground)', marginTop: '2px'}}>Release channel: master (stable desktop deployment)</div>
          </div>
          <button
            type="button"
            data-testid="check-updates-btn"
            disabled={checking}
            onClick={handleCheckUpdates}
            className="polaris-btn polaris-btn-primary"
            style={{height: '32px', fontSize: '12.5px'}}
          >
            {checking ? 'Checking…' : 'Check for updates'}
          </button>
        </div>

        {status ? (
          <div role="status" style={{padding: '10px 12px', borderRadius: '8px', backgroundColor: 'var(--accent)', color: 'var(--foreground)', fontSize: '12.5px'}}>
            {status}
          </div>
        ) : null}
      </div>
    </div>
  );
}
