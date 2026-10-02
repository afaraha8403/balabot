import {useEffect, useState} from 'react';
import {getRoutineRuns, type RoutineRun} from './api';

function statusTone(status: RoutineRun['status']): string {
  if (status === 'failed') return 'var(--destructive)';
  if (status === 'completed') return 'var(--success)';
  return 'var(--foreground)';
}

function statusLabel(status: RoutineRun['status']): string {
  switch (status) {
    case 'running':
      return 'Running';
    case 'completed':
      return 'Done';
    case 'failed':
      return 'Failed';
    default:
      return status;
  }
}

function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.floor((now - timestamp * 1000) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString('en', {month: 'short', day: 'numeric'});
}

type ActivityListProps = {
  botId: string;
  onOpenRun?: (run: RoutineRun) => void;
};

/**
 * Display routine execution history. Renders only the persisted run data from
 * the backend: run status, timestamps, and results/errors.
 */
export function ActivityList({botId, onOpenRun}: ActivityListProps) {
  const [activeRuns, setActiveRuns] = useState<RoutineRun[]>([]);
  const [recentRuns, setRecentRuns] = useState<RoutineRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const tick = async () => {
      try {
        const res = await getRoutineRuns(botId);
        if (cancelled) return;
        const runs = res.runs || [];
        const active = runs.filter(r => r.status === 'running');
        const recent = runs
          .filter(r => r.status !== 'running')
          .sort((a, b) => (b.finishedAt || b.startedAt) - (a.finishedAt || a.startedAt))
          .slice(0, 10);
        setActiveRuns(active);
        setRecentRuns(recent);
      } catch {
        // Keep last good snapshot on transient failures.
        if (cancelled) return;
      } finally {
        if (!cancelled) {
          setLoading(false);
          // Poll every 15s for updates.
          timer = window.setTimeout(() => void tick(), 15_000);
        }
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [botId]);

  if (loading) {
    return (
      <div
        style={{
          padding: 'var(--spacing-2-5) var(--spacing-2)',
          fontSize: '13px',
          color: 'var(--muted-foreground)',
        }}
      >
        Loading activity…
      </div>
    );
  }

  if (activeRuns.length === 0 && recentRuns.length === 0) {
    return (
      <div
        style={{
          padding: 'var(--spacing-2-5) var(--spacing-2)',
          fontSize: '13px',
          color: 'var(--muted-foreground)',
        }}
      >
        No activity yet.
      </div>
    );
  }

  return (
    <div
      style={{
        marginBottom: 'var(--spacing-2)',
        borderBottom: '1px solid var(--border)',
        paddingBottom: 'var(--spacing-2)',
      }}
    >
      {activeRuns.length > 0 ? (
        <section>
          <div
            style={{
              padding: 'var(--spacing-2-5) var(--spacing-2-5) var(--spacing-1)',
              fontSize: '12.5px',
              fontWeight: 500,
              color: 'var(--muted-foreground)',
            }}
          >
            Now
          </div>
          {activeRuns.map(run => (
            <ActivityRow key={run.id} run={run} onOpen={() => onOpenRun?.(run)} />
          ))}
        </section>
      ) : null}
      {recentRuns.length > 0 ? (
        <section style={activeRuns.length > 0 ? {marginTop: 'var(--spacing-2)'} : undefined}>
          <div
            style={{
              padding: 'var(--spacing-2-5) var(--spacing-2-5) var(--spacing-1)',
              fontSize: '12.5px',
              fontWeight: 500,
              color: 'var(--muted-foreground)',
            }}
          >
            Recent
          </div>
          {recentRuns.map(run => (
            <ActivityRow key={run.id} run={run} onOpen={() => onOpenRun?.(run)} />
          ))}
        </section>
      ) : null}
    </div>
  );
}

function ActivityRow({run, onOpen}: {run: RoutineRun; onOpen: () => void}) {
  const label = statusLabel(run.status);
  const tone = statusTone(run.status);
  const timestamp = run.finishedAt || run.startedAt;
  const title = `Routine ${run.routineId}`;
  const activityLabel = `${title}, ${label}`;
  return (
    <button
      type="button"
      aria-label={activityLabel}
      onClick={onOpen}
      style={{
        display: 'flex',
        width: '100%',
        gap: 'var(--spacing-3)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--spacing-2-5)',
        textAlign: 'start',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: 'inherit',
        fontFamily: 'inherit',
        transition: 'background-color 150ms ease',
      }}
      onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--accent)')}
      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
    >
      <span
        style={{
          marginTop: 'var(--spacing-1-5)',
          width: 'var(--spacing-2)',
          height: 'var(--spacing-2)',
          flexShrink: 0,
          borderRadius: '9999px',
          backgroundColor: tone,
        }}
        aria-hidden="true"
      />
      <div style={{minWidth: 0, flex: 1}}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 'var(--spacing-2)',
          }}
        >
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: '14px',
              fontWeight: 500,
              color: 'var(--foreground)',
            }}
          >
            {title}
          </span>
          <span
            style={{
              flexShrink: 0,
              fontSize: '12px',
              color: 'var(--muted-foreground)',
            }}
          >
            {formatRelativeTime(timestamp)}
          </span>
        </div>
        <div
          style={{
            marginTop: 'var(--spacing-0-5)',
            display: 'flex',
            alignItems: 'baseline',
            gap: 'var(--spacing-2)',
          }}
        >
          {run.error ? (
            <span
              style={{
                minWidth: 0,
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: '13px',
                color: 'var(--muted-foreground)',
              }}
            >
              {run.error}
            </span>
          ) : null}
          <span
            style={{
              marginLeft: 'auto',
              flexShrink: 0,
              fontSize: '12px',
              color: tone,
            }}
          >
            {label}
          </span>
        </div>
      </div>
    </button>
  );
}
