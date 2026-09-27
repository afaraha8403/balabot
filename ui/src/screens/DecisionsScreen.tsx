import {Section} from '@astryxdesign/core/Section';
import {Table} from '@astryxdesign/core/Table';
import {proportional} from '@astryxdesign/core/Table';
import {Text} from '@astryxdesign/core/Text';
import {Badge} from '@astryxdesign/core/Badge';
import {HStack} from '@astryxdesign/core/Stack';
import {ProgressBar} from '@astryxdesign/core/ProgressBar';
import {Layout} from '@astryxdesign/core/Layout';
import {LayoutHeader} from '@astryxdesign/core/Layout';
import {LayoutContent} from '@astryxdesign/core/Layout';
import {getDecisions, type TypedDecision} from '../api';
import {useApiData} from '../useApiData';
import {ApiNotice} from './ApiNotice';

type DecisionRow = TypedDecision & Record<string, unknown>;

const kindBadge = (k: TypedDecision['kind']) =>
  k === 'noul' ? 'purple' : k === 'choice' ? 'blue' : 'teal';

export function DecisionsScreen() {
  const state = useApiData(getDecisions);
  const decisions = state.phase === 'ready' ? state.data.decisions ?? [] : [];

  return (
    <Layout
      height="fill"
      header={
        <LayoutHeader hasDivider padding={4}>
          <Text type="large" weight="semibold">
            Decisions
          </Text>
          <Text type="supporting">
            {state.phase === 'ready'
              ? `Jev / TypeSafe typed decisions — ${decisions.length} recorded.`
              : 'Jev / TypeSafe typed decisions — noul, choice, score — with confidence and shadow mode.'}
          </Text>
        </LayoutHeader>
      }
      content={
        state.phase === 'ready' && decisions.length > 0 ? (
          <LayoutContent padding={4}>
            <Section variant="transparent" padding={0}>
              <Table
                data={decisions as DecisionRow[]}
                idKey="id"
                density="compact"
                dividers="rows"
                hasHover
                textOverflow="truncate"
                columns={[
                  {
                    key: 'kind',
                    header: 'Type',
                    width: proportional(0.6),
                    renderCell: (f) => <Badge label={String(f.kind)} variant={kindBadge(f.kind)} />,
                  },
                  {
                    key: 'statement',
                    header: 'Decision',
                    width: proportional(3),
                    renderCell: (f) => <Text type="body">{String(f.statement)}</Text>,
                  },
                  {
                    key: 'confidence',
                    header: 'Confidence',
                    width: proportional(1.2),
                    renderCell: (f) => (
                      <HStack gap={2} vAlign="center">
                        <ProgressBar
                          value={Number(f.confidence)}
                          label={`Confidence ${Math.round(Number(f.confidence) * 100)}%`}
                        />
                        <Text type="supporting">{`${Math.round(Number(f.confidence) * 100)}%`}</Text>
                      </HStack>
                    ),
                  },
                  {
                    key: 'shadow',
                    header: 'Mode',
                    width: proportional(0.7),
                    renderCell: (f) =>
                      f.shadow ? (
                        <Badge label="shadow" variant="warning" />
                      ) : (
                        <Badge label="live" variant="success" />
                      ),
                  },
                  {
                    key: 'decidedBy',
                    header: 'By',
                    width: proportional(0.8),
                    renderCell: (f) => <Text type="supporting">{String(f.decidedBy)}</Text>,
                  },
                  {
                    key: 'at',
                    header: 'When',
                    width: proportional(1),
                    renderCell: (f) => <Text type="supporting">{String(f.at)}</Text>,
                  },
                ]}
              />
            </Section>
          </LayoutContent>
        ) : (
          <ApiNotice state={state} />
        )
      }
    />
  );
}