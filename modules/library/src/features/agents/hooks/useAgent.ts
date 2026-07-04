import { useQuery } from '@tanstack/react-query';
import { getAgent } from '../api';
import type { AgentDetail } from '../schemas';

export const AGENT_DETAIL_KEY = 'agent-detail';

/**
 * Query hook for a single agent's detail view (drawer).
 * Enabled only when agentId is provided (non-empty string).
 *
 * The standalone `getAgent` returns `null` when Main Backend replies
 * `{ status: "error" }` (unknown id). We surface that as a query error so
 * the drawer renders its "Failed to load agent" branch instead of silently
 * showing a blank panel.
 */
export function useAgent(agentId: string | null | undefined) {
  return useQuery<AgentDetail>({
    queryKey: [AGENT_DETAIL_KEY, agentId],
    queryFn: async () => {
      const agent = await getAgent(agentId!);
      if (!agent) {
        throw new Error('Agent not found');
      }
      return agent;
    },
    enabled: Boolean(agentId),
    staleTime: 60_000,
  });
}
