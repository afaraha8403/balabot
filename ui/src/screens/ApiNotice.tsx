import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Skeleton} from '@astryxdesign/core/Skeleton';
import {VStack} from '@astryxdesign/core/VStack';
import {LayoutContent} from '@astryxdesign/core/Layout';
import {IconInfo, IconWarning} from '../icons';
import type {ApiState} from '../useApiData';

/**
 * Renders the loading / unavailable / error phases of a screen so every surface
 * reports absence the same way: honestly, with the API's own reason shown.
 * Returns null when there is real data for the caller to render.
 *
 * Built from the framework's own phase components rather than bespoke markup.
 * Astryx draws a line between the two loading affordances: Skeleton "previews
 * the shape of content while it loads", Spinner is for content of unknown
 * dimensions — and it is explicit that you must not pair a Spinner with a
 * Skeleton over the same area. A screen body is a known shape, so it gets
 * Skeleton rows and no spinner. For the empty and failed phases the framework's
 * EmptyState carries title + description + icon, which is what "no data" is
 * meant to look like; hand-rolling that as a Token + two Texts is the kind of
 * parallel implementation that drifts from the design system over time.
 */
export function ApiNotice({state}: {state: ApiState<unknown>}) {
  if (state.phase === 'loading') {
    return (
      <LayoutContent padding={4}>
        <VStack gap={3}>
          {/* A heading line and body lines — the shape of a data screen. */}
          <Skeleton height={24} width="40%" index={0} />
          <Skeleton height={16} width="100%" index={1} />
          <Skeleton height={16} width="92%" index={2} />
          <Skeleton height={16} width="96%" index={3} />
          <Skeleton height={16} width="70%" index={4} />
        </VStack>
      </LayoutContent>
    );
  }

  if (state.phase === 'unavailable') {
    return (
      <LayoutContent padding={4}>
        <EmptyState
          title="Nothing to show yet"
          description={state.reason}
          icon={<IconInfo />}
        />
      </LayoutContent>
    );
  }

  if (state.phase === 'error') {
    return (
      <LayoutContent padding={4}>
        <EmptyState
          title="Could not reach the API"
          description={state.message}
          icon={<IconWarning />}
        />
      </LayoutContent>
    );
  }

  return null;
}
