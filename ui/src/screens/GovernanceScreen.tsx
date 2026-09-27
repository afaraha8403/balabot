import {List} from '@astryxdesign/core/List';
import {ListItem} from '@astryxdesign/core/List';
import {Text} from '@astryxdesign/core/Text';
import {Timestamp} from '@astryxdesign/core/Timestamp';
import {Token} from '@astryxdesign/core/Token';
import {VStack} from '@astryxdesign/core/VStack';
import {HStack} from '@astryxdesign/core/Stack';
import {Layout} from '@astryxdesign/core/Layout';
import {LayoutHeader} from '@astryxdesign/core/Layout';
import {LayoutContent} from '@astryxdesign/core/Layout';
import {getGovernance} from '../api';
import {useApiData} from '../useApiData';
import {ApiNotice} from './ApiNotice';

export function GovernanceScreen() {
  const state = useApiData(getGovernance);
  const ledger = state.phase === 'ready' ? state.data.ledger ?? [] : [];

  return (
    <Layout
      height="fill"
      header={
        <LayoutHeader hasDivider padding={4}>
          <Text type="large" weight="semibold">
            Governance ledger
          </Text>
          <Text type="supporting">
            {state.phase === 'ready'
              ? `The OKF decision record — ${ledger.length} entr${ledger.length === 1 ? 'y' : 'ies'}.`
              : 'The OKF decision record — what was decided, by whom, why, and the rollback path.'}
          </Text>
        </LayoutHeader>
      }
      content={
        state.phase === 'ready' && ledger.length > 0 ? (
          <LayoutContent padding={4}>
            <List density="balanced" hasDividers>
              {ledger.map((e) => (
                <ListItem
                  key={e.id}
                  label={e.what}
                  description={
                    <VStack gap={1} align="start">
                      <Text type="supporting">Why: {e.why}</Text>
                      <Text type="supporting">Rollback: {e.rollback}</Text>
                      <HStack gap={2} vAlign="center">
                        <Token label={e.who} size="sm" color="gray" />
                        <Timestamp value={e.at} format="date" />
                      </HStack>
                    </VStack>
                  }
                  startContent={<Token label={e.who} size="sm" color="blue" />}
                />
              ))}
            </List>
          </LayoutContent>
        ) : (
          <ApiNotice state={state} />
        )
      }
    />
  );
}