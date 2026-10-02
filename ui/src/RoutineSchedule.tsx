import type {Routine} from './api';

type RoutineScheduleProps = {
  routine: Routine;
};

/**
 * Display the schedule configuration for a routine. Renders only the fields
 * the backend actually stores: enabled state, schedule string, and last-run
 * timestamp.
 */
export function RoutineSchedule({routine}: RoutineScheduleProps) {
  return (
    <div
      style={{
        marginTop: 'var(--spacing-2)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)',
        padding: 'var(--spacing-3)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--spacing-2-5)',
          paddingLeft: 'var(--spacing-0-5)',
        }}
      >
        <svg
          width={17}
          height={17}
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--muted-foreground)"
          strokeWidth={1.6}
          style={{flexShrink: 0}}
          aria-hidden
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <span style={{fontSize: '14.5px', color: 'var(--foreground)'}}>
          {routine.enabled ? routine.schedule : 'Paused'}
        </span>
        {routine.lastRun ? (
          <span
            style={{
              flex: 1,
              fontSize: '14.5px',
              color: 'var(--muted-foreground)',
            }}
          >
            {routine.lastRun}
          </span>
        ) : null}
      </div>
      <div
        style={{
          marginTop: 'var(--spacing-2-5)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--spacing-2)',
          fontSize: '14px',
          color: 'var(--muted-foreground)',
        }}
      >
        <span>Status:</span>
        <span style={{color: routine.enabled ? 'var(--success)' : 'var(--muted-foreground)'}}>
          {routine.enabled ? 'Active' : 'Paused'}
        </span>
      </div>
    </div>
  );
}
