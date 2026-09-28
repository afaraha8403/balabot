import {useEffect, useRef, useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {HStack} from '@astryxdesign/core/Stack';
import {VStack} from '@astryxdesign/core/VStack';
import {Text} from '@astryxdesign/core/Text';
import {Badge} from '@astryxdesign/core/Badge';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Card} from '@astryxdesign/core/Card';
import {IconWarning, IconCheck} from './icons';
import {
  pauseBot,
  resolveIntervention,
  type InterventionPayload,
} from './api';

type Props = {
  botId: string;
  botName: string;
  isStreaming: boolean;
  onStopStreaming: () => void;
  activeIntervention: InterventionPayload | null;
  onInterventionChange: (iv: InterventionPayload | null) => void;
  onNotify: (msg: string) => void;
  onOpenComputer?: () => void;
};

export function HoldEverythingControl({
  botId,
  botName,
  isStreaming,
  onStopStreaming,
  activeIntervention,
  onInterventionChange,
  onNotify,
  onOpenComputer,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [steerNote, setSteerNote] = useState('');
  const [showSteerInput, setShowSteerInput] = useState(false);
  const [busy, setBusy] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isPending =
    activeIntervention &&
    (activeIntervention.state === 'pending' || activeIntervention.status === 'pending');

  const isExpired = activeIntervention?.state === 'expired';
  const isAccepted = activeIntervention?.state === 'accepted' || activeIntervention?.status === 'approved';
  const isRejected = activeIntervention?.state === 'rejected' || activeIntervention?.status === 'denied';

  // Close dropdown on outside click or escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setShowSteerInput(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
        setShowSteerInput(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleHold = async () => {
    setBusy(true);
    try {
      const res = await pauseBot(botId, 'Owner requested hold');
      if (res.ok && res.record) {
        onInterventionChange(res.record);
        onNotify(`Hold active: ${botName}'s turn paused by owner.`);
      }
    } catch (err) {
      onNotify(`Could not pause ${botName}: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleResolve = async (action: 'approve' | 'deny', note = '') => {
    if (!activeIntervention?.resume_token) return;
    setBusy(true);
    try {
      const res = await resolveIntervention(
        activeIntervention.resume_token,
        action,
        note,
      );
      const rec = res.record;
      if (rec.state === 'expired') {
        onNotify('Intervention expired: this turn has already ended.');
        onInterventionChange(rec);
      } else if (rec.state === 'accepted') {
        onNotify(`Intervention accepted: ${botName} resumed.`);
        onInterventionChange(null);
        setIsOpen(false);
        setShowSteerInput(false);
      } else if (rec.state === 'rejected') {
        onNotify(`Intervention declined: ${botName} turn ended.`);
        onInterventionChange(null);
        onStopStreaming();
        setIsOpen(false);
        setShowSteerInput(false);
      } else {
        onInterventionChange(rec);
      }
    } catch (err) {
      onNotify(`Resolve failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={dropdownRef} style={{position: 'relative', display: 'inline-block'}}>
      {/* Primary visible "Hold everything" control reachable in accessibility tree */}
      <Button
        label={
          isPending
            ? 'Hold everything (Paused)'
            : isStreaming
              ? 'Hold everything'
              : 'Hold everything'
        }
        aria-label="Hold everything"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        variant={isPending ? 'primary' : isStreaming ? 'secondary' : 'ghost'}
        size="sm"
        onClick={() => setIsOpen(prev => !prev)}
      />

      {isOpen ? (
        <div
          role="menu"
          aria-label="Hold everything options"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            zIndex: 1000,
            minWidth: '280px',
            backgroundColor: 'var(--surface-overlay, #1c1c1e)',
            border: '1px solid var(--border-default, rgba(255, 255, 255, 0.15))',
            borderRadius: 'var(--radius-md, 8px)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            padding: '10px',
          }}
        >
          <VStack gap={2} align="stretch">
            <HStack gap={2} vAlign="center" justify="between">
              <Text type="body" weight="semibold" size="sm">
                Hold & Intervention
              </Text>
              {isPending ? (
                <Badge label="PAUSED" variant="warning" />
              ) : isStreaming ? (
                <Badge label="RUNNING" variant="neutral" />
              ) : (
                <Badge label="IDLE" variant="neutral" />
              )}
            </HStack>

            {/* Current State Details */}
            {isPending ? (
              <Card variant="muted" padding={2}>
                <VStack gap={1}>
                  <HStack gap={1} vAlign="center">
                    <IconWarning size="sm" color="warning" />
                    <Text type="body" weight="medium" size="xsm">
                      {activeIntervention.reason || 'Bot paused — awaiting human decision'}
                    </Text>
                  </HStack>
                  {activeIntervention.hint ? (
                    <Text type="supporting" size="xsm" color="secondary">
                      Hint: {activeIntervention.hint}
                    </Text>
                  ) : null}
                  {activeIntervention.expires_at ? (
                    <Text type="supporting" size="xsm" color="secondary">
                      Expires: {new Date(activeIntervention.expires_at).toLocaleTimeString()}
                    </Text>
                  ) : null}
                </VStack>
              </Card>
            ) : null}

            {isExpired ? (
              <Card variant="muted" padding={2}>
                <HStack gap={1} vAlign="center">
                  <IconWarning size="sm" color="secondary" />
                  <Text type="supporting" size="xsm" color="secondary">
                    Intervention expired: the targeted turn has ended.
                  </Text>
                </HStack>
              </Card>
            ) : null}

            {isAccepted ? (
              <Card variant="muted" padding={2}>
                <HStack gap={1} vAlign="center">
                  <IconCheck size="sm" color="success" />
                  <Text type="supporting" size="xsm" color="secondary">
                    Intervention was accepted. Bot resumed.
                  </Text>
                </HStack>
              </Card>
            ) : null}

            {isRejected ? (
              <Card variant="muted" padding={2}>
                <HStack gap={1} vAlign="center">
                  <IconWarning size="sm" color="secondary" />
                  <Text type="supporting" size="xsm" color="secondary">
                    Intervention was declined. Turn ended.
                  </Text>
                </HStack>
              </Card>
            ) : null}

            {/* Action buttons */}
            {!isPending ? (
              <Button
                label="Pause turn (Hold everything)"
                variant="primary"
                size="sm"
                isDisabled={busy || !isStreaming}
                isLoading={busy}
                onClick={() => void handleHold()}
              />
            ) : (
              <VStack gap={2}>
                <HStack gap={2}>
                  <Button
                    label="Approve & Continue"
                    variant="primary"
                    size="sm"
                    isDisabled={busy}
                    isLoading={busy}
                    onClick={() => void handleResolve('approve')}
                  />
                  <Button
                    label="Deny & Halt"
                    variant="ghost"
                    size="sm"
                    isDisabled={busy}
                    onClick={() => void handleResolve('deny')}
                  />
                </HStack>

                {onOpenComputer ? (
                  <Button
                    label="Open Agent Computer"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setIsOpen(false);
                      onOpenComputer();
                    }}
                  />
                ) : null}

                {/* Steering flow */}
                {!showSteerInput ? (
                  <Button
                    label="Steer turn with guidance…"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowSteerInput(true)}
                  />
                ) : (
                  <VStack gap={1}>
                    <TextInput
                      label="Steering note"
                      placeholder="Instructions for the paused bot…"
                      value={steerNote}
                      onChange={setSteerNote}
                      size="sm"
                    />
                    <HStack gap={1}>
                      <Button
                        label="Resume with guidance"
                        variant="primary"
                        size="sm"
                        isDisabled={busy || !steerNote.trim()}
                        isLoading={busy}
                        onClick={() => void handleResolve('approve', steerNote.trim())}
                      />
                      <Button
                        label="Cancel"
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowSteerInput(false)}
                      />
                    </HStack>
                  </VStack>
                )}
              </VStack>
            )}

            {(isExpired || isAccepted || isRejected) && (
              <Button
                label="Dismiss status"
                variant="ghost"
                size="sm"
                onClick={() => {
                  onInterventionChange(null);
                  setIsOpen(false);
                }}
              />
            )}
          </VStack>
        </div>
      ) : null}
    </div>
  );
}
