import {useCallback, useEffect, useState} from 'react';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {VStack} from '@astryxdesign/core/VStack';
import {HStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {Button} from '@astryxdesign/core/Button';
import {Banner} from '@astryxdesign/core/Banner';
import {List, ListItem} from '@astryxdesign/core/List';
import {Token} from '@astryxdesign/core/Token';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Timestamp} from '@astryxdesign/core/Timestamp';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {
  adoptOrphan,
  listOrphans,
  purgeOrphan,
  reapSubagentArtifacts,
  type OrphanProfile,
  type OrphansResponse,
} from './api';

type Props = {
  onClose: () => void;
  /** Called after an adopt so App reloads the roster. */
  onFleetChanged: () => void;
};

/** Bytes -> short human size (KB/MB) for the row detail line. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function orphanRowLabel(p: OrphanProfile): {variant: 'warning' | 'neutral'; label: string} {
  return p.shape === 'orphan-profile'
    ? {variant: 'warning', label: 'Real profile'}
    : {variant: 'neutral', label: 'Sub-agent artifact'};
}

/**
 * Orphan reconciliation: a profile sitting on disk that the product cannot
 * see — no roster row. Either adopt it into the roster or purge it.
 * `shape` separates real orphan profiles from empty sub-agent shells.
 */
export function OrphansDialog({onClose, onFleetChanged}: Props) {
  const [data, setData] = useState<OrphansResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [banner, setBanner] = useState('');
  const [notice, setNotice] = useState('');
  const [reaping, setReaping] = useState(false);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listOrphans();
      setData(r);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const adopt = async (name: string) => {
    setBusyName(name);
    setBanner('');
    try {
      await adoptOrphan(name);
      onFleetChanged();
      await load();
    } catch (e) {
      setBanner((e as Error).message);
    } finally {
      setBusyName(null);
    }
  };

  const purge = async (name: string) => {
    setBusyName(name);
    setBanner('');
    try {
      await purgeOrphan(name);
      setConfirmName(null);
      await load();
    } catch (e) {
      setBanner((e as Error).message);
    } finally {
      setBusyName(null);
    }
  };

  const profiles = data?.profiles ?? [];
  const artifactCount = profiles.filter(p => p.shape !== 'orphan-profile').length;

  /** Batch-reap empty-shell profiles (sub-agent debris). Real orphan profiles
   *  are deliberately excluded — they need an explicit adopt or purge. */
  const reap = async () => {
    setReaping(true);
    setBanner('');
    setNotice('');
    try {
      const r = await reapSubagentArtifacts();
      setNotice(
        r.count
          ? `Reaped ${r.count} sub-agent artifact${r.count === 1 ? '' : 's'}.`
          : 'No sub-agent artifacts to reap.',
      );
      await load();
    } catch (e) {
      setBanner((e as Error).message);
    } finally {
      setReaping(false);
    }
  };

  return (
    <Dialog
      isOpen
      onOpenChange={open => !open && onClose()}
      purpose="info"
      variant="fullscreen">
      <DialogHeader
        title="Unregistered profiles"
        subtitle="Profiles on disk the roster cannot see — adopt one or purge it."
        onOpenChange={onClose}
      />
      <VStack gap={3} padding={4} height="fill">
        <Text type="supporting">
          An orphan is a profile folder that exists on disk but has no roster row, so the
          product cannot see or chat with it. A real profile can be adopted into the roster;
          an empty sub-agent artifact is debris and can be purged.
        </Text>

        {banner ? (
          <Banner
            status="error"
            title="Orphan action failed"
            description={banner}
            onDismiss={() => setBanner('')}
          />
        ) : null}
        {notice ? (
          <Banner
            status="info"
            title="Sub-agent reap"
            description={notice}
            onDismiss={() => setNotice('')}
          />
        ) : null}
        {error ? (
          <Banner status="error" title="Could not load orphans" description={error} />
        ) : null}

        {loading ? (
          <Text type="supporting">Checking the disk…</Text>
        ) : profiles.length === 0 ? (
          <EmptyState
            title="No unregistered profiles"
            description="Every profile on disk is either in the roster or a shipped bot. Nothing to reconcile."
          />
        ) : (
          <List density="spacious">
            {profiles.map(p => {
              const status = orphanRowLabel(p);
              return (
                <ListItem
                  key={p.id}
                  label={p.name}
                  description={
                    <VStack gap={1} align="start">
                      <HStack gap={2} vAlign="center" wrap="wrap">
                        <StatusDot variant={status.variant} label={status.label} />
                        {p.gatewayRunning ? (
                          <Token label="gateway running" size="sm" color="teal" />
                        ) : null}
                        {p.hasSoul ? <Token label="soul" size="sm" /> : null}
                        {p.hasConfig ? <Token label="config" size="sm" /> : null}
                        <Token label={formatSize(p.sizeBytes)} size="sm" />
                      </HStack>
                      <Text type="supporting" size="xsm" maxLines={1}>
                        {p.path}
                      </Text>
                      <Timestamp value={p.createdAt} format="date_time" />
                      {confirmName === p.name ? (
                        <VStack gap={2}>
                          <Text type="body">
                            Permanently delete <Text weight="semibold">{p.name}</Text> from
                            disk? This cannot be undone.
                          </Text>
                          <HStack gap={2}>
                            <Button
                              label="Yes, delete it"
                              variant="primary"
                              size="sm"
                              isDisabled={busyName === p.name}
                              isLoading={busyName === p.name}
                              onClick={() => void purge(p.name)}
                            />
                            <Button
                              label="Cancel"
                              variant="ghost"
                              size="sm"
                              isDisabled={busyName === p.name}
                              onClick={() => setConfirmName(null)}
                            />
                          </HStack>
                        </VStack>
                      ) : null}
                    </VStack>
                  }
                  endContent={
                    <HStack gap={2}>
                      <Button
                        label="Adopt"
                        variant="secondary"
                        size="sm"
                        isDisabled={busyName !== null}
                        isLoading={busyName === p.name}
                        onClick={() => void adopt(p.name)}
                      />
                      <Button
                        label="Delete"
                        variant="ghost"
                        size="sm"
                        isDisabled={busyName !== null}
                        isLoading={busyName === p.name}
                        onClick={() => setConfirmName(p.name)}
                      />
                    </HStack>
                  }
                />
              );
            })}
          </List>
        )}

        {data?.note ? <Text type="supporting">{data.note}</Text> : null}

        <HStack gap={2}>
          <Button
            label="Refresh"
            variant="secondary"
            size="sm"
            isDisabled={loading || reaping}
            onClick={() => void load()}
          />
          <Button
            label={artifactCount ? `Reap debris (${artifactCount})` : 'Reap debris'}
            variant="secondary"
            size="sm"
            isDisabled={loading || reaping || artifactCount === 0 || busyName !== null}
            isLoading={reaping}
            onClick={() => void reap()}
          />
        </HStack>
      </VStack>
    </Dialog>
  );
}
