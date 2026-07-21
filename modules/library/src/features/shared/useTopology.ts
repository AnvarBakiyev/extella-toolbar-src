/**
 * useTopology — builds the canonical topology (profiles → agents) by calling
 * Main Backend directly.
 *
 * §5b VERIFIED MODEL (v2) — supersedes the v1 per-profile fan-out assumption:
 *
 *   1. POST /api/profile/list {} → user-created teams only
 *      Each row: { profile_id, profile_name, agent_ids: string[], master_agent_id }.
 *      NOTE: returns NO "default" entry — Default is synthetic.
 *
 *   2. POST /api/agent/list {}   → ALL agents (empty body).
 *      The profile_id body filter is BROKEN (returns []); never use it.
 *      Membership is determined by team.agent_ids, not the response header.
 *
 *   3. Assembled topology (nested):
 *        profiles = [
 *          { profile_id:"default", profile_name:"Default", agents: ALL agents },
 *          ...teams each { profile_id, profile_name, agents: member agents }
 *        ]
 *      Default lists ALL agents so the filter can scope default/<any agent>.
 *
 *   4. Entity fan-out pairs (from usePairs):
 *        (default, A) for every agent A
 *        ∪ (team.profile_id, A) for each team, for each A in team.agent_ids
 *      Disjoint per pair — no deduplication needed beyond natural membership.
 *
 *   5. Fallback: when enumeration returns nothing, seed only the account agent
 *      supplied by the host. With no host agent, remain empty rather than
 *      issuing cross-account calls under a fabricated id.
 *
 * Also exports:
 *  - `useTopology()` — the canonical nested topology.
 *  - `usePairs()`    — flat list of TopologyPair objects for entity fan-out loops.
 *  - `useAgentTopology()` — raw teams + agents for the Agents grouped page.
 */

import { useQuery } from '@tanstack/react-query';
import { mbPost } from '@/lib/api';
import type { Topology, TopologyPair } from '@/lib/types';
import { DEFAULT_PROFILE_ID, DEFAULT_AGENT_ID } from '@/lib/runtime';

/* ─── types ─────────────────────────────────────────────────────── */

/** A single team as returned by /api/profile/list. */
export interface RawTeam {
  profile_id: string;
  profile_name: string;
  agent_ids: string[];
  master_agent_id: string | null;
}

/** A single agent as returned by /api/agent/list. */
export interface RawAgent {
  agent_id: string;
  agent_name: string;
}

/** Full agent topology data — teams + all agents. Used by the Agents page. */
export interface AgentTopologyData {
  teams: RawTeam[];
  agents: RawAgent[];
  /** Map from agent_id → agent_name for fast lookups. */
  agentMap: Map<string, string>;
}

/* ─── fallback ──────────────────────────────────────────────────── */

const FALLBACK_AGENTS: RawAgent[] = DEFAULT_AGENT_ID
  ? [{ agent_id: DEFAULT_AGENT_ID, agent_name: 'Current account agent' }]
  : [];

const FALLBACK_TOPOLOGY: Topology = {
  profiles: [
    {
      profile_id: DEFAULT_PROFILE_ID,
      profile_name: 'Default',
      agents: FALLBACK_AGENTS,
    },
  ],
};

const FALLBACK_AGENT_TOPOLOGY: AgentTopologyData = {
  teams: [],
  agents: FALLBACK_AGENTS,
  agentMap: new Map(FALLBACK_AGENTS.map((agent) => [agent.agent_id, agent.agent_name])),
};

/* ─── defensive field normalization ────────────────────────────── */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function extractArray(body: unknown, ...keys: string[]): Record<string, unknown>[] {
  if (Array.isArray(body)) return body.filter(isRecord);
  if (!isRecord(body)) return [];
  for (const k of keys) {
    const candidate = body[k];
    if (Array.isArray(candidate)) return candidate.filter(isRecord);
  }
  return [];
}

/** Normalize a profile/team row defensively. */
function normalizeTeam(row: Record<string, unknown>): RawTeam {
  const profile_id = String(row.profile_id ?? row.id ?? '');
  const profile_name = String(row.profile_name ?? row.name ?? '') || profile_id;

  // agent_ids: may be missing, may be an array of strings or ints.
  let agent_ids: string[] = [];
  if (Array.isArray(row.agent_ids)) {
    agent_ids = (row.agent_ids as unknown[]).map(String);
  } else if (Array.isArray(row.agents)) {
    // Fallback: some API versions nest agent objects instead of id-only list.
    agent_ids = (row.agents as unknown[])
      .filter(isRecord)
      .map((a) => String(a.agent_id ?? a.id ?? ''));
  }

  const master_agent_id =
    row.master_agent_id != null ? String(row.master_agent_id) : null;

  return { profile_id, profile_name, agent_ids, master_agent_id };
}

/** Normalize an agent row defensively. */
function normalizeAgentRow(row: Record<string, unknown>): RawAgent {
  return {
    agent_id: String(row.agent_id ?? row.id ?? ''),
    agent_name: String(row.agent_name ?? row.name ?? ''),
  };
}

/* ─── fetch (combined) ──────────────────────────────────────────── */

/**
 * Fetches both teams and all agents in parallel, then assembles the canonical
 * topology + raw data. One call per API — no per-profile fan-out.
 */
async function fetchCombined(): Promise<{ topology: Topology; raw: AgentTopologyData }> {
  // Fire both calls in parallel.
  const [teamsBody, agentsBody] = await Promise.allSettled([
    mbPost<unknown>('/api/profile/list', {}),
    mbPost<unknown>('/api/agent/list', {}),
  ]);

  // Extract teams.
  const teamsRaw: Record<string, unknown>[] =
    teamsBody.status === 'fulfilled'
      ? extractArray(teamsBody.value, 'profiles', 'results', 'items')
      : [];

  const teams: RawTeam[] = teamsRaw
    .map(normalizeTeam)
    .filter((t) => t.profile_id !== '');

  // Extract all agents (empty body = no profile filter).
  const agentsRaw: Record<string, unknown>[] =
    agentsBody.status === 'fulfilled'
      ? extractArray(agentsBody.value, 'agents', 'results', 'items')
      : [];

  const agents: RawAgent[] = agentsRaw
    .map(normalizeAgentRow)
    .filter((a) => a.agent_id !== '');

  // When we got nothing at all, return the fallback.
  if (agents.length === 0 && teams.length === 0) {
    return { topology: FALLBACK_TOPOLOGY, raw: FALLBACK_AGENT_TOPOLOGY };
  }

  // Build agent map: id → name for quick membership resolution.
  const agentMap = new Map<string, string>(agents.map((a) => [a.agent_id, a.agent_name]));

  // If the default agent isn't in the list, add it to the map so entity
  // fan-out still works for pre-existing data under that id.
  if (DEFAULT_AGENT_ID && !agentMap.has(DEFAULT_AGENT_ID)) {
    agentMap.set(DEFAULT_AGENT_ID, 'Current account agent');
  }

  // Build the nested topology:
  //   profiles[0] = Default (contains ALL agents)
  //   profiles[1..n] = each team with its member agents resolved
  const defaultProfile = {
    profile_id: DEFAULT_PROFILE_ID,
    profile_name: 'Default',
    // All agents live under "default" for the purposes of the filter/entity fan-out.
    agents:
      agents.length > 0
        ? agents
        : FALLBACK_AGENTS,
  };

  const teamProfiles = teams.map((team) => ({
    profile_id: team.profile_id,
    profile_name: team.profile_name,
    agents: team.agent_ids
      .filter((id) => agentMap.has(id))
      .map((id) => ({ agent_id: id, agent_name: agentMap.get(id) ?? id })),
  }));

  const topology: Topology = { profiles: [defaultProfile, ...teamProfiles] };

  const raw: AgentTopologyData = { teams, agents, agentMap };

  return { topology, raw };
}

/* ─── query key ─────────────────────────────────────────────────── */

const TOPOLOGY_QUERY_KEY = ['topology'] as const;

/* ─── useTopology ────────────────────────────────────────────────── */

export function useTopology() {
  return useQuery<Topology>({
    queryKey: [...TOPOLOGY_QUERY_KEY, 'nested'],
    queryFn: async () => {
      const { topology } = await fetchCombined();
      return topology;
    },
    staleTime: 5 * 60_000, // 5 min — topology changes infrequently
    gcTime: 10 * 60_000,
    placeholderData: FALLBACK_TOPOLOGY,
  });
}

/* ─── useAgentTopology ───────────────────────────────────────────── */

/**
 * Returns raw teams + all agents for the Agents grouped page.
 * Groups agents by membership: agents not in any team → Default;
 * agents in a team → that team.
 *
 * Shares the same underlying fetch as useTopology via a sibling query key.
 */
export function useAgentTopology() {
  return useQuery<AgentTopologyData>({
    queryKey: [...TOPOLOGY_QUERY_KEY, 'raw'],
    queryFn: async () => {
      const { raw } = await fetchCombined();
      return raw;
    },
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    placeholderData: FALLBACK_AGENT_TOPOLOGY,
  });
}

/* ─── usePairs ──────────────────────────────────────────────────── */

/**
 * Flattened entity fan-out pairs derived from the VERIFIED MODEL (§5b):
 *
 *   pairs = { (default, A) for every agent A }
 *           ∪ { (team.profile_id, A) for each team, for each A in team.agent_ids }
 *
 * The Default profile entry already lists ALL agents, so iterating over
 * profiles[0].agents gives (default, every_agent) naturally. The team profiles
 * list only member agents, giving the team pairs.
 *
 * Empty fallback uses the host-provided current-account agent only.
 */
export function usePairs(): TopologyPair[] {
  const { data } = useTopology();
  const topology = data ?? FALLBACK_TOPOLOGY;

  const pairs = topology.profiles.flatMap((p) =>
    p.agents.map((a) => ({
      profile_id: p.profile_id,
      profile_name: p.profile_name,
      agent_id: a.agent_id,
      agent_name: a.agent_name,
    })),
  );

  // Safety net: if topology resolved to completely empty (e.g. network error
  // AND placeholder didn't fire), still return the default pair so fan-out
  // does not skip all entities.
  if (pairs.length === 0) {
    return DEFAULT_AGENT_ID ? [
      {
        profile_id: DEFAULT_PROFILE_ID,
        profile_name: 'Default',
        agent_id: DEFAULT_AGENT_ID,
        agent_name: 'Current account agent',
      },
    ] : [];
  }

  return pairs;
}
