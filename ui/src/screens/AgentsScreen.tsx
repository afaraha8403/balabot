import {Section} from '@astryxdesign/core/Section';
import {TreeList} from '@astryxdesign/core/TreeList';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Text} from '@astryxdesign/core/Text';
import {Badge} from '@astryxdesign/core/Badge';
import {MetadataList, MetadataListItem} from '@astryxdesign/core/MetadataList';
import {Layout} from '@astryxdesign/core/Layout';
import {LayoutHeader} from '@astryxdesign/core/Layout';
import {LayoutContent} from '@astryxdesign/core/Layout';
import {LayoutPanel} from '@astryxdesign/core/Layout';
import {VStack} from '@astryxdesign/core/VStack';
import {getAgents, type AgentNode} from '../api';
import {useApiData} from '../useApiData';
import {ApiNotice} from './ApiNotice';

type TreeItem = {
  id: string;
  label: string;
  children?: TreeItem[];
  isExpanded?: boolean;
};

const toTree = (nodes: AgentNode[]): TreeItem[] =>
  nodes.map((n) => ({
    id: n.id,
    label: `${n.name} — ${n.role}`,
    isExpanded: true,
    children: n.children ? toTree(n.children) : undefined,
  }));

const flatten = (nodes: AgentNode[], out: AgentNode[] = []): AgentNode[] => {
  for (const n of nodes) {
    out.push(n);
    if (n.children) flatten(n.children, out);
  }
  return out;
};

const statusVariant = (s: AgentNode['status']) =>
  s === 'live' ? 'success' : s === 'busy' ? 'warning' : 'neutral';

const tierLabel: Record<AgentNode['tier'], string> = {
  user: 'User',
  principal: 'Principal',
  governor: 'Governor',
  persistent: 'Persistent agent',
  sub: 'Sub-agent',
};

export function AgentsScreen() {
  const state = useApiData(getAgents);
  const agentTree: AgentNode[] = state.phase === 'ready' ? state.data.tree ?? [] : [];
  const all = flatten(agentTree);
  const selected = all[1] ?? all[0];
  const live = all.filter((a) => a.status === 'live').length;

  return (
    <Layout
      height="fill"
      header={
        <LayoutHeader hasDivider padding={4}>
          <Text type="large" weight="semibold">
            Agents
          </Text>
          <Text type="supporting">
            {state.phase === 'ready'
              ? `User → principal → governor → persistent agents → sub-agents. ${live} live of ${all.length}.`
              : 'The agent hierarchy this install actually runs.'}
          </Text>
        </LayoutHeader>
      }
      content={
        state.phase === 'ready' && agentTree.length > 0 ? (
          <LayoutContent padding={0}>
            <Section padding={4} variant="transparent">
              <TreeList items={toTree(agentTree)} density="balanced" variant="lineGuides" />
            </Section>
          </LayoutContent>
        ) : (
          <ApiNotice state={state} />
        )
      }
      end={
        selected ? (
          <LayoutPanel width={340} hasDivider label="Agent detail">
            <VStack gap={4} padding={4}>
              <Text type="body" weight="semibold">
                {selected.name}
              </Text>
              <Text type="supporting">{selected.role}</Text>
              <Badge label={tierLabel[selected.tier]} variant="info" />
              <MetadataList title="Status">
                <MetadataListItem label="State">
                  <StatusDot variant={statusVariant(selected.status)} label={selected.status} />{' '}
                  <Text type="supporting">{selected.status}</Text>
                </MetadataListItem>
                <MetadataListItem label="Tier">
                  <Text type="supporting">{tierLabel[selected.tier]}</Text>
                </MetadataListItem>
                <MetadataListItem label="Agents in fleet">
                  <Text type="supporting">{String(all.length)}</Text>
                </MetadataListItem>
              </MetadataList>
            </VStack>
          </LayoutPanel>
        ) : undefined
      }
    />
  );
}