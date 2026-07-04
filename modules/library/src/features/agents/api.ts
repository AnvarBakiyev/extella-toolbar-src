import { mbPost } from '@/lib/api';
import { normalizeAgent, paginate } from '@/lib/normalize';
import type { AgentRow, Paginated, TopologyPair } from '@/lib/types';
import type { RawTeam, RawAgent } from '@/features/shared/useTopology';
import {
  normalizeProvider,
  type ListAgentsParams,
  type PaginatedAgents,
  type AgentDetail,
  type AgentSortKey,
  type AgentSortDir,
} from './schemas';

/**
 * Direct-to-Main-Backend (Extella v0.8.0) API surface for Agents.
 *
 * §5b VERIFIED MODEL — single call, membership-based grouping:
 *   - POST /api/agent/list {} (empty body) → ALL agents.
 *     The profile_id filter is BROKEN server-side; never use it.
 *   - Membership is determined by comparing agent.id to team.agent_ids.
 *   - Tag each agent with its membership profile:
 *       agent ∈ no team  → profile_id="default", profile_name="Default"
 *       agent ∈ team     → team's profile_id / profile_name
 *   - An agent belongs to at most one team (first match wins).
 *
 * Fan-out for entity sections (concepts, rules, experts, kv, devices, tokens)
 * is handled by usePairs() in those features' hooks — NOT here. This file is
 * agents-only.
 */

/* ─── list (single call + membership grouping) ─────────────────── */

/**
 * POST /api/agent/list — single call, group by team membership.
 *
 * Pipeline:
 *   1. Fetch ALL agents with one empty-body call.
 *   2. Tag each agent with its membership profile using the provided teams.
 *   3. Apply provider filter, sort.
 *   4. Search + paginate.
 *
 * `teams` is supplied from useAgentTopology() so we don't need a second
 * network call here. When teams is empty, all agents fall under Default.
 */
export async function listAgents(
  params: ListAgentsParams = {},
  _pairs: TopologyPair[] = [], // kept for API compatibility; unused — we use teams
  teams: RawTeam[] = [],
): Promise<PaginatedAgents> {
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

  // ── 1. Fetch ALL agents in one call (empty body = no profile filter) ──
  let allRaw: Record<string, unknown>[] = [];
  try {
    const body = await mbPost<unknown>('/api/agent/list', {});
    allRaw = extractAgentList(body);
  } catch {
    // Network failure — return empty list.
    return paginate([], { page, page_size }) as PaginatedAgents;
  }

  // ── 2. Build membership lookup: agent_id → { profile_id, profile_name } ──
  // An agent belongs to the FIRST team that claims it (agent_ids are disjoint
  // in practice, but first-match avoids ambiguity if they ever overlap).
  const membershipMap = buildMembershipMap(teams);

  // ── 3. Tag each agent with its membership profile ──
  let items: AgentRow[] = allRaw.map((entry) => {
    const rawId = String(entry.agent_id ?? entry.id ?? '');
    const membership = membershipMap.get(rawId) ?? {
      profile_id: 'default',
      profile_name: 'Default',
    };
    const pair: TopologyPair = {
      profile_id: membership.profile_id,
      profile_name: membership.profile_name,
      agent_id: rawId,
      agent_name: String(entry.agent_name ?? entry.name ?? ''),
    };
    return normalizeAgent(entry, pair);
  });

  // ── 4. Scope filter (when ProfileAgentFilter has a selection) ──
  if (profileId) {
    items = items.filter((row) => row.profile_id === profileId);
  }
  if (agentId) {
    items = items.filter((row) => row.id === agentId || row.agent_id === agentId);
  }

  // ── 5. Provider filter ──
  if (providers && providers.length > 0) {
    const allowed = new Set(providers);
    items = items.filter((row) => allowed.has(normalizeProvider(row.provider)));
  }

  // ── 6. Sort (catalogue-wide, before search/pagination) ──
  items = sortAgents(items, sort_key, sort_dir);

  // ── 7. Search + paginate ──
  const result: Paginated<AgentRow> = paginate(items, {
    page,
    page_size,
    search: q,
    haystack: (a) =>
      [a.name, a.description ?? '', a.provider ?? '', a.model ?? '', a.tools.join(' ')]
        .join(' ')
        .trim(),
  });

  return result;
}

/* ─── listAgentsMembership ─────────────────────────────────────── */

/**
 * Fetch ALL agents and attach their membership group.
 * Used internally by useAgentsList when teams are available from useAgentTopology.
 *
 * Returns agents tagged with profile_id / profile_name matching their team
 * (or "default" / "Default" if not in any team).
 *
 * This is a thin wrapper over listAgents that exposes all items without
 * pagination — used for the grouped layout which renders the full set.
 */
export async function listAllAgentsMembership(
  teams: RawTeam[],
  allAgents: RawAgent[],
): Promise<AgentRow[]> {
  const membershipMap = buildMembershipMap(teams);

  return allAgents.map((a) => {
    const membership = membershipMap.get(a.agent_id) ?? {
      profile_id: 'default',
      profile_name: 'Default',
    };
    const pair: TopologyPair = {
      profile_id: membership.profile_id,
      profile_name: membership.profile_name,
      agent_id: a.agent_id,
      agent_name: a.agent_name,
    };
    // We already have normalized names from useAgentTopology, but we still
    // call normalizeAgent so all the other AgentRow fields are properly set.
    const raw: Record<string, unknown> = {
      id: a.agent_id,
      name: a.agent_name,
    };
    return normalizeAgent(raw, pair);
  });
}

/* ─── get ──────────────────────────────────────────────────────── */

/**
 * POST /api/agent/get — single agent detail.
 */
export async function getAgent(agentId: string): Promise<AgentDetail | null> {
  const body = await mbPost<unknown>('/api/agent/get', { agent_id: agentId });

  if (!isRecord(body)) return null;
  if (body.status === 'error') return null;

  const raw = isRecord(body.agent) ? body.agent : body;
  if (!isRecord(raw)) return null;

  return normalizeAgent(raw);
}

/* ─── delete ───────────────────────────────────────────────────── */

/**
 * POST /api/agent/delete — hard delete (no trash for agents in v0.8.0).
 */
export async function deleteAgent(
  agentId: string,
  pair?: { profileId?: string; agentId?: string },
): Promise<void> {
  await mbPost<unknown>('/api/agent/delete', { agent_id: agentId }, pair);
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Build a map from agent_id → { profile_id, profile_name } based on
 * team membership (first team that claims the agent wins).
 * Agents not in the map belong to the implicit Default profile.
 */
function buildMembershipMap(
  teams: RawTeam[],
): Map<string, { profile_id: string; profile_name: string }> {
  const map = new Map<string, { profile_id: string; profile_name: string }>();
  for (const team of teams) {
    for (const agentId of team.agent_ids) {
      if (!map.has(agentId)) {
        map.set(agentId, {
          profile_id: team.profile_id,
          profile_name: team.profile_name,
        });
      }
    }
  }
  return map;
}

/**
 * Sort the full agent list by the requested key/direction.
 */
function sortAgents(items: AgentRow[], key: AgentSortKey, dir: AgentSortDir): AgentRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  const copy = [...items];

  if (key === 'recent') {
    copy.sort((a, b) => {
      const aMissing = !a.created_at;
      const bMissing = !b.created_at;
      if (aMissing && bMissing) return 0;
      if (aMissing) return 1;
      if (bMissing) return -1;
      const ta = a.created_at as string;
      const tb = b.created_at as string;
      if (ta === tb) return 0;
      return sign * (ta < tb ? -1 : 1);
    });
    return copy;
  }

  if (key === 'name') {
    copy.sort((a, b) => sign * a.name.localeCompare(b.name));
    return copy;
  }

  if (key === 'provider') {
    copy.sort((a, b) => sign * (a.provider ?? '').localeCompare(b.provider ?? ''));
    return copy;
  }

  // key === 'tools'
  copy.sort((a, b) => sign * (a.tools.length - b.tools.length));
  return copy;
}

/**
 * Pull the agent array out of the various response envelopes.
 */
function extractAgentList(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) {
    return body.filter(isRecord);
  }
  if (!isRecord(body)) return [];
  const candidate = body.agents ?? body.results ?? body.items;
  if (!Array.isArray(candidate)) return [];
  return candidate.filter(isRecord);
}
