import {useCallback, useEffect, useState} from 'react';
import {Card} from '@astryxdesign/core/Card';
import {HStack} from '@astryxdesign/core/Stack';
import {VStack} from '@astryxdesign/core/VStack';
import {Text} from '@astryxdesign/core/Text';
import {Button} from '@astryxdesign/core/Button';
import {Switch} from '@astryxdesign/core/Switch';
import {TextInput} from '@astryxdesign/core/TextInput';
import {
  getRoutines,
  createRoutine,
  updateRoutine,
  deleteRoutine,
  type Routine,
} from './api';

type Props = {
  botId: string;
  botName: string;
  onNotify: (msg: string) => void;
};

export function RoutinesList({botId, botName, onNotify}: Props) {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newSchedule, setNewSchedule] = useState('Daily at 9:00 AM');
  const [newPrompt, setNewPrompt] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

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

  const handleToggle = async (routine: Routine, enabled: boolean) => {
    setBusyId(routine.id);
    try {
      const res = await updateRoutine(botId, routine.id, {enabled});
      if (res.ok) {
        setRoutines(prev => prev.map(r => (r.id === routine.id ? res.routine : r)));
        onNotify(`Routine "${routine.title}" ${enabled ? 'enabled' : 'paused'}.`);
      }
    } catch (err) {
      onNotify(`Could not update routine: ${(err as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    try {
      const res = await createRoutine(botId, {
        title: newTitle.trim(),
        schedule: newSchedule.trim(),
        prompt: newPrompt.trim(),
        enabled: true,
      });
      if (res.ok) {
        setRoutines(prev => [...prev, res.routine]);
        setShowAddForm(false);
        setNewTitle('');
        setNewPrompt('');
        onNotify(`Routine "${res.routine.title}" created for ${botName}.`);
      }
    } catch (err) {
      onNotify(`Could not create routine: ${(err as Error).message}`);
    }
  };

  const handleDelete = async (routineId: string) => {
    try {
      await deleteRoutine(botId, routineId);
      setRoutines(prev => prev.filter(r => r.id !== routineId));
      onNotify('Routine deleted.');
    } catch (err) {
      onNotify(`Could not delete routine: ${(err as Error).message}`);
    }
  };

  return (
    <VStack gap={2}>
      <HStack gap={2} vAlign="center" justify="between">
        <Text type="body" weight="semibold">
          Routines
        </Text>
        <Button
          label="+"
          size="sm"
          variant="ghost"
          aria-label="Add routine"
          onClick={() => setShowAddForm(prev => !prev)}
        />
      </HStack>

      {showAddForm ? (
        <Card variant="muted" padding={2}>
          <VStack gap={2}>
            <Text type="body" weight="medium" size="sm">
              New Routine for {botName}
            </Text>
            <TextInput
              label="Title"
              placeholder="e.g. Friday grocery check-in"
              value={newTitle}
              onChange={setNewTitle}
              size="sm"
            />
            <TextInput
              label="Schedule"
              placeholder="e.g. Every Friday at 4:00 PM"
              value={newSchedule}
              onChange={setNewSchedule}
              size="sm"
            />
            <TextInput
              label="Instructions / Prompt"
              placeholder="Task the bot should run..."
              value={newPrompt}
              onChange={setNewPrompt}
              size="sm"
            />
            <HStack gap={1} justify="end">
              <Button
                label="Save routine"
                variant="primary"
                size="sm"
                isDisabled={!newTitle.trim()}
                onClick={() => void handleCreate()}
              />
              <Button
                label="Cancel"
                variant="ghost"
                size="sm"
                onClick={() => setShowAddForm(false)}
              />
            </HStack>
          </VStack>
        </Card>
      ) : null}

      {routines.length === 0 && !isLoading && !showAddForm ? (
        <Card variant="default" padding={2}>
          <Text type="supporting" size="xsm" color="secondary">
            No scheduled routines. Click + to add an automated workflow.
          </Text>
        </Card>
      ) : null}

      {routines.map(r => (
        <Card key={r.id} variant="default" padding={2}>
          <VStack gap={1}>
            <HStack gap={2} vAlign="center" justify="between">
              <Text type="body" weight="medium" size="sm">
                {r.title}
              </Text>
              <Switch
                label={`Toggle ${r.title}`}
                isLabelHidden
                value={r.enabled}
                isDisabled={busyId === r.id}
                onChange={checked => void handleToggle(r, checked)}
              />
            </HStack>
            <Text type="supporting" size="xsm" color="secondary">
              {r.schedule}
            </Text>
            <HStack gap={2} vAlign="center" justify="between">
              <Text type="supporting" size="xsm" color="secondary">
                {r.lastRun}
              </Text>
              <Button
                label="Delete"
                variant="ghost"
                size="sm"
                onClick={() => void handleDelete(r.id)}
              />
            </HStack>
          </VStack>
        </Card>
      ))}
    </VStack>
  );
}
