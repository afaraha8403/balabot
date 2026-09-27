import {useState} from 'react';
import {Section} from '@astryxdesign/core/Section';
import {Table} from '@astryxdesign/core/Table';
import {proportional} from '@astryxdesign/core/Table';
import {Text} from '@astryxdesign/core/Text';
import {Badge} from '@astryxdesign/core/Badge';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Layout} from '@astryxdesign/core/Layout';
import {LayoutHeader} from '@astryxdesign/core/Layout';
import {LayoutContent} from '@astryxdesign/core/Layout';
import {VStack} from '@astryxdesign/core/VStack';
import {getMemory, type MemoryFact} from '../api';
import {useApiData} from '../useApiData';
import {ApiNotice} from './ApiNotice';

type FactRow = MemoryFact & Record<string, unknown>;

const trustBadge = (t: number) => (t >= 0.95 ? 'success' : t >= 0.8 ? 'info' : 'warning');

export function MemoryScreen() {
  const [query, setQuery] = useState('');
  const state = useApiData(getMemory);
  const all = state.phase === 'ready' ? state.data.facts ?? [] : [];
  const rows = all.filter(
    (f) =>
      f.content.toLowerCase().includes(query.toLowerCase()) ||
      (f.entity ?? '').toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <Layout
      height="fill"
      header={
        <LayoutHeader hasDivider padding={4}>
          <Text type="large" weight="semibold">
            Memory
          </Text>
          <Text type="supporting">
            {state.phase === 'ready'
              ? `Holographic store — ${all.length} fact${all.length === 1 ? '' : 's'} recorded${state.data.profile ? ` for ${state.data.profile}` : ''}.`
              : 'Holographic store — facts, trust scores, entity resolution.'}
          </Text>
        </LayoutHeader>
      }
      content={
        state.phase === 'ready' && all.length > 0 ? (
          <LayoutContent padding={4}>
            <VStack gap={4}>
              <TextInput
                label="Probe the store"
                isLabelHidden
                placeholder="Search facts, entities, resolutions…"
                value={query}
                onChange={setQuery}
                size="md"
              />
              <Section variant="transparent" padding={0}>
                <Table
                  data={rows as FactRow[]}
                  idKey="id"
                  density="compact"
                  dividers="rows"
                  hasHover
                  textOverflow="truncate"
                  columns={[
                    {
                      key: 'content',
                      header: 'Fact',
                      width: proportional(3),
                      renderCell: (f) => <Text type="body">{String(f.content)}</Text>,
                    },
                    {
                      key: 'entity',
                      header: 'Entity',
                      width: proportional(1),
                      renderCell: (f) => <Text type="supporting">{String(f.entity)}</Text>,
                    },
                    {
                      key: 'resolvedTo',
                      header: 'Resolved to',
                      width: proportional(1),
                      renderCell: (f) => <Text type="supporting">{String(f.resolvedTo)}</Text>,
                    },
                    {
                      key: 'trust',
                      header: 'Trust',
                      width: proportional(0.6),
                      renderCell: (f) => (
                        <Badge
                          label={`${Math.round(Number(f.trust) * 100)}%`}
                          variant={trustBadge(Number(f.trust))}
                        />
                      ),
                    },
                    {
                      key: 'sources',
                      header: 'Sources',
                      width: proportional(0.5),
                      renderCell: (f) => <Text type="supporting">{String(f.sources)}</Text>,
                    },
                    {
                      key: 'updatedAt',
                      header: 'Updated',
                      width: proportional(0.8),
                      renderCell: (f) => <Text type="supporting">{String(f.updatedAt)}</Text>,
                    },
                  ]}
                />
              </Section>
            </VStack>
          </LayoutContent>
        ) : (
          <ApiNotice state={state} />
        )
      }
    />
  );
}