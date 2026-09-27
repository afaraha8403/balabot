import {Table} from '@astryxdesign/core/Table';
import {Layout} from '@astryxdesign/core/Layout';
import {LayoutHeader} from '@astryxdesign/core/Layout';
import {LayoutContent} from '@astryxdesign/core/Layout';
import {Text} from '@astryxdesign/core/Text';
import {Token} from '@astryxdesign/core/Token';
import {proportional} from '@astryxdesign/core/Table';
import {getCost, type CostRow} from '../api';
import {useApiData} from '../useApiData';
import {ApiNotice} from './ApiNotice';

type CostRowX = CostRow & Record<string, unknown>;

const usd = (n: number) =>
  n.toLocaleString('en-US', {style: 'currency', currency: 'USD', maximumFractionDigits: 4});

export function CostScreen() {
  const state = useApiData(getCost);
  const rows = state.phase === 'ready' ? state.data.rows ?? [] : [];
  const total = rows.reduce((s, r) => s + r.spend, 0);

  return (
    <Layout
      height="fill"
      header={
        <LayoutHeader hasDivider padding={4}>
          <Text type="large" weight="semibold">
            Cost &amp; usage
          </Text>
          <Text type="supporting">
            {state.phase === 'ready'
              ? `${usd(total)} across ${rows.length} model${rows.length === 1 ? '' : 's'}, from the agents' own usage tables.`
              : 'Token and spend accounting for every agent.'}
          </Text>
        </LayoutHeader>
      }
      content={
        state.phase === 'ready' && rows.length > 0 ? (
          <LayoutContent padding={4}>
            <Table
              data={rows as CostRowX[]}
              idKey="id"
              density="compact"
              dividers="rows"
              hasHover
              textOverflow="truncate"
              columns={[
                {
                  key: 'provider',
                  header: 'Provider',
                  width: proportional(1),
                  renderCell: (f) => <Token label={String(f.provider)} size="sm" color="blue" />,
                },
                {
                  key: 'model',
                  header: 'Model',
                  width: proportional(2),
                  renderCell: (f) => <Text type="body">{String(f.model)}</Text>,
                },
                {
                  key: 'spend',
                  header: 'Spend (MTD)',
                  width: proportional(1),
                  renderCell: (f) => (
                    <Text type="body" hasTabularNumbers>
                      {usd(Number(f.spend))}
                    </Text>
                  ),
                },
                {
                  key: 'calls',
                  header: 'Calls',
                  width: proportional(0.7),
                  renderCell: (f) => (
                    <Text type="supporting" hasTabularNumbers>
                      {Number(f.calls).toLocaleString('en-US')}
                    </Text>
                  ),
                },
                {
                  key: 'tokens',
                  header: 'Tokens',
                  width: proportional(1),
                  renderCell: (f) => (
                    <Text type="supporting" hasTabularNumbers>
                      {Number(f.tokens).toLocaleString('en-US')}
                    </Text>
                  ),
                },
              ]}
            />
          </LayoutContent>
        ) : (
          <ApiNotice state={state} />
        )
      }
    />
  );
}