/**
 * Rules API client — talks DIRECTLY to Main Backend (Extella) v0.6.11.
 *
 * Wire contract mirrors `apps/backend/src/main_backend/http.py` exactly:
 *   POST /api/rules/list   — body `{}`; response `{ results | rules: [...] }`
 *   POST /api/rules/add    — body `{ rule: string }`
 *   POST /api/rules/update — body `{ rule_id, rule }`
 *   POST /api/rules/remove — body `{ rule_id }`
 *
 * Fan-out: when no scope is selected, the list call is fanned out across all
 * (profile, agent) topology pairs. Rows tagged with their owning pair.
 */

import { mbPost } from '@/lib/api';
import { normalizeRule, paginate } from '@/lib/normalize';
import { getCurrentAccountFallbackPair } from '@/lib/runtime';
import type { Rule, TopologyPair } from '@/lib/types';
import type { RulesListResponse, ListRulesParams } from './schemas';

/* ─── Endpoint paths ────────────────────────────────────────────────── */

export const RULES_ENDPOINTS = {
  list: '/api/rules/list',
  add: '/api/rules/add',
  update: '/api/rules/update',
  remove: '/api/rules/remove',
} as const;

/* ─── Raw response envelope (loose by design) ──────────────────────── */

interface RawListEnvelope {
  results?: unknown;
  rules?: unknown;
}

function extractRawRules(body: RawListEnvelope | unknown): Record<string, unknown>[] {
  const b = body as RawListEnvelope;
  const raw = b.results ?? b.rules ?? [];
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is Record<string, unknown> =>
      typeof item === 'object' && item !== null,
  );
}

/* ─── scope helpers ─────────────────────────────────────────────────── */

function buildScopedPairs(
  pairs: TopologyPair[],
  profileId?: string,
  agentId?: string,
): TopologyPair[] {
  if (!pairs.length) {
    return getCurrentAccountFallbackPair();
  }
  if (profileId && agentId) {
    const match = pairs.find((p) => p.profile_id === profileId && p.agent_id === agentId);
    return match ? [match] : pairs;
  }
  if (profileId) {
    const filtered = pairs.filter((p) => p.profile_id === profileId);
    return filtered.length > 0 ? filtered : pairs;
  }
  return pairs;
}

/* ─── Rules CRUD ────────────────────────────────────────────────────── */

export async function listRules(
  params: ListRulesParams = {},
  pairs: TopologyPair[] = [],
): Promise<RulesListResponse> {
  const { page = 1, page_size = 25, q, profileId, agentId } = params;
  const scopedPairs = buildScopedPairs(pairs, profileId, agentId);

  // `Promise.all` preserves the order of `scopedPairs` in its result regardless
  // of which request resolves first, so flattening yields a deterministic order.
  // Pushing into a shared array from inside the map would instead order rows by
  // network-completion time, reshuffling the list on every refetch and breaking
  // client-side pagination (page 2 re-slices a differently-ordered array).
  const perPair = await Promise.all(
    scopedPairs.map(async (pair) => {
      try {
        const body = await mbPost<unknown>(RULES_ENDPOINTS.list, {}, {
          profileId: pair.profile_id,
          agentId: pair.agent_id,
        });
        return extractRawRules(body).map((r) => normalizeRule(r, pair));
      } catch {
        // Single pair failure should not crash the whole list.
        return [] as Rule[];
      }
    }),
  );
  const allItems: Rule[] = perPair.flat();

  const sliced = paginate(allItems, {
    page,
    page_size,
    search: q,
    haystack: (r) => r.text,
  });

  return {
    items: sliced.items,
    page: sliced.page,
    page_size: sliced.page_size,
    total: sliced.total,
    has_more: sliced.has_more,
    pinned_rule: null,
  };
}

export async function createRule(
  text: string,
  pair?: { profileId?: string; agentId?: string },
): Promise<Rule> {
  const body = await mbPost<Record<string, unknown>>(RULES_ENDPOINTS.add, {
    rule: text,
  }, pair);
  return normalizeRule(body);
}

export async function updateRule(
  ruleId: string,
  text: string,
  pair?: { profileId?: string; agentId?: string },
): Promise<Rule> {
  const body = await mbPost<Record<string, unknown>>(RULES_ENDPOINTS.update, {
    rule_id: ruleId,
    rule: text,
  }, pair);
  return normalizeRule(body);
}

export async function deleteRule(
  ruleId: string,
  pair?: { profileId?: string; agentId?: string },
): Promise<void> {
  await mbPost(RULES_ENDPOINTS.remove, { rule_id: ruleId }, pair);
}
