import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';

export type McpApprovalBlock = {
  kind: 'mcp_approval';
  serverId: string;
  name: string;
  transport: string;
  endpoint?: string;
  needsOAuth?: boolean;
  status?: 'pending' | 'connecting' | 'connected' | 'dismissed';
};

/**
 * Polaris McpApprovalCard for approving or authorizing MCP servers in-transcript.
 */
export function McpApprovalCard({
  block,
  onApprove,
  onDismiss,
}: {
  block: McpApprovalBlock;
  onApprove?: () => Promise<void> | void;
  onDismiss?: () => Promise<void> | void;
}) {
  const { name, transport, endpoint, needsOAuth, status: savedStatus } = block;
  const [localStatus, setLocalStatus] = useState<'pending' | 'connecting' | 'connected' | 'dismissed'>('pending');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const state = savedStatus === 'connected' || savedStatus === 'dismissed' ? savedStatus : localStatus;

  async function authorize() {
    if (busy) return;
    setBusy(true);
    setLocalStatus('connecting');
    setError(null);
    try {
      if (onApprove) {
        await onApprove();
      }
      setLocalStatus('connected');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not approve this server');
      setLocalStatus('pending');
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (onDismiss) {
        await onDismiss();
      }
      setLocalStatus('dismissed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not dismiss this server');
    } finally {
      setBusy(false);
    }
  }

  const summary = endpoint ?? `stdio · ${transport}`;

  return (
    <div
      data-testid="mcp-approval-card"
      className="max-w-[74%] rounded-2xl border border-border bg-card p-4 text-foreground shadow-sm"
    >
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-muted text-xs font-semibold text-foreground">
          M
        </span>
        <span className="text-[14.5px] font-medium text-foreground">
          Connect MCP server “{name}”
        </span>
      </div>
      <p className="mt-1.5 truncate text-[12px] text-muted-foreground">{summary}</p>
      {state === 'pending' || state === 'connecting' ? (
        <>
          <p className="mt-2 text-[13px] leading-[1.5] text-muted-foreground">
            {needsOAuth
              ? 'Authorize this server so agents can use its tools. A popup opens.'
              : 'Approve this server to let your agent use its tools.'}
          </p>
          {error ? <p className="mt-2 text-xs text-red-500">{error}</p> : null}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="polaris-btn polaris-btn-primary rounded-full px-4 py-1.5 text-xs"
              disabled={state !== 'pending' || busy}
              onClick={() => void authorize()}
            >
              {state === 'connecting' ? 'Connecting…' : needsOAuth ? 'Authorize' : 'Approve'}
            </button>
            <button
              type="button"
              className="polaris-btn polaris-btn-outline rounded-full px-4 py-1.5 text-xs"
              disabled={state !== 'pending' || busy}
              onClick={() => void dismiss()}
            >
              Not now
            </button>
          </div>
        </>
      ) : null}
      {state === 'connected' ? (
        <div className="mt-3 flex items-center gap-1.5 text-[13px] font-medium text-green-500">
          <CheckCircle2 size={16} />
          <span>Connected. Its tools are available from your next message.</span>
        </div>
      ) : null}
      {state === 'dismissed' ? (
        <p className="mt-2 text-[13px] text-muted-foreground">
          Dismissed. Reconnect anytime from MCP settings.
        </p>
      ) : null}
    </div>
  );
}
