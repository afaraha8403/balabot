import {VStack} from '@astryxdesign/core/VStack';
import {Text} from '@astryxdesign/core/Text';
import {Token} from '@astryxdesign/core/Token';
import {Spinner} from '@astryxdesign/core/Spinner';
import {LayoutContent} from '@astryxdesign/core/Layout';
import type {ApiState} from '../useApiData';

/**
 * Renders the loading / unavailable / error phases of a screen so every surface
 * reports absence the same way: honestly, with the API's own reason shown.
 * Returns null when there is real data for the caller to render.
 */
export function ApiNotice({state}: {state: ApiState<unknown>}) {
  if (state.phase === 'loading') {
    return (
      <LayoutContent padding={4}>
        <VStack gap={2} align="center">
          <Spinner size="sm" />
          <Text type="supporting">Loading…</Text>
        </VStack>
      </LayoutContent>
    );
  }

  if (state.phase === 'unavailable') {
    return (
      <LayoutContent padding={4}>
        <VStack gap={2}>
          <Token label="No data" size="sm" color="gray" />
          <Text type="body" weight="semibold">
            Nothing to show yet
          </Text>
          <Text type="supporting">{state.reason}</Text>
        </VStack>
      </LayoutContent>
    );
  }

  if (state.phase === 'error') {
    return (
      <LayoutContent padding={4}>
        <VStack gap={2}>
          <Token label="Request failed" size="sm" color="red" />
          <Text type="body" weight="semibold">
            Could not reach the API
          </Text>
          <Text type="supporting">{state.message}</Text>
        </VStack>
      </LayoutContent>
    );
  }

  return null;
}