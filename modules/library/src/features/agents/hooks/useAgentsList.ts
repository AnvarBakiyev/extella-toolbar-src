import { useQuery } from '@tanstack/react-query';
import { useDebounce } from '@/hooks/useDebounce';
import { useAgentTopology } from '@/features/shared/useTopology';
import { listAgents } from '../api';
import type { ListAgentsParams, PaginatedAgents } from '../schemas';

export const AGENTS_LIST_KEY = 'agents-list';

/**
 * Query hook for the paginated agents list.
 *
 * §5b VERIFIED MODEL — single call, membership-based grouping:
 *  - q is debounced 500ms.
 *  - No placeholderData (same as Concepts) so a new search never shows the
 *    previous query's rows while the next loads.
 *  - Uses useAgentTopology() to get teams (for membership grouping).
 *    listAgents calls /api/agent/list ONCE; groups by team membership.
 *
 * Filter (provider) and sort (key/dir) are forwarded to
 * `listAgents` so they apply CATALOGUE-WIDE.
 */
export function useAgentsList(params: ListAgentsParams = {}) {
  const {
    q,
    page = 1,
    page_size = 25,
    providers,
    sort_key = 'recent',
    sort_dir = 'desc',
    profileId,
    agentId,
  } = params;
  const debouncedQ = useDebounce(q ?? '', 500);
  const { data: agentTopology } = useAgentTopology();
  const teams = agentTopology?.teams ?? [];

  const providersKey = providers && providers.length > 0 ? [...providers].sort() : [];

  const query = useQuery<PaginatedAgents>({
    queryKey: [
      AGENTS_LIST_KEY,
      {
        q: debouncedQ,
        page,
        page_size,
        providers: providersKey,
        sort_key,
        sort_dir,
        profileId,
        agentId,
        // Include team count in key so the query re-runs when topology resolves.
        teamsCount: teams.length,
      },
    ],
    queryFn: () =>
      listAgents(
        {
          q: debouncedQ || undefined,
          page,
          page_size,
          providers: providersKey.length > 0 ? providersKey : undefined,
          sort_key,
          sort_dir,
          profileId,
          agentId,
        },
        [], // pairs not used by listAgents anymore; kept for API compat
        teams,
      ),
    // No placeholderData — same as Concepts. A new search shows the loading
    // state instead of the previous search's rows, so stale results never
    // linger at the top of a fresh query.
    staleTime: 30_000,
    // Always enabled — we don't need pairs to be ready; listAgents calls /api/agent/list once.
    enabled: true,
  });

  // True from the first keystroke (debounce window) through the network
  // round-trip, but only while there is an actual query term — so the search
  // box can show an in-progress spinner.
  const isSearching =
    ((q ?? '').trim() !== '' && (q ?? '') !== debouncedQ) ||
    (debouncedQ.trim() !== '' && query.isFetching);

  return { ...query, isSearching };
}
