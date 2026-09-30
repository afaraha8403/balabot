import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { parseRoute, routeToUrl, navigateTo, useRoute, type AppRoute } from '../router';

describe('router - Route Parsing, Building, and Round-trips', () => {
  const roundTripCases: Array<{ name: string; url: string; expectedRoute: AppRoute }> = [
    {
      name: '/app root',
      url: '/app',
      expectedRoute: { kind: 'app' },
    },
    {
      name: '/app/:botId',
      url: '/app/bot-executor-1',
      expectedRoute: { kind: 'app', botId: 'bot-executor-1' },
    },
    {
      name: '/app/:botId with URL encoding',
      url: '/app/special%20bot%20%231',
      expectedRoute: { kind: 'app', botId: 'special bot #1' },
    },
    {
      name: '/app/g/:groupId',
      url: '/app/g/group-engineering',
      expectedRoute: { kind: 'group', groupId: 'group-engineering' },
    },
    {
      name: '/app/artifacts gallery',
      url: '/app/artifacts',
      expectedRoute: { kind: 'artifacts' },
    },
    {
      name: '/app/artifacts/:artifactId',
      url: '/app/artifacts/art-contract-doc',
      expectedRoute: { kind: 'artifacts', artifactId: 'art-contract-doc' },
    },
    {
      name: '/app/fleet maps to agents screen',
      url: '/app/fleet',
      expectedRoute: { kind: 'screen', screen: 'agents' },
    },
    {
      name: '/app/cost screen',
      url: '/app/cost',
      expectedRoute: { kind: 'screen', screen: 'cost' },
    },
    {
      name: '/app/decisions screen',
      url: '/app/decisions',
      expectedRoute: { kind: 'screen', screen: 'decisions' },
    },
    {
      name: '/app/governance screen',
      url: '/app/governance',
      expectedRoute: { kind: 'screen', screen: 'governance' },
    },
    {
      name: '/app/memory screen',
      url: '/app/memory',
      expectedRoute: { kind: 'screen', screen: 'memory' },
    },
    {
      name: '/app/ops screen',
      url: '/app/ops',
      expectedRoute: { kind: 'screen', screen: 'ops' },
    },
  ];

  for (const { name, url, expectedRoute } of roundTripCases) {
    it(`correctly parses and round-trips ${name} (${url})`, () => {
      const parsed = parseRoute(url);
      expect(parsed).toEqual(expectedRoute);

      const builtUrl = routeToUrl(parsed);
      expect(builtUrl).toBe(url);

      const reparsed = parseRoute(builtUrl);
      expect(reparsed).toEqual(expectedRoute);
    });
  }

  describe('trailing slash handling', () => {
    it('normalizes trailing slashes properly for routes', () => {
      expect(parseRoute('/app/fleet/')).toEqual({ kind: 'screen', screen: 'agents' });
      expect(parseRoute('/app/cost/')).toEqual({ kind: 'screen', screen: 'cost' });
      expect(parseRoute('/app/artifacts/')).toEqual({ kind: 'artifacts' });
      expect(parseRoute('/app/')).toEqual({ kind: 'app' });
    });
  });

  describe('query parameter handling', () => {
    it('respects ?screen= query parameter', () => {
      expect(parseRoute('/app', '?screen=fleet')).toEqual({ kind: 'screen', screen: 'agents' });
      expect(parseRoute('/app', '?screen=cost')).toEqual({ kind: 'screen', screen: 'cost' });
      expect(parseRoute('/app', '?screen=ops')).toEqual({ kind: 'screen', screen: 'ops' });
    });
  });

  describe('unknown path fallback', () => {
    it('falls back sanely to { kind: "app" } on root or unknown paths', () => {
      expect(parseRoute('/')).toEqual({ kind: 'app' });
      expect(parseRoute('')).toEqual({ kind: 'app' });
      expect(parseRoute('/unknown-path')).toEqual({ kind: 'app' });
      expect(parseRoute('/random/sub/path')).toEqual({ kind: 'app' });
    });
  });
});

describe('router - useRoute hook & navigateTo', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    window.history.pushState({}, '', '/app');
  });

  afterEach(() => {
    window.history.pushState({}, '', '/app');
  });

  it('provides the current route from window.location', () => {
    window.history.pushState({}, '', '/app/fleet');
    const { result } = renderHook(() => useRoute());
    expect(result.current[0]).toEqual({ kind: 'screen', screen: 'agents' });
  });

  it('updates route reactively when navigateTo is called', () => {
    const { result } = renderHook(() => useRoute());
    expect(result.current[0]).toEqual({ kind: 'app' });

    act(() => {
      result.current[1]('/app/cost');
    });

    expect(window.location.pathname).toBe('/app/cost');
    expect(result.current[0]).toEqual({ kind: 'screen', screen: 'cost' });
  });

  it('updates route when popstate (browser back/forward) occurs', () => {
    const { result } = renderHook(() => useRoute());

    act(() => {
      window.history.pushState({}, '', '/app/ops');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(result.current[0]).toEqual({ kind: 'screen', screen: 'ops' });
  });

  it('supports replace mode in navigateTo', () => {
    const { result } = renderHook(() => useRoute());

    act(() => {
      navigateTo('/app/memory', { replace: true });
    });

    expect(window.location.pathname).toBe('/app/memory');
    expect(result.current[0]).toEqual({ kind: 'screen', screen: 'memory' });
  });
});
