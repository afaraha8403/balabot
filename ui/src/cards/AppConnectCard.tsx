import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';

export type AppConnectBlock = {
  kind: 'app_connect';
  connectorId: string;
  provider: string;
  name: string;
  description?: string;
  logo?: string;
  status: 'pending' | 'connected';
};

/**
 * Polaris AppConnectCard for OAuth connector authorization cards.
 */
export function AppConnectCard({
  block,
  onConnect,
}: {
  block: AppConnectBlock;
  onConnect?: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [localStatus, setLocalStatus] = useState<'pending' | 'connected'>(block.status);
  const [error, setError] = useState<string | null>(null);

  const status = block.status === 'connected' ? 'connected' : localStatus;

  async function authorize() {
    setBusy(true);
    setError(null);
    try {
      if (onConnect) {
        await onConnect();
      }
      setLocalStatus('connected');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not authorize this app');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="group"
      data-testid="app-connect-card"
      aria-label={`${block.name} connection`}
      className="w-[min(420px,80%)] rounded-2xl border border-border bg-card px-4 py-3.5 text-foreground shadow-sm"
    >
      <div className="flex items-center gap-3.5">
        {block.logo ? (
          <img
            src={block.logo}
            alt=""
            className="h-10 w-10 rounded-[10px] bg-white object-contain p-1 border border-border"
          />
        ) : (
          <span className="grid h-10 w-10 place-items-center rounded-[10px] bg-muted text-[15px] font-semibold text-foreground">
            {block.name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium text-foreground">{block.name}</span>
          {block.description ? (
            <span className="block truncate text-[13px] text-muted-foreground">
              {block.description}
            </span>
          ) : null}
        </span>
        {status === 'connected' ? (
          <div className="flex items-center gap-1.5 text-[13.5px] font-medium text-green-500">
            <CheckCircle2 size={16} />
            <span>Connected</span>
          </div>
        ) : (
          <button
            type="button"
            className="polaris-btn polaris-btn-primary rounded-full px-4 py-1.5 text-xs"
            disabled={busy}
            onClick={() => void authorize()}
          >
            {busy ? 'Waiting…' : 'Authorize'}
          </button>
        )}
      </div>
      {error ? <p className="mt-2 text-xs text-red-500">{error}</p> : null}
    </div>
  );
}
