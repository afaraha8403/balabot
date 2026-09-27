import {Table} from '@astryxdesign/core/Table';
import {proportional} from '@astryxdesign/core/Table';
import {Text} from '@astryxdesign/core/Text';
import {Token} from '@astryxdesign/core/Token';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {HStack} from '@astryxdesign/core/Stack';
import {VStack} from '@astryxdesign/core/VStack';
import {Layout} from '@astryxdesign/core/Layout';
import {LayoutHeader} from '@astryxdesign/core/Layout';
import {LayoutContent} from '@astryxdesign/core/Layout';
import {getOps, type OpsService} from '../api';
import {useApiData} from '../useApiData';
import {ApiNotice} from './ApiNotice';

type OpsRow = OpsService & Record<string, unknown>;

const stateVariant = (s: OpsService['state']) =>
  s === 'running' ? 'success' : s === 'degraded' ? 'warning' : s === 'down' ? 'error' : 'neutral';

export function OpsScreen() {
  const state = useApiData(getOps);
  const services = state.phase === 'ready' ? state.data.services ?? [] : [];
  const running = services.filter((s) => s.state === 'running').length;

  return (
    <Layout
      height="fill"
      header={
        <LayoutHeader hasDivider padding={4}>
          <Text type="large" weight="semibold">
            Ops
          </Text>
          <Text type="supporting">
            {state.phase === 'ready'
              ? `Supervised services inside the container — ${running} of ${services.length} running.`
              : 'Supervision, gateway and tunnel health.'}
          </Text>
        </LayoutHeader>
      }
      content={
        state.phase === 'ready' && services.length > 0 ? (
          <LayoutContent padding={4}>
            <VStack gap={4}>
              <Table
                data={services as OpsRow[]}
                idKey="id"
                density="compact"
                dividers="rows"
                hasHover
                textOverflow="truncate"
                columns={[
                  {
                    key: 'name',
                    header: 'Service',
                    width: proportional(1.4),
                    renderCell: (f) => (
                      <Text type="body" weight="medium">
                        {String(f.name)}
                      </Text>
                    ),
                  },
                  {
                    key: 'state',
                    header: 'State',
                    width: proportional(0.9),
                    renderCell: (f) => (
                      <HStack gap={2} vAlign="center">
                        <StatusDot variant={stateVariant(f.state)} label={String(f.state)} />
                        <Text type="supporting">{String(f.state)}</Text>
                      </HStack>
                    ),
                  },
                  {
                    key: 'detail',
                    header: 'Detail',
                    width: proportional(2),
                    renderCell: (f) => <Text type="supporting">{String(f.detail)}</Text>,
                  },
                  {
                    key: 'uptime',
                    header: 'Uptime',
                    width: proportional(0.7),
                    renderCell: (f) => <Text type="supporting">{String(f.uptime)}</Text>,
                  },
                ]}
              />
              <HStack gap={2}>
                <Token label="Read-only" size="sm" color="gray" />
                <Text type="supporting">
                  Service control (restart/stop) is not exposed by the adapter yet, so no action buttons
                  are shown rather than shipping ones that do nothing.
                </Text>
              </HStack>
            </VStack>
          </LayoutContent>
        ) : (
          <ApiNotice state={state} />
        )
      }
    />
  );
}