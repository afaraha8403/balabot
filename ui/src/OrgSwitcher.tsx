import {useEffect, useState} from 'react';
import {HStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {Selector} from '@astryxdesign/core/Selector';
import {getOrgs, type OrgSummary} from './api';

type Props = {
  /** Current org id, controlled by App. */
  value: string;
  onChange: (org: OrgSummary) => void;
};

/**
 * Compact org selector for the header. With exactly one org it renders as a
 * plain label — not a dropdown — so a single-org fleet never shows a broken
 * selector. Members of the current org are shown inline.
 */
export function OrgSwitcher({value, onChange}: Props) {
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setOrgs(await getOrgs());
      } catch {
        // Endpoints may not be live yet (parallel rollout) — degrade to a label.
        setFailed(true);
      }
    })();
  }, []);

  const current = orgs.find(o => o.id === value) ?? orgs[0] ?? null;

  if (orgs.length === 0) {
    // One-org or no-data case: simple label, never a broken dropdown.
    return (
      <HStack gap={2} vAlign="center">
        <Text type="supporting">
          {failed ? 'Org unavailable' : current?.name ?? 'Org loading…'}
        </Text>
        {current?.members?.length ? (
          <Text type="supporting" maxLines={1}>
            {current.members.join(', ')}
          </Text>
        ) : null}
      </HStack>
    );
  }

  if (orgs.length === 1) {
    const org = orgs[0];
    return (
      <HStack gap={2} vAlign="center">
        <Text weight="semibold">{org.name}</Text>
        {org.members?.length ? (
          <Text type="supporting" maxLines={1}>
            {org.members.join(', ')}
          </Text>
        ) : null}
      </HStack>
    );
  }

  return (
    <Selector
      label="Organisation"
      value={current?.id ?? ''}
      onChange={id => {
        const org = orgs.find(o => o.id === id);
        if (org) onChange(org);
      }}
      size="sm"
      isLabelHidden
      options={orgs.map(o => ({
        value: o.id,
        label: o.members?.length ? `${o.name} (${o.members.join(', ')})` : o.name,
      }))}
    />
  );
}
