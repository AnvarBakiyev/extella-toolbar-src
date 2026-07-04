import { useQuery } from '@tanstack/react-query';
import { useDebounce } from '@/hooks/useDebounce';
import { usePairs } from '@/features/shared/useTopology';
import { listExperts } from '../api';
import type { ListExpertsParams, PaginatedExperts } from '../schemas';

export const EXPERTS_LIST_KEY = 'experts-list';

/**
 * Query hook for the paginated experts list.
 * - q is debounced 500ms so we don't fire on every keystroke.
 * - Fan-out over topology pairs via usePairs().
 */
export function useExpertsList(params: ListExpertsParams = {}) {
  const {
    q,
    page = 1,
    page_size = 25,
    scope = 'mine',
    types,
    sort_key = 'recent',
    sort_dir = 'desc',
    profileId,
    agentId,
  } = params;
  const debouncedQ = useDebounce(q ?? '', 500);
  const pairs = usePairs();

  const typesKey = Array.isArray(types) && types.length > 0
    ? [...types].sort().join(',')
    : '';

  const query = useQuery<PaginatedExperts>({
    queryKey: [
      EXPERTS_LIST_KEY,
      { q: debouncedQ, page, page_size, scope, types: typesKey, sort_key, sort_dir, profileId, agentId, pairsCount: pairs.length },
    ],
    queryFn: () =>
      listExperts({
        q: debouncedQ || undefined,
        page,
        page_size,
        scope,
        types,
        sort_key,
        sort_dir,
        profileId,
        agentId,
      }, pairs),
    // No placeholderData — same as Concepts. A new search shows the loading
    // state instead of the previous search's rows, so stale results never
    // linger at the top of a fresh query.
    staleTime: 30_000,
    enabled: pairs.length > 0,
  });

  // True from the first keystroke (debounce window) through the network
  // round-trip, but only while there is an actual query term — so the search
  // box can show an in-progress spinner.
  const isSearching =
    ((q ?? '').trim() !== '' && (q ?? '') !== debouncedQ) ||
    (debouncedQ.trim() !== '' && query.isFetching);

  return { ...query, isSearching };
}
