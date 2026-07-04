/**
 * useTeams — read-only access to "agent teams" (backend profiles).
 *
 * A team is a profile returned by `/api/profile/list` (see useAgentTopology):
 *   { profile_id, profile_name, agent_ids[], master_agent_id }
 *
 * The backend exposes teams READ-ONLY — there is no create/update/delete or
 * add/remove-member endpoint — so this hook only reads. It wraps
 * `useAgentTopology()` (shared with the Agents section, same cached query) and
 * layers convenience lookups on top:
 *   - getTeam(profileId)      → the RawTeam or undefined
 *   - teamsOfAgent(agentId)   → every team that lists the agent
 *   - agentName(agentId)      → resolved display name
 */

import { useMemo } from 'react';
import { useAgentTopology, type RawTeam } from '@/features/shared/useTopology';

export interface UseTeamsResult {
  teams: RawTeam[];
  agentMap: Map<string, string>;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  getTeam: (profileId: string) => RawTeam | undefined;
  teamsOfAgent: (agentId: string) => RawTeam[];
  agentName: (agentId: string) => string;
}

export function useTeams(): UseTeamsResult {
  const { data, isLoading, isError, refetch } = useAgentTopology();

  const teams = data?.teams ?? [];
  const agentMap = data?.agentMap ?? new Map<string, string>();

  return useMemo<UseTeamsResult>(
    () => ({
      teams,
      agentMap,
      isLoading,
      isError,
      refetch: () => void refetch(),
      getTeam: (profileId: string) => teams.find((t) => t.profile_id === profileId),
      teamsOfAgent: (agentId: string) =>
        teams.filter((t) => t.agent_ids.includes(agentId)),
      agentName: (agentId: string) => agentMap.get(agentId) ?? agentId,
    }),
    [teams, agentMap, isLoading, isError, refetch],
  );
}
