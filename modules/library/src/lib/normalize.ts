/**
 * Field-name normalization at the Main Backend boundary.
 *
 * v0.6.11 mixes snake_case / camelCase / prefixed names depending on endpoint.
 * We normalize to a single canonical shape so UI code stays simple.
 *
 * This mirrors `apps/backend/src/main_backend/http.py::_normalize_*` so the
 * standalone build produces identical row shapes to the admin-panel backend.
 */

import type { Concept, Rule, ExpertRow, AgentRow, KvEntry, Device, Token, TopologyPair } from './types';

/**
 * Stamp the 4 profile+agent label fields onto any entity object.
 * Called by each `normalize*` function immediately before returning,
 * when a fan-out pair is available. When `pair` is undefined the fields
 * are left absent (row keeps whatever the upstream echoed, if anything).
 */
export function withProfileAgent<T extends object>(out: T, pair?: TopologyPair): T {
  if (!pair) return out;
  return {
    ...out,
    profile_id: pair.profile_id,
    profile_name: pair.profile_name,
    agent_id: pair.agent_id,
    agent_name: pair.agent_name,
  };
}

export function normalizeConcept(raw: Record<string, unknown>, pair?: TopologyPair): Concept {
  const out: Record<string, unknown> = { ...raw };
  if (out.id === undefined && 'concept_id' in raw) out.id = raw.concept_id;
  if (out.text === undefined && 'concept_text' in raw) out.text = raw.concept_text;
  if (out.id !== undefined && typeof out.id !== 'string') out.id = String(out.id);
  return withProfileAgent({
    id: String(out.id ?? ''),
    text: String(out.text ?? ''),
    is_active: (out.is_active as boolean | undefined) ?? true,
    author_id: (out.author_id as string | undefined) ?? undefined,
    created_at: (out.created_at as string | undefined) ?? undefined,
    updated_at: (out.updated_at as string | undefined) ?? undefined,
    similarity: typeof out.similarity === 'number' ? out.similarity : null,
  }, pair);
}

export function normalizeRule(raw: Record<string, unknown>, pair?: TopologyPair): Rule {
  const out: Record<string, unknown> = { ...raw };
  if (out.id === undefined && 'rule_id' in raw) out.id = raw.rule_id;
  if (out.text === undefined && 'rule' in raw) out.text = raw.rule;
  if (out.id !== undefined && typeof out.id !== 'string') out.id = String(out.id);
  return withProfileAgent({
    id: String(out.id ?? ''),
    text: String(out.text ?? ''),
    is_active: (out.is_active as boolean | undefined) ?? true,
    is_pinned: (out.is_pinned as boolean | undefined) ?? false,
    author_id: (out.author_id as string | undefined) ?? undefined,
    created_at: (out.created_at as string | undefined) ?? undefined,
    updated_at: (out.updated_at as string | undefined) ?? undefined,
  }, pair);
}

export function normalizeExpert(raw: Record<string, unknown>, pair?: TopologyPair): ExpertRow {
  const out: Record<string, unknown> = { ...raw };
  if (out.name === undefined && 'expert_name' in raw) out.name = raw.expert_name;
  if (out.description === undefined && 'expert_description' in raw)
    out.description = raw.expert_description;
  if (out.code === undefined && 'expert_code' in raw) out.code = raw.expert_code;
  if (out.params === undefined && 'expert_params' in raw) out.params = raw.expert_params;
  if (out.prompt === undefined && 'expert_prompt' in raw) out.prompt = raw.expert_prompt;
  if (out.created_at === undefined && 'createdAt' in raw) out.created_at = raw.createdAt;
  if (out.updated_at === undefined && 'updatedAt' in raw) out.updated_at = raw.updatedAt;
  return withProfileAgent({
    name: String(out.name ?? ''),
    description: (out.description as string | undefined) ?? null,
    code: (out.code as string | undefined) ?? null,
    params: (out.params as Record<string, unknown> | unknown[] | undefined) ?? null,
    prompt: (out.prompt as string | undefined) ?? null,
    created_at: (out.created_at as string | undefined) ?? null,
    updated_at: (out.updated_at as string | undefined) ?? null,
    similarity: typeof out.similarity === 'number' ? out.similarity : null,
  }, pair);
}

export function normalizeAgent(raw: Record<string, unknown>, pair?: TopologyPair): AgentRow {
  const out: Record<string, unknown> = { ...raw };
  if (out.created_at === undefined && 'createdAt' in raw) out.created_at = raw.createdAt;
  if (out.updated_at === undefined && 'updatedAt' in raw) out.updated_at = raw.updatedAt;
  if (out.is_public === undefined && 'isPublic' in raw) out.is_public = raw.isPublic;
  if (out.project_ids === undefined && 'projectIds' in raw) out.project_ids = raw.projectIds;
  if (out.model_parameters === undefined && 'modelParameters' in raw)
    out.model_parameters = raw.modelParameters;
  if (out.base_url === undefined && 'baseURL' in raw) out.base_url = raw.baseURL;
  return withProfileAgent({
    id: String(out.id ?? ''),
    name: String(out.name ?? ''),
    description: (out.description as string | undefined) ?? null,
    provider: (out.provider as string | undefined) ?? null,
    model: (out.model as string | undefined) ?? null,
    tools: Array.isArray(out.tools) ? (out.tools as unknown[]).map(String) : [],
    instructions: (out.instructions as string | undefined) ?? null,
    is_active: (out.is_active as boolean | undefined) ?? true,
    is_public:
      out.is_public === undefined ? null : Boolean(out.is_public),
    version:
      typeof out.version === 'number' && Number.isFinite(out.version)
        ? Number(out.version)
        : null,
    project_ids: Array.isArray(out.project_ids)
      ? (out.project_ids as unknown[]).map(String)
      : [],
    model_parameters:
      out.model_parameters && typeof out.model_parameters === 'object'
        ? (out.model_parameters as Record<string, unknown>)
        : null,
    tool_options:
      out.tool_options && typeof out.tool_options === 'object' && !Array.isArray(out.tool_options)
        ? (out.tool_options as Record<string, unknown>)
        : null,
    end_after_tools:
      out.end_after_tools === undefined || out.end_after_tools === null
        ? null
        : Boolean(out.end_after_tools),
    hide_sequential_outputs:
      out.hide_sequential_outputs === undefined || out.hide_sequential_outputs === null
        ? null
        : Boolean(out.hide_sequential_outputs),
    recursion_limit:
      typeof out.recursion_limit === 'number' && Number.isFinite(out.recursion_limit)
        ? Number(out.recursion_limit)
        : null,
    conversation_starters: Array.isArray(out.conversation_starters)
      ? (out.conversation_starters as unknown[]).map(String)
      : null,
    category:
      typeof out.category === 'string' && out.category.length > 0 ? out.category : null,
    base_url:
      typeof out.base_url === 'string' && out.base_url.length > 0 ? out.base_url : null,
    created_at: (out.created_at as string | undefined) ?? null,
    updated_at: (out.updated_at as string | undefined) ?? null,
  }, pair);
}

/**
 * Apply pagination + case-insensitive substring search on an in-memory list.
 *
 * Main Backend v0.6.11 has no server-side pagination or filtering for
 * /api/concept/list, /api/rules/list, /api/agent/list, /api/experts_db/list.
 * The admin-panel backend slices/filters in-process; we do the same here so
 * UI behavior is identical.
 */
export function paginate<T>(
  items: T[],
  {
    page,
    page_size,
    search,
    haystack,
  }: {
    page: number;
    page_size: number;
    search?: string;
    haystack?: (item: T) => string;
  },
): { items: T[]; page: number; page_size: number; total: number; has_more: boolean } {
  let filtered = items;
  if (search && haystack) {
    const needle = search.trim().toLowerCase();
    if (needle) {
      filtered = items.filter((item) => haystack(item).toLowerCase().includes(needle));
    }
  }
  const total = filtered.length;
  const start = Math.max(0, (page - 1) * page_size);
  const end = start + page_size;
  return {
    items: filtered.slice(start, end),
    page,
    page_size,
    total,
    has_more: end < total,
  };
}

/**
 * Normalize a raw target row from the Main Backend `/api/targets/*`.
 * Upstream `id` may be an int or string — stringify it.
 * `description` defaults to '' when absent (the upstream field is required
 * for add/update but may be missing on older list rows).
 */
export function normalizeTarget(raw: Record<string, unknown>, pair?: TopologyPair): Device {
  const out: Record<string, unknown> = { ...raw };
  if (out.id !== undefined && typeof out.id !== 'string') out.id = String(out.id);
  return withProfileAgent({
    id: String(out.id ?? ''),
    target: String(out.target ?? ''),
    description: String(out.description ?? ''),
    is_default: Boolean(out.is_default),
    created_at: (out.created_at as string | undefined) ?? null,
    updated_at: (out.updated_at as string | undefined) ?? null,
    similarity:
      typeof out.similarity === 'number' ? out.similarity : null,
  }, pair);
}

/**
 * Normalize a raw KV Store row from the Main Backend.
 *
 * Upstream is inconsistent across endpoints: `/api/kv/list` and `/api/kv/search`
 * return `kv_key` / `kv_value` / `kv_description` (and sometimes `kv_id`),
 * whereas `/api/kv/get` and `/api/kv/set` return the un-prefixed
 * `key` / `value` / `description`. We accept both and emit the canonical shape.
 * `id` is an int upstream — stringify it.
 */
/**
 * Normalize a raw token row from the Main Backend `/api/token/*`.
 *
 * Upstream may carry a `token_` prefix on some fields (same pattern as KV).
 * Defensively accept both `name`/`token`/`created_at` AND
 * `token_name`/`token_value`/`token_created_at` variants.
 * Canonical Token = `{ token: str, name: str, created_at: str | null }`.
 */
export function normalizeToken(raw: Record<string, unknown>, pair?: TopologyPair): Token {
  const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v));
  const token = raw.token ?? raw.token_value ?? '';
  const name = raw.name ?? raw.token_name ?? '';
  const createdAt = raw.created_at ?? raw.token_created_at ?? raw.createdAt ?? null;
  return withProfileAgent({
    token: str(token),
    name: str(name),
    created_at: (createdAt as string | null) ?? null,
  }, pair);
}

export function normalizeKv(raw: Record<string, unknown>, pair?: TopologyPair): KvEntry {
  const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v));
  const id = raw.id ?? raw.kv_id ?? '';
  const key = raw.kv_key ?? raw.key ?? '';
  const value = raw.kv_value ?? raw.value ?? '';
  const description = raw.kv_description ?? raw.description ?? '';
  const createdAt = raw.created_at ?? raw.kv_created_at ?? raw.createdAt ?? null;
  const updatedAt = raw.updated_at ?? raw.kv_updated_at ?? raw.updatedAt ?? null;
  return withProfileAgent({
    id: str(id),
    key: str(key),
    value: str(value),
    description: str(description),
    created_at: (createdAt as string | null) ?? null,
    updated_at: (updatedAt as string | null) ?? null,
    similarity: typeof raw.similarity === 'number' ? raw.similarity : null,
  }, pair);
}
