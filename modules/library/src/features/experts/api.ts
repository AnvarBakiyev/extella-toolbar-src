import { mbPost, mbPostAs, type ScopeOverride } from '@/lib/api';
import type { TopologyPair } from '@/lib/types';
import { normalizeExpert, paginate } from '@/lib/normalize';
import { SEARCH_SIMILARITY_THRESHOLD, SEARCH_RESULT_LIMIT } from '@/lib/constants';
import type { ExpertRow } from '@/lib/types';
import {
  paginatedExpertsSchema,
  expertDetailSchema,
  trashListSchema,
  trashClearSchema,
  trashRestoreSchema,
  runExpertResultSchema,
  taskStatusResultSchema,
  shareExpertResultSchema,
  deriveExpertType,
  type PaginatedExperts,
  type ExpertDetail,
  type ListExpertsParams,
  type ExpertsTrashList,
  type TrashClearResult,
  type TrashRestoreResult,
  type ExpertType,
  type RunExpertResult,
  type TaskStatusResult,
  type ShareExpertResult,
  type SortKey,
  type SortDir,
} from './schemas';

/**
 * Direct Main Backend (Extella) experts API client.
 *
 * Mirrors `apps/backend/src/services/experts.py` so the SPA gets the same
 * canonical shape it used to get from the admin-panel backend, but with no
 * proxy in between. Wire-level normalisation is delegated to
 * `lib/normalize.ts::normalizeExpert`.
 *
 * Main Backend wire contract (POST-only, see http.py):
 *   POST /api/experts_db/list      body: { global?: boolean }
 *   POST /api/experts_db/search    body: { query, limit, global?: boolean }
 *   POST /api/expert/get           body: { name, global?: boolean }
 *   POST /api/expert/delete        body: { name }
 *   POST /api/trash/list           body: { global?: boolean }
 *   POST /api/trash/clear          body: {}
 *   POST /api/trash/restore/expert body: { name }
 *
 * None of these support server-side pagination — we apply `paginate()` over
 * the full list in-process, matching the admin-panel backend semantics.
 *
 * The `global: true` flag is unrelated to B2B org/team scoping — upstream uses
 * it to also include built-in/global experts that any user can run. The
 * standalone build sends it on every read so the user sees the full surface
 * (their own + global experts) without an extra UI toggle.
 */
const SEND_GLOBAL = true;

/**
 * Timeout for `/api/expert/run` (ms). Synchronous (`fython`) experts run inline
 * upstream and block the request for their full execution — `wait: false` is
 * not honoured for them, so no `task_id` comes back to poll. The default axios
 * 30s timeout aborts such runs mid-flight (surfaced as "timeout of 30000ms
 * exceeded"); this generous bound lets long counts/jobs finish while still
 * failing eventually rather than hanging the run state forever.
 */
const RUN_TIMEOUT_MS = 600_000;

/** Coerce a raw upstream item into a plain Record before normalising. */
function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

/** Pull the `experts | results | items` slice out of a Main Backend response. */
function extractList(body: unknown): Record<string, unknown>[] {
  const obj = asRecord(body);
  const raw =
    (obj.results as unknown) ??
    (obj.items as unknown) ??
    (obj.experts as unknown) ??
    [];
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object');
}

/**
 * List experts.
 *
 * - `q` non-empty → POST `/api/experts_db/search` with `{ query, limit, global }`.
 *   Search is server-side here; we still apply `paginate` for slicing.
 * - `q` empty → POST `/api/experts_db/list` with `{ global }`. Filter
 *   client-side on (name + description) since the upstream list endpoint
 *   has no `q` parameter.
 *
 * `global: true` is always passed in the standalone — see SEND_GLOBAL above.
 * The `scope` param on the public hook signature is kept for source parity
 * but is ignored: every read includes global experts.
 */
function buildScopedPairs(
  pairs: TopologyPair[],
  profileId?: string,
  agentId?: string,
): TopologyPair[] {
  if (!pairs.length) {
    return [{ profile_id: 'default', profile_name: 'Default', agent_id: 'agent_extella_default', agent_name: 'Default agent' }];
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

export async function listExperts(
  params: ListExpertsParams = {},
  pairs: TopologyPair[] = [],
): Promise<PaginatedExperts> {
  const {
    q,
    page = 1,
    page_size = 25,
    types,
    sort_key = 'recent',
    sort_dir = 'desc',
    profileId,
    agentId,
  } = params;
  const qNorm = (q ?? '').trim();
  const scopedPairs = buildScopedPairs(pairs, profileId, agentId);

  // `Promise.all` keeps result order aligned to `scopedPairs` regardless of
  // which request resolves first; flattening yields a deterministic list. A
  // shared-array push would order rows by network-completion time, reshuffling
  // the list on every refetch and breaking client-side pagination.
  const perPair = await Promise.all(
    scopedPairs.map(async (pair) => {
      try {
        let body: unknown;
        if (qNorm) {
          body = await mbPost<unknown>('/api/experts_db/search', {
            query: qNorm,
            limit: SEARCH_RESULT_LIMIT,
            global: SEND_GLOBAL,
          }, { profileId: pair.profile_id, agentId: pair.agent_id }, { silent: true });
        } else {
          body = await mbPost<unknown>('/api/experts_db/list', {
            global: SEND_GLOBAL,
          }, { profileId: pair.profile_id, agentId: pair.agent_id }, { silent: true });
        }
        return extractList(body).map((raw) => ({ ...raw, _pair: pair }));
      } catch {
        // Single pair failure should not crash the whole list.
        return [] as Record<string, unknown>[];
      }
    }),
  );
  const allRaw: Record<string, unknown>[] = perPair.flat();

  const normalizedAll: ExpertRow[] = allRaw.map((raw) => {
    const pair = (raw._pair as TopologyPair | undefined);
    const { _pair: _, ...rest } = raw;
    return normalizeExpert(rest, pair);
  });

  // v1: NO client-side deduplication and NO globalness classification. We emit
  // every (profile, agent) row exactly as the fan-out returned it — the same
  // expert name can legitimately recur across pairs, and v1 surfaces all of
  // them rather than collapsing by name. Recognising "the same expert across
  // profiles" requires a stable server-side identity the backend does not yet
  // expose; that, plus making the `global` flag actually functional, is tracked
  // as backend work in `docs/experts-backend-asks.md`. React-key safety no
  // longer relies on dedup: each item gets a composite `id` (profile|agent|name)
  // in the mapping below, so duplicate names never collide as React keys.

  // `/api/experts_db/search` is semantic: drop weak hits, rank by relevance,
  // and keep the N most similar. The plain `/api/experts_db/list` path carries
  // no similarity, so this is skipped there. Display order is then handed to
  // the user's chosen sort below.
  const normalized: ExpertRow[] = qNorm
    ? normalizedAll
        .filter((it) => it.similarity == null || it.similarity >= SEARCH_SIMILARITY_THRESHOLD)
        .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
        .slice(0, SEARCH_RESULT_LIMIT)
    : normalizedAll;

  // Apply catalogue-wide type filter BEFORE pagination so the visible page
  // shows the correct slice of the filtered universe, not a filter applied
  // to whichever 25/50/100 rows happened to be on the current page.
  // `types` is the UI-derived classification (deriveExpertType) — the
  // upstream Main Backend has no `type` field on experts.
  // v1 applies only the type filter catalogue-wide (before pagination). The
  // former "Show global" client filter is gone — there is no globalness
  // classification to filter on anymore (the `global` request flag is still
  // sent above but is inert on the backend; see docs/experts-backend-asks.md).
  const typeFilter: ExpertType[] = Array.isArray(types) ? types : [];
  const filtered =
    typeFilter.length > 0
      ? normalized.filter((it) =>
          typeFilter.includes(deriveExpertType(it.name, it.description ?? undefined)),
        )
      : normalized;

  // Apply catalogue-wide sort BEFORE pagination so page 2 picks up where
  // page 1 left off in the sorted order, not in the upstream insertion order.
  // During an active semantic search, keep the relevance (similarity) order
  // from the slice above instead — the recent/name sort is for browsing the
  // full catalogue and would otherwise clobber the ranking of matches.
  const sorted = qNorm ? filtered : sortExperts(filtered, sort_key, sort_dir);

  // Now slice. Total reflects the filtered+sorted set, which is the correct
  // "results" count for the toolbar.
  const paged = paginate(sorted, { page, page_size });

  // Map ExpertRow → the schema-shaped summary the UI expects.
  const items = paged.items.map((it) => ({
    // Composite identity for React keys / row addressing. The backend exposes
    // no stable per-expert id and the same name recurs across pairs, so we
    // synthesise one from (profile, agent, name). See docs/experts-backend-asks.md.
    id: `${it.profile_id ?? ''}::${it.agent_id ?? ''}::${it.name}`,
    name: it.name,
    description: it.description ?? '',
    code: it.code,
    // ExpertRow.params accepts arrays too; the summary schema only takes
    // dict-shaped params, so coerce arrays out to undefined so zod doesn't reject.
    params:
      it.params && !Array.isArray(it.params)
        ? (it.params as Record<string, unknown>)
        : null,
    created_at: it.created_at,
    updated_at: it.updated_at,
    // Profile + Agent label fields from fan-out.
    profile_id: it.profile_id ?? null,
    profile_name: it.profile_name ?? null,
    agent_id: it.agent_id ?? null,
    agent_name: it.agent_name ?? null,
    // v1 has no globalness classification — always false, so the UI renders the
    // profile/agent badge rather than a "Global" pill.
    is_global: false,
  }));

  return paginatedExpertsSchema.parse({
    items,
    page: paged.page,
    page_size: paged.page_size,
    total: paged.total,
    has_more: paged.has_more,
  });
}

/**
 * Sort a normalized expert list by the given key+direction. Pure; returns a
 * new array. `recent` compares raw ISO `created_at` lexicographically (which
 * is equivalent to chronological for ISO 8601). Missing dates sort to the
 * end regardless of direction. `name` / `type` use locale-aware
 * `localeCompare`. `type` is recomputed via `deriveExpertType` since the
 * upstream has no `type` field.
 */
function sortExperts(rows: ExpertRow[], key: SortKey, dir: SortDir): ExpertRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    switch (key) {
      case 'name':
        return sign * a.name.localeCompare(b.name);
      case 'type': {
        const at = deriveExpertType(a.name, a.description ?? undefined);
        const bt = deriveExpertType(b.name, b.description ?? undefined);
        return sign * at.localeCompare(bt);
      }
      case 'recent':
      default: {
        const ai = a.created_at ?? '';
        const bi = b.created_at ?? '';
        // Missing dates: send to the end regardless of direction.
        if (!ai && !bi) return 0;
        if (!ai) return 1;
        if (!bi) return -1;
        return sign * ai.localeCompare(bi);
      }
    }
  });
}

/**
 * Fetch one expert by name. Upstream signals "not found" with HTTP 200 +
 * `{ status: "error" }` (per http.py); we surface that as a thrown Error so
 * the React Query `isError` branch lights up. The source admin-panel api.ts
 * returns `Promise<ExpertDetail>` (non-null) and the caller never
 * special-cases null — we match that signature.
 *
 * Scope fan-out: `listExperts` enumerates the catalogue across EVERY
 * (profile, agent) pair, so a row visible in the list may live under a
 * non-default pair. `/api/expert/get` is pair-scoped via X-Profile-Id /
 * X-Agent-Id headers, so a single default-scope lookup would 404 any expert
 * created under another team/agent — exactly the rows the user can see and
 * click. We therefore probe the same pair universe. Unlike a first-hit lookup,
 * we await ALL probes so we can classify globalness the same way `listExperts`
 * does: an expert returned under EVERY pair is global. When `pairs` is empty we
 * fall back to a single default-scope lookup. Deep links (drawer opened by
 * name, no clicked-row pair) are covered too: the caller supplies the full
 * topology pair list.
 */
export async function getExpert(
  name: string,
  pairs: TopologyPair[] = [],
): Promise<ExpertDetail> {
  const probes: Array<TopologyPair | undefined> = pairs.length > 0 ? pairs : [undefined];

  const results = await Promise.all(
    probes.map(async (pair) => {
      try {
        const scope: ScopeOverride | undefined = pair
          ? { profileId: pair.profile_id, agentId: pair.agent_id }
          : undefined;
        const body = await mbPost<unknown>(
          '/api/expert/get',
          { name, global: SEND_GLOBAL },
          scope,
          // Probing pairs that don't own this expert returns 500/404 by
          // design; tolerate them silently and only throw if ALL probes miss.
          { silent: true },
        );
        const obj = asRecord(body);
        if (obj.status === 'error') return null;
        // Some upstream variants nest the row under "expert"; handle both.
        const row = 'expert' in obj ? asRecord(obj.expert) : obj;
        // Guard against an empty 200 that doesn't actually carry the row — only
        // a payload that resolved a name counts as a hit.
        const resolvedName = row.expert_name ?? row.name;
        if (resolvedName == null || resolvedName === '') return null;
        return { row, pair };
      } catch {
        return null;
      }
    }),
  );

  const hits = results.filter(
    (r): r is { row: Record<string, unknown>; pair: TopologyPair | undefined } => r != null,
  );

  if (hits.length === 0) {
    throw new Error(`Expert "${name}" not found`);
  }

  // Best-effort global flag for deep-links (drawer opened by URL with no
  // clicked row). A single expert's probes can't tell a "broken/empty pair"
  // apart from "expert genuinely absent here", so we can't reuse the list's
  // exact non-empty-pair denominator. A global built-in resolves under most
  // pairs while a pair-specific expert resolves under one, so a simple majority
  // is a good proxy. When opened from the list, the caller passes the list's
  // authoritative `is_global`, which takes precedence over this value.
  const isGlobal = pairs.length > 1 && hits.length * 2 > pairs.length;
  const hit = hits[0];

  const normalized = normalizeExpert(hit.row, hit.pair);

  // `cspl` is detail-only and not on ExpertRow; lift it from the raw payload.
  const cspl =
    typeof hit.row.cspl === 'string'
      ? hit.row.cspl
      : hit.row.cspl == null
        ? null
        : String(hit.row.cspl);

  return expertDetailSchema.parse({
    name: normalized.name,
    description: normalized.description ?? '',
    code: normalized.code,
    params: normalized.params,
    cspl,
    created_at: normalized.created_at,
    updated_at: normalized.updated_at,
    // Profile + Agent label fields from the matched fan-out pair.
    profile_id: normalized.profile_id ?? null,
    profile_name: normalized.profile_name ?? null,
    agent_id: normalized.agent_id ?? null,
    agent_name: normalized.agent_name ?? null,
    is_global: isGlobal,
  });
}

/**
 * Soft-delete an expert. v0.8.0 moves it to the trash bin; the row is
 * restorable via `restoreExpert` until `retention_days` elapse or
 * `clearExpertsTrash` is invoked.
 */
export async function deleteExpert(
  name: string,
  pair?: { profileId?: string; agentId?: string },
): Promise<void> {
  await mbPost<unknown>('/api/expert/delete', { name }, pair);
}

/**
 * List trashed experts (plus retention window). The upstream endpoint also
 * returns `pipelines`; Studio v2 has no pipelines screen yet so we drop that
 * slice here, matching the admin-panel backend behaviour.
 */
export async function listTrashedExperts(): Promise<ExpertsTrashList> {
  const body = await mbPost<unknown>('/api/trash/list', { global: SEND_GLOBAL });
  const obj = asRecord(body);
  const expertsRaw = Array.isArray(obj.experts) ? obj.experts : [];
  const experts = expertsRaw
    .filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object')
    .map((r) => {
      const n = normalizeExpert(r);
      const deletedAt =
        typeof r.deleted_at === 'string'
          ? r.deleted_at
          : typeof r.deletedAt === 'string'
            ? (r.deletedAt as string)
            : null;
      return {
        id: typeof r.id === 'string' ? r.id : r.id != null ? String(r.id) : null,
        name: n.name,
        description: n.description ?? '',
        created_at: n.created_at,
        updated_at: n.updated_at,
        deleted_at: deletedAt,
      };
    });

  const retentionDays = Number(obj.retention_days ?? 0);

  return trashListSchema.parse({
    experts,
    retention_days: Number.isFinite(retentionDays) && retentionDays >= 0 ? retentionDays : 0,
  });
}

/**
 * Permanently empty the trash bin. Bulk-only — upstream has no per-item purge.
 */
export async function clearExpertsTrash(): Promise<TrashClearResult> {
  const body = await mbPost<unknown>('/api/trash/clear', {});
  const obj = asRecord(body);
  return trashClearSchema.parse({
    experts_removed: Number(obj.experts_removed ?? 0) || 0,
    pipelines_removed: Number(obj.pipelines_removed ?? 0) || 0,
  });
}

/**
 * Restore one trashed expert back into the catalogue.
 */
export async function restoreExpert(name: string): Promise<TrashRestoreResult> {
  const body = await mbPost<unknown>('/api/trash/restore/expert', { name });
  const obj = asRecord(body);
  return trashRestoreSchema.parse({
    restored: Boolean(obj.restored),
  });
}

/**
 * Run an expert asynchronously. Always sends `wait: false` so the response
 * returns a `task_id` immediately instead of blocking until completion.
 *
 * `scope` pins the request to the expert's owning (profile, agent) pair — the
 * same fan-out scoping that `listExperts`/`getExpert` use to find it. Without
 * it the run goes out under the default profile/agent and upstream returns 500
 * "Expert not found" for any expert that lives under a non-default pair (the
 * exact rows the user can see and click). See `deleteExpert` for the analogue.
 *
 * `opts.sync` selects the timeout: a synchronous (`fython`) run blocks the
 * request for its whole execution and needs the long ceiling; an async run
 * returns a `task_id` within ~1s and keeps the default 30s. Callers that don't
 * know the strategy should pass `sync: true` (the safe choice — a tight timeout
 * would abort a slow synchronous run mid-flight).
 */
export async function runExpert(
  name: string,
  params?: Record<string, unknown>,
  scope?: ScopeOverride,
  opts?: { sync?: boolean },
): Promise<RunExpertResult> {
  const timeout = opts?.sync ? RUN_TIMEOUT_MS : undefined;
  const body = await mbPost<unknown>('/api/expert/run', {
    expert_name: name,
    params: params ?? {},
    wait: false,
    global: true,
  }, scope, timeout != null ? { timeout } : undefined);
  const obj = asRecord(body);
  return runExpertResultSchema.parse({
    status: obj.status,
    expert_name: obj.expert_name ?? name,
    result: obj.result ?? null,
    task_id: obj.task_id ?? null,
    execution_log: Array.isArray(obj.execution_log) ? obj.execution_log : [],
    run_time_ms: obj.run_time_ms ?? null,
  });
}

/**
 * Poll task status. Returns terminal status (SUCCESS / FAILURE / DONE / ERROR)
 * or an in-progress status (PENDING / STARTED / etc.).
 */
export async function checkTask(taskId: string): Promise<TaskStatusResult> {
  const body = await mbPost<unknown>('/api/tasks/check', { task_id: taskId });
  const obj = asRecord(body);
  return taskStatusResultSchema.parse({
    task_id: obj.task_id ?? taskId,
    status: obj.status ?? null,
    result: obj.result ?? null,
  });
}

/**
 * Share an expert with a recipient user.
 *
 * Flow:
 * 1. Fetch the expert from the caller's scope (`global: false` — get MY copy).
 * 2. Save it to the recipient's scope by sending the POST with `X-Auth-Token`
 *    overridden to `recipientToken` via `mbPostAs`. The recipient's header
 *    bypasses the default interceptor (which only writes X-Auth-Token when not
 *    already set), so the save is attributed to the recipient on the backend.
 *
 * NOTE: The recipient's token is never echoed back in a toast or logged.
 */
export async function shareExpert(
  name: string,
  recipientToken: string,
  scope?: ScopeOverride,
): Promise<ShareExpertResult> {
  // Step 1: fetch MY copy of the expert (global:false = personal scope).
  // `scope` pins the get to the expert's owning (profile, agent) pair — without
  // it a non-default expert resolves to 404/500 here, same failure mode as run.
  const getBody = await mbPost<unknown>('/api/expert/get', { name, global: false }, scope);
  const getObj = asRecord(getBody);

  // Normalize upstream field names to the save-body convention.
  const expertName =
    typeof getObj.expert_name === 'string' ? getObj.expert_name : name;
  const description =
    typeof getObj.expert_description === 'string' ? getObj.expert_description : '';
  const code =
    typeof getObj.expert_code === 'string' ? getObj.expert_code : '';
  const kwargs =
    getObj.expert_params && typeof getObj.expert_params === 'object'
      ? (getObj.expert_params as Record<string, unknown>)
      : {};
  const cspl =
    typeof getObj.cspl === 'string' ? getObj.cspl : null;

  // Step 2: save as the recipient by overriding X-Auth-Token.
  const saveBody = await mbPostAs<unknown>(
    '/api/expert/save',
    {
      name: expertName,
      description,
      code,
      kwargs,
      ...(cspl != null ? { cspl } : {}),
    },
    { token: recipientToken },
  );

  const saveObj = asRecord(saveBody);
  return shareExpertResultSchema.parse({
    status: saveObj.status ?? 'success',
    expert_name: saveObj.expert_name ?? expertName,
    user_id: saveObj.user_id ?? null,
  });
}
