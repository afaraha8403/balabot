import {useCallback, useEffect, useState} from 'react';
import {
  getRoutines,
  createRoutine,
  updateRoutine,
  deleteRoutine,
  bindRoutineHandler,
  type Routine,
} from './api';
import {RoutineSchedule} from './RoutineSchedule';
import {ActivityList} from './ActivityList';

export function RoutineListHeader({onCreate}: {onCreate: () => void}) {
  return (
    <div
      style={{
        marginTop: '24px',
        marginBottom: '12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
      }}
    >
      <div style={{fontSize: '14px', color: 'var(--muted-foreground)', fontWeight: 500}}>
        Routines
      </div>
      <button
        type="button"
        data-testid="routine-create-button"
        aria-label="Create Routine"
        title="Create Routine"
        onClick={onCreate}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '28px',
          height: '28px',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border)',
          backgroundColor: 'var(--secondary, var(--muted))',
          color: 'var(--foreground)',
          cursor: 'pointer',
          transition: 'background-color 150ms ease',
        }}
        onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--accent)')}
        onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'var(--secondary, var(--muted))')}
      >
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </div>
  );
}

export function RoutineListRow({
  routine,
  running,
  onOpen,
  onStop,
}: {
  routine: Routine;
  running?: boolean;
  onOpen: () => void;
  onStop?: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        alignItems: 'center',
        gap: '8px',
        borderRadius: 'var(--radius-md)',
        padding: '8px 10px',
        marginBottom: '4px',
        transition: 'background-color 150ms ease',
        boxSizing: 'border-box',
      }}
      onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--accent)')}
      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
    >
      <button
        type="button"
        onClick={onOpen}
        style={{
          display: 'flex',
          minWidth: 0,
          flex: 1,
          alignItems: 'center',
          gap: '12px',
          textAlign: 'start',
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          color: 'inherit',
          fontFamily: 'inherit',
        }}
      >
        <span
          style={{
            display: 'grid',
            width: '20px',
            height: '20px',
            placeItems: 'center',
            flexShrink: 0,
          }}
        >
          {routine.enabled ? (
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth={2} aria-hidden>
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          ) : (
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--muted-foreground)" strokeWidth={2} aria-hidden>
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          )}
        </span>
        <span style={{minWidth: 0, flex: 1}}>
          <span
            style={{
              display: 'block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: '14px',
              fontWeight: 500,
              color: 'var(--foreground)',
            }}
            dir="auto"
          >
            {routine.title}
          </span>
          <span
            style={{
              display: 'block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: '12.5px',
              color: 'var(--muted-foreground)',
            }}
          >
            {routine.enabled ? routine.schedule : 'Paused'}
          </span>
        </span>
      </button>

      {running && onStop ? (
        <button
          type="button"
          onClick={onStop}
          style={{
            flexShrink: 0,
            borderRadius: '9999px',
            backgroundColor: 'rgba(233, 196, 106, 0.15)',
            color: 'var(--warning)',
            padding: '2px 8px',
            fontSize: '12px',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Running · Stop
        </button>
      ) : null}
    </div>
  );
}

export function RoutineEditor({
  botId,
  botName,
  routine,
  onBack,
  onSaved,
  onDeleted,
  onNotify,
}: {
  botId: string;
  botName: string;
  routine: Routine | null;
  onBack: () => void;
  onSaved: (routine: Routine) => void;
  onDeleted: (routineId: string) => void;
  onNotify: (msg: string) => void;
}) {
  const isEditing = Boolean(routine);
  const [title, setTitle] = useState(routine?.title || '');
  const [schedule, setSchedule] = useState(routine?.schedule || 'Daily at 9:00 AM');
  const [prompt, setPrompt] = useState(routine?.prompt || '');
  const [enabled, setEnabled] = useState(routine?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'edit' | 'schedule' | 'activity'>('edit');

  const handleSave = async () => {
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (isEditing && routine) {
        const res = await updateRoutine(botId, routine.id, {
          title: title.trim(),
          schedule: schedule.trim(),
          prompt: prompt.trim(),
          enabled,
        });
        if (res.ok) {
          if (prompt.trim()) await bindRoutineHandler(botId, res.routine.id);
          onSaved(res.routine);
          onNotify(`Routine "${res.routine.title}" updated.`);
          onBack();
        }
      } else {
        const res = await createRoutine(botId, {
          title: title.trim(),
          schedule: schedule.trim(),
          prompt: prompt.trim(),
          enabled,
        });
        if (res.ok) {
          if (prompt.trim()) await bindRoutineHandler(botId, res.routine.id);
          onSaved(res.routine);
          onNotify(`Routine "${res.routine.title}" created for ${botName}.`);
          onBack();
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!routine) return;
    setBusy(true);
    setError(null);
    try {
      await deleteRoutine(botId, routine.id);
      onDeleted(routine.id);
      onNotify(`Routine "${routine.title}" deleted.`);
      onBack();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
      {/* Header with Back button */}
      <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to routines"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '28px',
            height: '28px',
            borderRadius: 'var(--radius-sm)',
            border: 'none',
            backgroundColor: 'transparent',
            color: 'var(--muted-foreground)',
            cursor: 'pointer',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.backgroundColor = 'var(--accent)';
            e.currentTarget.style.color = 'var(--foreground)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.color = 'var(--muted-foreground)';
          }}
        >
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div style={{fontSize: '15px', fontWeight: 600, color: 'var(--foreground)'}}>
          {isEditing ? 'Edit Routine' : 'Create Routine'}
        </div>
      </div>

      {/* Tabs (only show for editing existing routines) */}
      {isEditing && routine ? (
        <div style={{display: 'flex', gap: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '2px'}}>
          <button
            type="button"
            onClick={() => setActiveTab('edit')}
            style={{
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              backgroundColor: activeTab === 'edit' ? 'var(--accent)' : 'transparent',
              color: activeTab === 'edit' ? 'var(--foreground)' : 'var(--muted-foreground)',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('schedule')}
            style={{
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              backgroundColor: activeTab === 'schedule' ? 'var(--accent)' : 'transparent',
              color: activeTab === 'schedule' ? 'var(--foreground)' : 'var(--muted-foreground)',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Schedule
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('activity')}
            style={{
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              backgroundColor: activeTab === 'activity' ? 'var(--accent)' : 'transparent',
              color: activeTab === 'activity' ? 'var(--foreground)' : 'var(--muted-foreground)',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Activity
          </button>
        </div>
      ) : null}

      {/* Schedule tab content */}
      {isEditing && routine && activeTab === 'schedule' ? (
        <RoutineSchedule routine={routine} />
      ) : null}

      {/* Activity tab content */}
      {isEditing && routine && activeTab === 'activity' ? (
        <ActivityList botId={botId} />
      ) : null}

      {/* Edit tab content */}
      {activeTab === 'edit' ? (
        <>
          {error ? (
            <div style={{padding: '8px 12px', borderRadius: 'var(--radius-md)', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--destructive)', fontSize: '13px'}}>
              {error}
            </div>
          ) : null}

          <div>
        <label htmlFor="routine-title" style={{display: 'block', fontSize: '13px', color: 'var(--muted-foreground)', marginBottom: '4px'}}>
          Name
        </label>
        <input
          id="routine-title"
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="e.g. Export CRM customer list and verify CSV header"
          style={{
            width: '100%',
            padding: '8px 12px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)',
            backgroundColor: 'var(--input, var(--muted))',
            color: 'var(--foreground)',
            fontSize: '13.5px',
            boxSizing: 'border-box',
            outline: 'none',
          }}
        />
      </div>

      <div>
        <label htmlFor="routine-schedule" style={{display: 'block', fontSize: '13px', color: 'var(--muted-foreground)', marginBottom: '4px'}}>
          Schedule
        </label>
        <input
          id="routine-schedule"
          type="text"
          value={schedule}
          onChange={e => setSchedule(e.target.value)}
          placeholder="e.g. Every weekday at 8:00 AM"
          style={{
            width: '100%',
            padding: '8px 12px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)',
            backgroundColor: 'var(--input, var(--muted))',
            color: 'var(--foreground)',
            fontSize: '13.5px',
            boxSizing: 'border-box',
            outline: 'none',
          }}
        />
      </div>

      <div>
        <label htmlFor="routine-prompt" style={{display: 'block', fontSize: '13px', color: 'var(--muted-foreground)', marginBottom: '4px'}}>
          Instructions / Prompt
        </label>
        <textarea
          id="routine-prompt"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          rows={4}
          placeholder="Action instructions for the bot..."
          style={{
            width: '100%',
            padding: '8px 12px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)',
            backgroundColor: 'var(--input, var(--muted))',
            color: 'var(--foreground)',
            fontSize: '13.5px',
            boxSizing: 'border-box',
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />
      </div>

      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0'}}>
        <span style={{fontSize: '13.5px', color: 'var(--foreground)'}}>Active routine</span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={e => setEnabled(e.target.checked)}
          style={{width: '18px', height: '18px', cursor: 'pointer', accentColor: 'var(--primary)'}}
        />
      </div>

      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px'}}>
        {isEditing ? (
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={busy}
            style={{
              padding: '6px 12px',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              backgroundColor: 'transparent',
              color: 'var(--destructive)',
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            Delete
          </button>
        ) : <div />}

        <div style={{display: 'flex', gap: '8px'}}>
          <button
            type="button"
            onClick={onBack}
            disabled={busy}
            style={{
              padding: '6px 14px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border)',
              backgroundColor: 'transparent',
              color: 'var(--foreground)',
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={busy || !title.trim()}
            style={{
              padding: '6px 16px',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              backgroundColor: 'var(--primary)',
              color: 'var(--primary-foreground)',
              fontSize: '13px',
              fontWeight: 500,
              cursor: busy || !title.trim() ? 'not-allowed' : 'pointer',
              opacity: busy || !title.trim() ? 0.6 : 1,
            }}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
        </>
      ) : null}
    </div>
  );
}

type Props = {
  botId: string;
  botName: string;
  onNotify: (msg: string) => void;
  onOpenRoutine?: (routine: Routine) => void;
  onCreateRoutine?: () => void;
};

export function RoutinesList({
  botId,
  botName: _botName,
  onNotify: _onNotify,
  onOpenRoutine,
  onCreateRoutine,
}: Props) {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await getRoutines(botId);
      if (res.ok) setRoutines(res.routines || []);
    } catch {
      /* transient */
    } finally {
      setIsLoading(false);
    }
  }, [botId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <RoutineListHeader onCreate={() => onCreateRoutine?.()} />
      {routines.map(routine => (
        <RoutineListRow
          key={routine.id}
          routine={routine}
          onOpen={() => onOpenRoutine?.(routine)}
        />
      ))}
      {!isLoading && routines.length === 0 ? (
        <div style={{padding: '12px 4px', fontSize: '13px', color: 'var(--muted-foreground)'}}>
          No routines created yet.
        </div>
      ) : null}
    </div>
  );
}
