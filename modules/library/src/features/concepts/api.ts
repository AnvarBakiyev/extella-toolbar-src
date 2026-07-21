/**
 * Concepts — direct-to-Main-Backend (Extella v0.6.11+) API surface.
 *
 * Wire contract — mirrors `apps/backend/src/main_backend/http.py` exactly so
 * the row shape we return matches what the admin-panel backend used to emit:
 *
 *   - POST /api/concept/list   body: `{}`
 *       Response: `{ results | items: [...] }`. NO server-side pagination
 *       or search — we slice and filter in-process via `paginate()` (same
 *       semantics as the admin-panel backend wrapper).
 *
 *   - POST /api/concept/add    body: `{ text }`
 *       Response: a single concept row (normalized via `normalizeConcept`).
 *
 *   - POST /api/concept/update body: `{ concept_id, new_text }`
 *       NOTE: the field is `new_text`, NOT `text`. Response: normalized concept.
 *
 *   - POST /api/concept/remove body: `{ concept_id }`
 *
 * Fan-out: when no scope is selected, the list call is fanned out across all
 * (profile, agent) topology pairs. Rows are tagged with the pair they came
 * from (profile_id / profile_name / agent_id / agent_name).
 */

import { mbPost } from '@/lib/api';
import { normalizeConcept, paginate } from '@/lib/normalize';
import { SEARCH_SIMILARITY_THRESHOLD, SEARCH_RESULT_LIMIT } from '@/lib/constants';
import { getCurrentAccountFallbackPair } from '@/lib/runtime';
import type { Concept, TopologyPair } from '@/lib/types';
import type { ConceptsListResponse, ListConceptsParams } from './schemas';

/* ─── list ─────────────────────────────────────────────────────── */

/**
 * POST /api/concept/list — paginated list with topology fan-out.
 *
 * When `pairs` contains a single entry (from a selected scope), only that
 * pair is fetched. Otherwise all pairs are fetched in parallel and merged.
 *
 * Search: when `q` is non-empty we hit `/api/concept/search` — the Main
 * Backend's semantic (embedding) search, which returns a `similarity` score
 * per hit. Weak matches below `SEARCH_SIMILARITY_THRESHOLD` are dropped and
 * the rest are ordered by similarity (most relevant first). When `q` is empty
 * we fall back to `/api/concept/list` (insertion order, no filtering).
 */
export async function listConcepts(
  params: ListConceptsParams = {},
  pairs: TopologyPair[] = [],
): Promise<ConceptsListResponse> {
  const { q, page = 1, page_size = 25 } = params;
  const qNorm = (q ?? '').trim();

  // Determine which pairs to fan out over.
  const scopedPairs = buildScopedPairs(pairs, params.profileId, params.agentId);

  // `Promise.all` keeps result order aligned to `scopedPairs` regardless of
  // which request resolves first; flattening yields a deterministic list. A
  // shared-array push would order rows by network-completion time, reshuffling
  // the list on every refetch and breaking client-side pagination.
  const perPair = await Promise.all(
    scopedPairs.map(async (pair) => {
      try {
        const body = qNorm
          ? await mbPost<unknown>('/api/concept/search', { query: qNorm, limit: SEARCH_RESULT_LIMIT }, {
              profileId: pair.profile_id,
              agentId: pair.agent_id,
            })
          : await mbPost<unknown>('/api/concept/list', {}, {
              profileId: pair.profile_id,
              agentId: pair.agent_id,
            });
        const raw = extractConceptList(body);
        return raw.map((entry) => normalizeConcept(entry, pair));
      } catch {
        // A single pair failing should not crash the whole list.
        return [] as Concept[];
      }
    }),
  );
  let allItems: Concept[] = perPair.flat();

  // Semantic search: drop weak hits, rank by relevance across all pairs, then
  // cap to the N most similar GLOBALLY. The backend `limit` bounds each
  // per-pair request; the fan-out merges several of them, so the overall cap
  // has to be re-applied here. (Server already filtered by meaning, so no
  // `haystack` substring pass.)
  if (qNorm) {
    allItems = allItems
      .filter((c) => c.similarity == null || c.similarity >= SEARCH_SIMILARITY_THRESHOLD)
      .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
      .slice(0, SEARCH_RESULT_LIMIT);
  }

  return paginate(allItems, { page, page_size });
}

/* ─── create ───────────────────────────────────────────────────── */

/**
 * POST /api/concept/add — create a new concept under the given pair.
 */
export async function createConcept(
  text: string,
  pair?: { profileId?: string; agentId?: string },
): Promise<Concept> {
  const body = await mbPost<unknown>('/api/concept/add', { text }, pair);
  return normalizeConcept(isRecord(body) ? body : {});
}

/* ─── update ───────────────────────────────────────────────────── */

/**
 * POST /api/concept/update — replace the text of an existing concept.
 *
 * The Main Backend field is `new_text`, not `text` — do NOT change this.
 */
export async function updateConcept(
  conceptId: string,
  text: string,
  pair?: { profileId?: string; agentId?: string },
): Promise<Concept> {
  const body = await mbPost<unknown>('/api/concept/update', {
    concept_id: conceptId,
    new_text: text,
  }, pair);
  return normalizeConcept(isRecord(body) ? body : {});
}

/* ─── delete ───────────────────────────────────────────────────── */

/**
 * POST /api/concept/remove — hard delete (no trash for concepts in v0.8.0).
 */
export async function deleteConcept(
  conceptId: string,
  pair?: { profileId?: string; agentId?: string },
): Promise<void> {
  await mbPost<unknown>('/api/concept/remove', { concept_id: conceptId }, pair);
}

/* ─── helpers ──────────────────────────────────────────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Build the list of pairs to fan out over:
 * - If a specific profileId+agentId are provided in params, return that one pair.
 * - If only profileId, return all agents in that profile.
 * - Otherwise return all pairs from topology (or the default pair if topology is empty).
 */
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

/**
 * Pull the concepts array out of the various response envelopes Main Backend
 * has used historically: `results` (v0.6.11), `items`. Returns an empty list
 * when no recognised key is present so the UI degrades to "no concepts yet"
 * rather than crashing.
 */
function extractConceptList(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) {
    return body.filter(isRecord);
  }
  if (!isRecord(body)) return [];
  const candidate = body.results ?? body.items;
  if (!Array.isArray(candidate)) return [];
  return candidate.filter(isRecord);
}
