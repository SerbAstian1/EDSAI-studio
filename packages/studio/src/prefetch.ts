import type { QueryClient } from '@tanstack/react-query';
import { api } from './api.js';
import type { Route } from './App.js';

/**
 * What each screen needs before it can show anything.
 *
 * A page transition that animates in the words "Loading clients…" is worse
 * than no transition: the movement draws the eye to a placeholder. So a
 * navigation warms the target screen's queries before the transition starts,
 * and by the time the new page is snapshotted it already has its content.
 *
 * **The duplication here is deliberate and bounded.** This restates which
 * queries a screen runs, which the screen itself also knows. The alternative —
 * making every screen suspend so React could hold the old page — means
 * converting every `useQuery` in the product and changing how loading and
 * errors work everywhere, to fix a flicker.
 *
 * The failure mode when this drifts is the one thing it was meant to prevent:
 * a screen whose queries changed shows its loading line for a moment. Nothing
 * renders wrong, nothing is fetched twice — TanStack serves a warm cache entry
 * to the screen that asks for it, and ignores one nobody asks for. A stale
 * entry here costs a flicker, which is exactly what it cost before.
 */
type Warm = { queryKey: readonly unknown[]; queryFn: () => Promise<unknown> };

function forRoute(route: Route): Warm[] {
  const runs: Warm = { queryKey: ['runs'], queryFn: api.runs };
  const clients: Warm = { queryKey: ['clients'], queryFn: api.clients };

  switch (route.screen) {
    case 'workspace':
    case 'runs':
    case 'brands':
    case 'portals':
    case 'activity':
      return [runs];

    case 'clients':
      return [clients];

    case 'assets':
      return [clients, { queryKey: ['assets'], queryFn: api.allAssets }];

    case 'settings':
      return [{ queryKey: ['rubric'], queryFn: api.rubric }];

    case 'client': {
      const id = route.clientId;
      if (!id) return [];
      return [
        { queryKey: ['client', id], queryFn: () => api.client(id) },
        { queryKey: ['brand', id], queryFn: () => api.brand(id) },
        { queryKey: ['assets', id], queryFn: () => api.assets(id) },
        { queryKey: ['portal-keys', id], queryFn: () => api.portalKeys(id) },
        { queryKey: ['onboardings', id], queryFn: () => api.onboardings(id) },
      ];
    }

    case 'run':
    case 'scorecard':
    case 'review':
    case 'finalize': {
      const id = route.runId;
      return id ? [{ queryKey: ['run', id], queryFn: () => api.run(id) }] : [];
    }

    // The intake form and the client-facing discovery flow load nothing the
    // shell can predict, and a planned section has nothing to load at all.
    default:
      return [];
  }
}

/**
 * Warm a route's data, giving up quickly.
 *
 * The cap is the point. Waiting for the network before moving would make a
 * slow connection feel like a broken button, which is a worse failure than the
 * flicker this exists to avoid. Past the deadline the page moves anyway and
 * the screen shows its own loading state, exactly as it did before.
 *
 * A prefetch that fails is not handled here: the screen runs the same query a
 * moment later and reports the error itself, in the place a person is looking.
 */
export const WARM_DEADLINE_MS = 250;

export function warmRoute(client: QueryClient, route: Route): Promise<unknown> {
  const work = forRoute(route).map((entry) => client.prefetchQuery({
    queryKey: entry.queryKey,
    queryFn: entry.queryFn,
    // Already-fresh data needs no request; this only fills genuine gaps.
    staleTime: 30_000,
  }));

  return Promise.race([
    Promise.allSettled(work),
    new Promise((resolve) => { setTimeout(resolve, WARM_DEADLINE_MS); }),
  ]);
}
