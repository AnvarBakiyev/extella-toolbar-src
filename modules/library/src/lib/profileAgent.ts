/**
 * Pure helpers for profile+agent grouping and filtering.
 * Used by ProfileAgentFilter and the Agents grouped-layout page.
 */

import type { ProfileAgentLabel, Topology, TopologyPair } from './types';

/**
 * Group a labeled flat list by profile_id, returning a Map from profile_id
 * to { profile_id, profile_name, items }.
 *
 * Items without a profile_id are grouped under the '' (empty string) key.
 * Order is insertion-stable: the first occurrence of a profile sets its position.
 */
export function groupByProfile<T extends ProfileAgentLabel>(
  items: T[],
  topology?: Topology,
): Map<string, { profile_id: string; profile_name: string; items: T[] }> {
  const result = new Map<string, { profile_id: string; profile_name: string; items: T[] }>();

  // Pre-populate profile order from topology so even empty profiles appear in
  // the right order when the filter renders group headers.
  if (topology) {
    for (const p of topology.profiles) {
      result.set(p.profile_id, { profile_id: p.profile_id, profile_name: p.profile_name, items: [] });
    }
  }

  for (const item of items) {
    const pid = item.profile_id ?? '';
    const pname = (item.profile_name ?? pid) || 'Unknown profile';
    if (!result.has(pid)) {
      result.set(pid, { profile_id: pid, profile_name: pname, items: [] });
    }
    result.get(pid)!.items.push(item);
  }

  return result;
}

/**
 * Filter a labeled flat list to a specific (profileId, agentId) scope.
 * - Both provided → exact match.
 * - Only profileId → all items in that profile.
 * - Neither → return all items unchanged.
 */
export function filterByScope<T extends ProfileAgentLabel>(
  items: T[],
  scope: { profileId?: string; agentId?: string },
): T[] {
  const { profileId, agentId } = scope;
  if (!profileId && !agentId) return items;
  return items.filter((item) => {
    if (profileId && item.profile_id !== profileId) return false;
    if (agentId && item.agent_id !== agentId) return false;
    return true;
  });
}

/**
 * Build a flat list of pairs from a topology object.
 */
export function topologyToPairs(topology: Topology): TopologyPair[] {
  return topology.profiles.flatMap((p) =>
    p.agents.map((a) => ({
      profile_id: p.profile_id,
      profile_name: p.profile_name,
      agent_id: a.agent_id,
      agent_name: a.agent_name,
    })),
  );
}
