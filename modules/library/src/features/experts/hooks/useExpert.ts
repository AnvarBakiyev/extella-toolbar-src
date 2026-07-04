import { useQuery } from '@tanstack/react-query';
import { usePairs } from '@/features/shared/useTopology';
import { getExpert } from '../api';
import type { ExpertDetail } from '../schemas';

export const EXPERT_DETAIL_KEY = 'expert-detail';

/**
 * Query hook for a single expert's detail view (drawer).
 * Enabled only when name is provided (non-empty string).
 *
 * Fans the lookup out across the same topology pairs the list uses
 * (see getExpert) so an expert living under a non-default (profile, agent)
 * pair still resolves when opened — otherwise the default-scope `/expert/get`
 * 404s any row created under another team/agent.
 */
export function useExpert(name: string | null | undefined) {
  const pairs = usePairs();
  return useQuery<ExpertDetail>({
    queryKey: [EXPERT_DETAIL_KEY, name, pairs.length],
    queryFn: () => getExpert(name!, pairs),
    enabled: Boolean(name),
    staleTime: 60_000,
  });
}
