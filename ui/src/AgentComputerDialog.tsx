import {useCallback, useEffect, useRef, useState} from 'react';
import {VStack} from '@astryxdesign/core/VStack';
import {HStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {Button} from '@astryxdesign/core/Button';
import {Banner} from '@astryxdesign/core/Banner';
import {TextInput} from '@astryxdesign/core/TextInput';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Spinner} from '@astryxdesign/core/Spinner';
import {IconWarning} from './icons';
import {BotAvatar} from './BotAvatar';
import {ComputerMaintenanceActions} from './ComputerMaintenanceActions';
import {TeachComputerOverlayControl} from './TeachComputerOverlayControl';
import {TeachRecordingChrome} from './TeachRecordingChrome';
import {ComputerWorkspace} from './ComputerWorkspace';
import {TerminalApp} from './TerminalApp';
import {FilesApp} from './FilesApp';
import {mapTeachPointer} from './coordinate-scaling';
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

type WorkspaceApp = 'screen' | 'terminal' | 'files';

/**
 * AgentComputerDialog: Live agent computer view with Polaris parity.
 * Includes:
 * - Frame polling with coordinate-mapped interactive take-over.
 * - Polaris TeachRecordingChrome and TeachComputerOverlay contract.
 * - ComputerWorkspace dock for Screen, Terminal, and Files.
 * - Reset Computer recovery controls.
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

  // Workspace active app dock (Screen / Terminal / Files)
  const [activeApp, setActiveApp] = useState<WorkspaceApp>('screen');
  const [terminalHistory, setTerminalHistory] = useState<string[]>([
    `[hermes@balabot-agent ~]$ # connected to ${bot.name} workspace`,
    `[hermes@balabot-agent ~]$ ls -la /opt/data/profiles/${bot.id}/`,
    `total 16`,
    `drwxr-xr-x 2 hermes hermes 4096 Sep 28 12:00 .`,
    `-rw-r--r-- 1 hermes hermes 1240 Sep 28 12:00 AGENTS.md`,
    `-rw-r--r-- 1 hermes hermes 2048 Sep 28 12:00 SOUL.md`,
    `-rw-r--r-- 1 hermes hermes  512 Sep 28 12:00 memory_store.db`,
  ]);
  const [terminalCommand, setTerminalCommand] = useState('');

  // Polaris Teach a task states
  const [isTeachingOpen, setIsTeachingOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [teachGoal, setTeachGoal] = useState('');
  const [recordingSecondsRemaining, setRecordingSecondsRemaining] = useState(600); // 10:00 countdown
  const [recordedSteps, setRecordedSteps] = useState<string[]>([]);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const noDriver = frame?.state === 'no-driver';
  const isError = frame?.state === 'error';
  const inputsEnabled = frame?.state === 'ready' && !busy && !isResetting;

  // Poll the frame endpoint only while open and on screen tab
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

  // Recording timer countdown
  useEffect(() => {
    if (!isRecording) return;
    const interval = window.setInterval(() => {
      setRecordingSecondsRemaining(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isRecording]);

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const act = useCallback(
    async (action: Parameters<typeof sendComputerAction>[1]) => {
      if (!inputsEnabled) return;
      setBusy(true);
      try {
        await sendComputerAction(bot.id, action);
        const f = await getComputerFrame(bot.id);
        setFrame(f);
        if (isRecording) {
          let stepDesc = '';
          if (action.action === 'click') {
            stepDesc = `Click at (${action.x}, ${action.y})`;
          } else if (action.action === 'type') {
            stepDesc = `Type "${action.text}"`;
          } else if (action.action === 'key') {
            stepDesc = `Press key "${action.key}"`;
          } else if (action.action === 'scroll') {
            stepDesc = `Scroll ${(action.amount ?? 0) > 0 ? 'down' : 'up'}`;
          }
          if (stepDesc) setRecordedSteps(prev => [...prev, stepDesc]);
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [bot.id, inputsEnabled, isRecording],
  );

  const handleResetComputer = async () => {
    setIsResetting(true);
    setResetMessage('');
    setError('');
    try {
      const res = await resetComputer(bot.id);
      setResetMessage(
        res.available
          ? `Reset succeeded: ${res.message || 'Display server restarted.'}`
          : `Reset noted: ${res.message || res.state || 'Backend driver not active'}`
      );
      const f = await getComputerFrame(bot.id);
      setFrame(f);
    } catch (e) {
      setError(`Reset error: ${(e as Error).message}`);
    } finally {
      setIsResetting(false);
    }
  };

  const handleStartTeaching = () => {
    if (!teachGoal.trim()) return;
    setIsTeachingOpen(false);
    setIsRecording(true);
    setRecordingSecondsRemaining(600);
    setRecordedSteps([]);
  };

  const handleStopTeaching = async () => {
    setIsRecording(false);
    try {
      await createRoutine(bot.id, {
        title: teachGoal || 'Demonstrated Task',
        schedule: 'Manual',
        prompt: recordedSteps.length > 0 ? recordedSteps.join(' -> ') : 'Completed demonstration',
      });
      setResetMessage(`Taught task "${teachGoal}" recorded and saved to bot routines!`);
      setTeachGoal('');
      setRecordedSteps([]);
    } catch (err) {
      setError(`Failed to save taught task: ${(err as Error).message}`);
    }
  };

  const onImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    const img = imgRef.current;
    if (!img || !frame?.width || !frame.height) return;
    const rect = img.getBoundingClientRect();
    const screen = {width: frame.width, height: frame.height};
    const {x, y} = mapTeachPointer(e.clientX, e.clientY, rect, screen);
    void act({action: 'click', x, y});
  };

  const executeTerminal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!terminalCommand.trim()) return;
    const cmd = terminalCommand.trim();
    setTerminalHistory(prev => [
      ...prev,
      `[hermes@balabot-agent ~]$ ${cmd}`,
      cmd === 'clear' ? '' : `command executed: ${cmd} (exit status 0)`,
    ]);
    setTerminalCommand('');
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isRecording) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isRecording, onClose]);

  return (
    <div
      className="fixed inset-0 z-30 bg-background"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 30,
        backgroundColor: 'var(--background)',
        color: 'var(--foreground)',
        overflow: 'hidden',
      }}
    >
      <div
        data-testid="computer-viewport"
        className="fixed inset-x-0 top-0 flex flex-col bg-background"
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'var(--background)',
          height: '100dvh',
          overflow: 'hidden',
        }}
      >
        <VStack gap={3} padding={4} height="fill" style={{position: 'relative', minHeight: '100%', flex: 1}}>
        {/* Polaris Top Chrome Bar */}
        <div
          data-testid="computer-chrome"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            borderBottom: '1px solid var(--sidebar-border, var(--border))',
            padding: '12px 18px',
            flexShrink: 0,
            backgroundColor: 'var(--background)',
          }}
        >
          <div style={{display: 'flex', minWidth: 0, flex: 1, alignItems: 'center', gap: '12px'}}>
            <BotAvatar
              color={bot.color}
              identity={bot.id}
              size={28}
            />
            {isRecording ? (
              <TeachRecordingChrome
                goal={teachGoal}
                expiresAt={Date.now() + recordingSecondsRemaining * 1000}
                variant="overlay"
                onStop={handleStopTeaching}
              />
            ) : (
              <span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '15.5px', fontWeight: 500, color: 'var(--foreground)'}} dir="auto">
                {bot.name}
              </span>
            )}
            {inputsEnabled ? (
              <span
                style={{
                  borderRadius: '9999px',
                  backgroundColor: 'rgba(78, 203, 113, 0.15)',
                  padding: '3px 11px',
                  fontSize: '13px',
                  color: 'var(--success)',
                  fontWeight: 500,
                }}
              >
                You have control
              </span>
            ) : null}
          </div>

          <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
            <button
              type="button"
              aria-label="Stop"
              data-testid="computer-overlay-stop"
              onClick={() => {
                /* stop run */
              }}
              style={{
                padding: '5px 12px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)',
                backgroundColor: 'transparent',
                color: 'var(--foreground)',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Stop
            </button>

            {isRecording ? (
              <button
                type="button"
                data-testid="teach-stop-button"
                aria-label="Stop teaching"
                onClick={() => void handleStopTeaching()}
                style={{
                  padding: '5px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border)',
                  backgroundColor: 'transparent',
                  color: 'var(--foreground)',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                Stop teaching
              </button>
            ) : (
              <TeachComputerOverlayControl
                botId={bot.id}
                busy={busy}
                onStartRecording={goal => {
                  setTeachGoal(goal);
                  setIsRecording(true);
                  setRecordingSecondsRemaining(600);
                  setRecordedSteps([]);
                }}
              />
            )}

            {!isRecording ? (
              <ComputerMaintenanceActions
                botId={bot.id}
                onChanged={async () => {
                  const f = await getComputerFrame(bot.id);
                  setFrame(f);
                }}
              />
            ) : null}

            <button
              type="button"
              aria-label="Close computer"
              onClick={onClose}
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
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Polaris TeachComputerOverlay Dialog/Popover */}
        {isTeachingOpen ? (
          <div
            data-testid="teach-chrome-popover"
            style={{
              padding: 'var(--spacing-4)',
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: '0 var(--spacing-2) var(--spacing-6) var(--overlay)',
            }}
          >
            <VStack gap={2}>
              <Text type="supporting" weight="medium">
                What result will you demonstrate?
              </Text>
              <textarea
                id="teach-goal-input"
                data-testid="teach-goal-input"
                rows={3}
                placeholder="Export this week's list from the CRM and drop it in the shared folder"
                value={teachGoal}
                onChange={e => setTeachGoal(e.target.value)}
                style={{
                  width: '100%',
                  padding: 'var(--spacing-2) var(--spacing-3)',
                  backgroundColor: 'var(--input)',
                  color: 'var(--foreground)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  fontFamily: 'inherit',
                  fontSize: 'var(--font-size-sm)',
                }}
              />
              <HStack gap={2}>
                <Button
                  label="Start recording"
                  variant="primary"
                  size="sm"
                  isDisabled={!teachGoal.trim()}
                  onClick={handleStartTeaching}
                />
                <Button
                  label="Cancel"
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsTeachingOpen(false)}
                />
              </HStack>
            </VStack>
          </div>
        ) : null}

        {/* Polaris TeachRecordingChrome banner */}
        {isRecording ? (
          <TeachRecordingChrome
            goal={teachGoal}
            expiresAt={Date.now() + recordingSecondsRemaining * 1000}
            actionsCount={recordedSteps.length}
            onStop={handleStopTeaching}
            variant="panel"
          />
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

        {/* Main Desktop Body (ComputerWorkspace with Screen, TerminalApp, FilesApp & Floating Dock) */}
        <div style={{flex: 1, minHeight: '23.75rem', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column'}}>
          <ComputerWorkspace
            botId={bot.id}
            hasControl={inputsEnabled}
            dock={!isRecording}
            terminalContent={<TerminalApp botId={bot.id} botName={bot.name} />}
            filesContent={<FilesApp botId={bot.id} botName={bot.name} />}
          >
            <div
              style={{
                position: 'relative',
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#000000',
                overflow: 'hidden',
              }}
            >
              {isLoading && !frame ? (
                <VStack gap={3} align="center" justify="center" height="fill">
                  <Spinner size="lg" label="Loading screen" />
                </VStack>
              ) : !frame ? (
                <EmptyState
                  title="No screen yet"
                  description="The frame endpoint has not returned a usable screen."
                />
              ) : frame.b64 ? (
                <div style={{position: 'relative', maxWidth: '100%', maxHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                  <img
                    ref={imgRef}
                    src={`data:image/png;base64,${frame.b64}`}
                    alt={`${bot.name} live screen`}
                    onClick={onImageClick}
                    style={{
                      maxWidth: '100%',
                      maxHeight: '100%',
                      objectFit: 'contain',
                      cursor: inputsEnabled ? 'crosshair' : 'default',
                      borderRadius: 'var(--radius-md)',
                      display: 'block',
                    }}
                  />
                </div>
              ) : (
                <EmptyState
                  isCompact
                  title="Screen unavailable"
                  description={frame.note ?? 'No frame data returned.'}
                  icon={<IconWarning />}
                />
              )}
            </div>
          </ComputerWorkspace>
        </div>

        {/* Interactive Take-Over inputs */}
        <HStack gap={2} vAlign="end" wrap="wrap" style={{marginTop: '8px', zIndex: 10}}>
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
      </div>
    </div>
  );
}
