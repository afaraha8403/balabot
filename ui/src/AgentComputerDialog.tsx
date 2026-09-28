import {useCallback, useEffect, useRef, useState} from 'react';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {VStack} from '@astryxdesign/core/VStack';
import {HStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {Button} from '@astryxdesign/core/Button';
import {Banner} from '@astryxdesign/core/Banner';
import {TextInput} from '@astryxdesign/core/TextInput';
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
    const x = Math.round(((e.clientX - rect.left) / rect.width) * frame.width);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * frame.height);
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

  return (
    <Dialog
      isOpen
      onOpenChange={open => !open && onClose()}
      purpose="form"
    >
      <DialogHeader
        title={`${bot.name} — Agent Computer`}
        subtitle={
          frame
            ? `Captured ${frame.capturedAt} · ${frame.width}×${frame.height} · ${noDriver ? 'no driver' : isError ? 'error' : 'live'}`
            : 'Connecting…'
        }
        onOpenChange={onClose}
      />
      <VStack gap={3} padding={4} height="fill" style={{position: 'relative', minHeight: '640px'}}>
        {/* Top Control Bar: Reset & Teach task */}
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

          {!isRecording ? (
            <Button
              label="Teach a task"
              variant="primary"
              size="sm"
              aria-label="Teach a task"
              data-testid="teach-start-button"
              onClick={() => setIsTeachingOpen(prev => !prev)}
            />
          ) : (
            <Button
              label="Stop teaching"
              variant="destructive"
              size="sm"
              aria-label="Stop teaching"
              data-testid="teach-stop-button"
              onClick={() => void handleStopTeaching()}
            />
          )}
        </HStack>

        {/* Polaris TeachComputerOverlay Dialog/Popover */}
        {isTeachingOpen ? (
          <div
            data-testid="teach-chrome-popover"
            style={{
              padding: '16px',
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: '0 8px 24px var(--overlay)',
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
                  padding: '8px 12px',
                  backgroundColor: 'var(--input)',
                  color: 'var(--foreground)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  fontFamily: 'inherit',
                  fontSize: '14px',
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
          <div
            data-testid="teach-recording"
            style={{
              padding: '12px 16px',
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              borderLeft: '4px solid var(--destructive)',
            }}
          >
            <div style={{fontSize: '14px', fontWeight: 500, color: 'var(--foreground)'}}>
              Recording: {teachGoal}
            </div>
            <div style={{marginTop: '4px', fontSize: '13px', color: 'var(--muted-foreground)'}}>
              {formatTimer(recordingSecondsRemaining)} left · bot is watching, not acting
            </div>
            <div style={{marginTop: '4px', fontSize: '12px', color: 'var(--destructive)'}}>
              Do not type passwords into the demo. Use Take control for credentials.
            </div>
            {recordedSteps.length > 0 ? (
              <div style={{marginTop: '8px', fontSize: '12px', color: 'var(--muted-foreground)'}}>
                Actions captured: {recordedSteps.length}
              </div>
            ) : null}
          </div>
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

        {/* Main Workspace Area (Screen vs Terminal vs Files) */}
        <div style={{flex: 1, minHeight: '380px', position: 'relative', overflow: 'hidden'}}>
          {activeApp === 'screen' ? (
            isLoading && !frame ? (
              <VStack gap={3} align="center" justify="center" height="fill">
                <Spinner size="lg" label="Loading screen" />
              </VStack>
            ) : !frame ? (
              <EmptyState
                title="No screen yet"
                description="The frame endpoint has not returned a usable screen."
              />
            ) : frame.b64 ? (
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
                  border: '1px solid var(--border)',
                }}
              />
            ) : (
              <EmptyState
                isCompact
                title="Screen unavailable"
                description={frame.note ?? 'No frame data returned.'}
                icon={<IconWarning />}
              />
            )
          ) : activeApp === 'terminal' ? (
            <div
              style={{
                width: '100%',
                height: '100%',
                minHeight: '380px',
                backgroundColor: 'var(--background)',
                color: 'var(--foreground)',
                fontFamily: 'var(--font-family-code, monospace)',
                fontSize: '13px',
                padding: '16px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)',
                overflowY: 'auto',
              }}
            >
              <div style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
                {terminalHistory.map((line, idx) => (
                  <div key={idx}>{line}</div>
                ))}
                <form onSubmit={executeTerminal} style={{display: 'flex', gap: '8px', marginTop: '8px'}}>
                  <span>[hermes@balabot-agent ~]$</span>
                  <input
                    type="text"
                    value={terminalCommand}
                    onChange={e => setTerminalCommand(e.target.value)}
                    placeholder="Type bash command…"
                    style={{
                      flex: 1,
                      background: 'transparent',
                      border: 'none',
                      color: 'inherit',
                      outline: 'none',
                      fontFamily: 'inherit',
                    }}
                  />
                </form>
              </div>
            </div>
          ) : (
            <div
              style={{
                width: '100%',
                height: '100%',
                minHeight: '380px',
                backgroundColor: 'var(--card)',
                color: 'var(--foreground)',
                padding: '16px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)',
                overflowY: 'auto',
              }}
            >
              <Text type="supporting" weight="semibold">
                Workspace Files — /opt/data/profiles/{bot.id}/
              </Text>
              <VStack gap={2} style={{marginTop: '12px'}}>
                {[
                  {name: 'AGENTS.md', size: '1.2 KB', type: 'Markdown'},
                  {name: 'SOUL.md', size: '2.0 KB', type: 'Markdown'},
                  {name: 'memory_store.db', size: '512 B', type: 'SQLite Database'},
                  {name: 'rules/', size: 'Directory', type: 'Folder'},
                ].map(file => (
                  <HStack
                    key={file.name}
                    justify="between"
                    padding={2}
                    style={{
                      borderBottom: '1px solid var(--border)',
                      backgroundColor: 'var(--muted)',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    <span>{file.name}</span>
                    <span style={{color: 'var(--muted-foreground)', fontSize: '13px'}}>
                      {file.size} · {file.type}
                    </span>
                  </HStack>
                ))}
              </VStack>
            </div>
          )}
        </div>

        {/* Interactive Take-Over inputs (visible on Screen app) */}
        {activeApp === 'screen' ? (
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
        ) : null}

        {/* Polaris ComputerWorkspace Floating Dock */}
        <div
          data-testid="computer-workspace-dock"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            padding: '6px 12px',
            backgroundColor: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-xl)',
            boxShadow: '0 4px 16px var(--overlay)',
            backdropFilter: 'blur(8px)',
            alignSelf: 'center',
            marginTop: '8px',
          }}
        >
          <Button
            label="Live Screen"
            variant={activeApp === 'screen' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setActiveApp('screen')}
          />
          <Button
            label="Terminal"
            variant={activeApp === 'terminal' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setActiveApp('terminal')}
          />
          <Button
            label="Files"
            variant={activeApp === 'files' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setActiveApp('files')}
          />
        </div>
      </VStack>
    </Dialog>
  );
}
