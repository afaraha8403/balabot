import {useEffect, useState} from 'react';

/**
 * Minimal History-API route reader for BalaBot (Wave 2).
 * Implements URL routing for /app, /app/:botId, /app/g/:groupId, and secondary views
 * with zero external dependencies, using standard window.location and window.history APIs.
 */

export type AppRoute =
  | { kind: 'app'; botId?: string }
  | { kind: 'group'; groupId: string }
  | { kind: 'artifacts'; artifactId?: string }
  | { kind: 'screen'; screen: string; botId?: string };

/**
 * Parses the current pathname and search query into an AppRoute.
 */
export function parseRoute(pathname: string, search: string = ''): AppRoute {
  // Normalize pathname: remove trailing slash if not root
  const clean = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  const searchParams = new URLSearchParams(search);
  const screenParam = searchParams.get('screen');

  if (screenParam) {
    return { kind: 'screen', screen: screenParam };
  }

  // /app/artifacts or /artifacts, optionally with /:artifactId
  if (clean === '/app/artifacts' || clean === '/artifacts') {
    return { kind: 'artifacts' };
  }
  if (clean.startsWith('/app/artifacts/')) {
    const artifactId = clean.slice('/app/artifacts/'.length).split('/')[0];
    return { kind: 'artifacts', artifactId: decodeURIComponent(artifactId) };
  }

  // /app/g/:groupId
  if (clean.startsWith('/app/g/')) {
    const groupId = clean.slice('/app/g/'.length).split('/')[0];
    if (groupId) {
      return { kind: 'group', groupId: decodeURIComponent(groupId) };
    }
  }

  // Secondary screens: /app/agents, /app/memory, etc.
  const knownScreens = ['agents', 'memory', 'decisions', 'governance', 'ops', 'cost'];
  for (const s of knownScreens) {
    if (clean === `/app/${s}` || clean === `/${s}`) {
      return { kind: 'screen', screen: s };
    }
  }

  // /app/:botId
  if (clean.startsWith('/app/')) {
    const botId = clean.slice('/app/'.length).split('/')[0];
    if (botId) {
      return { kind: 'app', botId: decodeURIComponent(botId) };
    }
  }

  // Default: /app or /
  return { kind: 'app' };
}

/**
 * Converts an AppRoute into a canonical URL pathname.
 */
export function routeToUrl(route: AppRoute): string {
  switch (route.kind) {
    case 'group':
      return `/app/g/${encodeURIComponent(route.groupId)}`;
    case 'artifacts':
      return route.artifactId
        ? `/app/artifacts/${encodeURIComponent(route.artifactId)}`
        : '/app/artifacts';
    case 'screen':
      return `/app/${encodeURIComponent(route.screen)}`;
    case 'app':
      return route.botId ? `/app/${encodeURIComponent(route.botId)}` : '/app';
  }
}

/**
 * Navigates to a new URL using the History API without page reload.
 */
export function navigateTo(url: string, options?: { replace?: boolean }) {
  if (typeof window === 'undefined') return;
  if (window.location.pathname + window.location.search === url) return;

  if (options?.replace) {
    window.history.replaceState({}, '', url);
  } else {
    window.history.pushState({}, '', url);
  }
  window.dispatchEvent(new Event('balabot:navigate'));
}

/**
 * React hook that subscribes to History API navigation events.
 */
export function useRoute(): [AppRoute, (url: string, options?: { replace?: boolean }) => void] {
  const [route, setRoute] = useState<AppRoute>(() => {
    if (typeof window === 'undefined') return { kind: 'app' };
    return parseRoute(window.location.pathname, window.location.search);
  });

  useEffect(() => {
    const update = () => {
      setRoute(parseRoute(window.location.pathname, window.location.search));
    };

    window.addEventListener('popstate', update);
    window.addEventListener('balabot:navigate', update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener('balabot:navigate', update);
    };
  }, []);

  return [route, navigateTo];
}
