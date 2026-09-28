import {useCallback, useEffect, useRef, useState} from 'react';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {VStack} from '@astryxdesign/core/VStack';
import {HStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {Button} from '@astryxdesign/core/Button';
import {Icon} from '@astryxdesign/core/Icon';
import {Banner} from '@astryxdesign/core/Banner';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Timestamp} from '@astryxdesign/core/Timestamp';
import {Token} from '@astryxdesign/core/Token';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Spinner} from '@astryxdesign/core/Spinner';
import {IconWarning} from './icons';
import {
  getComputerFrame,
  sendComputerAction,
  resetComputer,
  createRoutine,
  type Bot,
  type ComputerFrame,
} from './api';

const POLL_MS = 1500;

type Props = {
  bot: Bot;
  onClose: () => void;
};

/**
 * Live screen of the bot's agent computer. Polls the frame endpoint while the
 * dialog is open; clicking the image sends a take-over click with coordinates
 * scaled from the displayed size to the reported screen size.
 */
export function AgentComputerDialog({bot, onClose}: Props) {
  const [frame, setFrame] = useState<ComputerFrame | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [textValue, setTextValue] = useState('');
  const [keyValue, setKeyValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState('');
  const [showTeachTask, setShowTeachTask] = useState(false);
  const [teachTitle, setTeachTitle] = useState('');
  const [teachSchedule, setTeachSchedule] = useState('Daily');
  const [teachSteps, setTeachSteps] = useState('');
  const [recordedSteps, setRecordedSteps] = useState<string[]>([]);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const noDriver = frame?.state === 'no-driver';
  const isError = frame?.state === 'error';
  const inputsEnabled = frame?.state === 'ready' && !busy && !isResetting;

  // Poll the frame endpoint only while open; clear on close.
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const f = await getComputerFrame(bot.id);
        if (alive) {
          setFrame(f);
          setError('');
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) {
          setIsLoading(false);
          timer = window.setTimeout(tick, POLL_MS);
        }
      }
    };
    void tick();
    return () => {
      alive = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [bot.id]);

  const act = useCallback(
    async (action: Parameters<typeof sendComputerAction>[1]) => {
      if (!inputsEnabled) return;
      setBusy(true);
      try {
        await sendComputerAction(bot.id, action);
        // Grab a fresh frame immediately so the result is visible right away.
        const f = await getComputerFrame(bot.id);
        setFrame(f);
        if (showTeachTask) {
          let stepDesc = '';
          if (action.action === 'click') {
            stepDesc = `Click at (${action.x}, ${action.y})`;
          } else if (action.action === 'type') {
            stepDesc = `Type "${action.text}"`;
          } else if (action.action === 'key') {
            stepDesc = `Press key "${action.key}"`;
          } else if (action.action === 'scroll') {
            stepDesc = `Scroll ${action.amount && action.amount > 0 ? 'down' : 'up'} (${Math.abs(action.amount || 0)} units)`;
          }
          if (stepDesc) {
            setRecordedSteps(prev => {
              const next = [...prev, stepDesc];
              setTeachSteps(next.map((s, idx) => `${idx + 1}. ${s}`).join('\n'));
              return next;
            });
          }
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [bot.id, inputsEnabled, showTeachTask],
  );

  const handleResetComputer = async () => {
    setIsResetting(true);
    setResetMessage('');
    try {
      const res = await resetComputer(bot.id);
      if (res.ok) {
        setResetMessage(res.message || 'Computer display session reset successfully.');
        const fresh = await getComputerFrame(bot.id);
        setFrame(fresh);
      } else {
        setError(res.message || 'Failed to reset computer session.');
      }
    } catch (err) {
      setError(`Reset failed: ${(err as Error).message}`);
    } finally {
      setIsResetting(false);
    }
  };

  const handleSaveTeachTask = async () => {
    if (!teachTitle.trim()) return;
    try {
      await createRoutine(bot.id, {
        title: teachTitle.trim(),
        schedule: teachSchedule.trim(),
        prompt: teachSteps.trim() || `Demonstrated workflow for ${teachTitle.trim()}`,
        enabled: true,
      });
      setResetMessage(`Taught task saved as routine "${teachTitle.trim()}" for ${bot.name}.`);
      setShowTeachTask(false);
      setTeachTitle('');
      setTeachSteps('');
      setRecordedSteps([]);
    } catch (err) {
      setError(`Failed to save task: ${(err as Error).message}`);
    }
  };

  const onImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    const img = imgRef.current;
    if (!img || !frame?.width || !frame.height) return;
    const rect = img.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * frame.width);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * frame.height);
    void act({action: 'click', x, y});
  };

  return (
    <Dialog
      isOpen
      onOpenChange={open => !open && onClose()}
      purpose="form"
      variant="fullscreen">
      <DialogHeader
        title={`${bot.name} — Agent computer`}
        subtitle={
          frame
            ? `Captured ${frame.capturedAt} · ${frame.width}×${frame.height} · ${noDriver ? 'no driver' : isError ? 'error' : 'live'}`
            : 'Connecting…'
        }
        onOpenChange={onClose}
      />
      <VStack gap={3} padding={4} height="fill">
        {/* GrokBot Computer Actions Bar: Reset Controls & Teach a Task */}
        <HStack gap={2} vAlign="center" justify="between" wrap="wrap">
          <HStack gap={2} vAlign="center">
            <Button
              label={isResetting ? "Resetting…" : "Reset Computer"}
              variant="secondary"
              size="sm"
              isLoading={isResetting}
              onClick={() => void handleResetComputer()}
            />
            <Button
              label="Refresh frame"
              variant="ghost"
              size="sm"
              onClick={async () => {
                const f = await getComputerFrame(bot.id);
                setFrame(f);
              }}
            />
          </HStack>
          <Button
            label="Teach a task"
            variant="primary"
            size="sm"
            aria-label="Teach a task"
            onClick={() => setShowTeachTask(prev => !prev)}
          />
        </HStack>

        {showTeachTask ? (
          <Banner
            status="info"
            title={`Teach a task to ${bot.name} (Demonstration Recording)`}
            description={
              recordedSteps.length > 0
                ? `Recording take-over actions: ${recordedSteps.length} action(s) captured live in this session. (Container-side capture daemon cua-driver record is not running; recording explicit user take-over clicks, keystrokes, and scrolls).`
                : "Live action recorder: Take over and interact with the screen below — clicks, typing, keys, and scrolls are captured in sequence. (Container-side daemon cua-driver record is not running; recording explicit user take-over inputs)."
            }
            collapsible={false}
          >
            <VStack gap={2} paddingBlock={2}>
              <TextInput
                label="Task / Routine Name"
                placeholder="e.g. Export weekly analytics report"
                value={teachTitle}
                onChange={setTeachTitle}
                size="sm"
              />
              <TextInput
                label="Schedule / Cadence"
                placeholder="e.g. Weekly on Mondays at 9am"
                value={teachSchedule}
                onChange={setTeachSchedule}
                size="sm"
              />
              <TextInput
                label={
                  recordedSteps.length > 0
                    ? `Demonstrated Steps (${recordedSteps.length} actions captured)`
                    : 'Demonstrated Steps / Actions'
                }
                placeholder="Click screen or type below to record actions, or type steps manually"
                value={teachSteps}
                onChange={setTeachSteps}
                size="sm"
              />
              <HStack gap={2}>
                <Button
                  label="Save as Routine"
                  variant="primary"
                  size="sm"
                  isDisabled={!teachTitle.trim()}
                  onClick={() => void handleSaveTeachTask()}
                />
                {recordedSteps.length > 0 ? (
                  <Button
                    label="Clear recorded steps"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setRecordedSteps([]);
                      setTeachSteps('');
                    }}
                  />
                ) : null}
                <Button
                  label="Cancel"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowTeachTask(false);
                    setRecordedSteps([]);
                  }}
                />
              </HStack>
            </VStack>
          </Banner>
        ) : null}

        {resetMessage ? (
          <Banner
            status="success"
            title="Computer Reset"
            description={resetMessage}
            collapsible={false}
          />
        ) : null}

        {noDriver ? (
          <Banner
            status="warning"
            title="Agent computer driver is not installed"
            description={
              frame?.note ??
              'Install the driver on the bot host to see its live screen and take over.'
            }
            collapsible={false}
          />
        ) : null}
        {isError && frame?.note ? (
          <Banner status="error" title="Screen capture error" description={frame.note} />
        ) : null}
        {error ? (
          <Banner status="error" title="Could not reach the screen endpoint" description={error} />
        ) : null}

        {isLoading && !frame ? (
          <VStack gap={3} align="center" height="fill">
            <Spinner size="lg" label="Loading screen" />
          </VStack>
        ) : !frame ? (
          <EmptyState
            title="No screen yet"
            description="The frame endpoint has not returned a usable screen."
          />
        ) : frame.b64 ? (
          // Take-over surface: click coordinates scale to the reported screen size.
          // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
          <img
            ref={imgRef}
            src={`data:image/png;base64,${frame.b64}`}
            alt={`${bot.name} live screen`}
            onClick={onImageClick}
            style={{
              width: '100%',
              height: 'auto',
              cursor: inputsEnabled ? 'crosshair' : 'default',
              borderRadius: 'var(--radius-md)',
            }}
          />
        ) : (
          <EmptyState
            isCompact
            title="Screen unavailable"
            description={frame.note ?? 'No frame data returned.'}
            icon={<IconWarning />}
          />
        )}

        <HStack gap={2} vAlign="end" wrap="wrap">
          <TextInput
            label="Type text"
            value={textValue}
            onChange={setTextValue}
            placeholder="Text to type on the agent computer"
            size="sm"
            isDisabled={!inputsEnabled}
          />
          <Button
            label="Send text"
            variant="primary"
            size="sm"
            isDisabled={!inputsEnabled || !textValue.trim()}
            isLoading={busy}
            onClick={() => {
              void act({action: 'type', text: textValue});
              setTextValue('');
            }}
          />
          <TextInput
            label="Key"
            value={keyValue}
            onChange={setKeyValue}
            placeholder="e.g. Enter"
            size="sm"
            isDisabled={!inputsEnabled}
          />
          <Button
            label="Press key"
            size="sm"
            isDisabled={!inputsEnabled || !keyValue.trim()}
            isLoading={busy}
            onClick={() => {
              void act({action: 'key', key: keyValue});
              setKeyValue('');
            }}
          />
          <Button
            label="Scroll down"
            size="sm"
            isDisabled={!inputsEnabled}
            isLoading={busy}
            onClick={() => void act({action: 'scroll', amount: 3})}
          />
          <Button
            label="Scroll up"
            size="sm"
            isDisabled={!inputsEnabled}
            isLoading={busy}
            onClick={() => void act({action: 'scroll', amount: -3})}
          />
        </HStack>
      </VStack>
    </Dialog>
  );
}
