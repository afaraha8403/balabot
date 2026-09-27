import {useEffect, useState} from 'react';
import type {Available} from './api';

/**
 * One fetch, four honest phases. No screen may quietly substitute sample data:
 *   loading     -- a request is in flight
 *   ready       -- the API returned real data
 *   unavailable -- the API said available:false, with a reason
 *   error       -- the request itself failed
 */
export type ApiState<T> =
  | {phase: 'loading'}
  | {phase: 'ready'; data: T}
  | {phase: 'unavailable'; reason: string}
  | {phase: 'error'; message: string};

export function useApiData<T extends Available>(fetcher: () => Promise<T>): ApiState<T> {
  const [state, setState] = useState<ApiState<T>>({phase: 'loading'});

  useEffect(() => {
    let live = true;
    setState({phase: 'loading'});
    fetcher()
      .then((data) => {
        if (!live) return;
        if (data && data.available === false) {
          setState({phase: 'unavailable', reason: data.reason ?? 'the API reports no data for this surface'});
        } else {
          setState({phase: 'ready', data});
        }
      })
      .catch((e: unknown) => {
        if (!live) return;
        const message = e instanceof Error ? e.message : String(e);
        setState({phase: 'error', message});
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}