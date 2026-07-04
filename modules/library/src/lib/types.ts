/**
 * Canonical row shapes produced by `lib/normalize.ts`.
 * These mirror the response models that the admin-panel backend emits at
 * `/api/v1/admin/...` so feature pages keep working without changes.
 */

/**
 * Profile + Agent label fields added to every entity type by the fan-out
 * normalization step. The 4 fields are optional so existing code that
 * constructs these objects without them continues to compile.
 */
export interface ProfileAgentLabel {
  profile_id?: string | null;
  profile_name?: string | null;
  agent_id?: string | null;
  agent_name?: string | null;
}

export interface Concept extends ProfileAgentLabel {
  id: string;
  text: string;
  is_active: boolean;
  author_id?: string;
  created_at?: string;
  updated_at?: string;
  /** Semantic similarity to the query — present only on `/search` hits. */
  similarity?: number | null;
}

export interface Rule extends ProfileAgentLabel {
  id: string;
  text: string;
  is_active: boolean;
  is_pinned: boolean;
  author_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ExpertRow extends ProfileAgentLabel {
  name: string;
  description: string | null;
  code: string | null;
  params: Record<string, unknown> | unknown[] | null;
  prompt: string | null;
  created_at: string | null;
  updated_at: string | null;
  /** Semantic similarity to the query — present only on `/search` hits. */
  similarity?: number | null;
}

export interface AgentRow extends ProfileAgentLabel {
  id: string;
  name: string;
  description: string | null;
  provider: string | null;
  model: string | null;
  tools: string[];
  instructions: string | null;
  is_active: boolean;
  is_public: boolean | null;
  version: number | null;
  project_ids: string[];
  model_parameters: Record<string, unknown> | null;
  tool_options: Record<string, unknown> | null;
  end_after_tools: boolean | null;
  hide_sequential_outputs: boolean | null;
  recursion_limit: number | null;
  conversation_starters: string[] | null;
  category: string | null;
  base_url: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
}

/** Canonical KV Store row produced by normalizeKv(). */
export interface KvEntry extends ProfileAgentLabel {
  id: string;
  key: string;
  value: string;
  description: string;
  created_at: string | null;
  updated_at: string | null;
  /** Semantic similarity to the query — present only on `/search` hits. */
  similarity?: number | null;
}

/**
 * Canonical Device row produced by normalizeTarget().
 * Mirrors the Main Backend `/api/targets/*` response shape.
 * `is_default` is computed client-side by comparing `target` to the
 * default target string from `/api/defaults/get_target`.
 */
export interface Device extends ProfileAgentLabel {
  id: string;
  target: string;
  description: string;
  is_default: boolean;
  created_at: string | null;
  updated_at: string | null;
  /** Only present on search result rows — optional. */
  similarity?: number | null;
}

/**
 * Canonical Token row produced by normalizeToken().
 * Mirrors the Main Backend `/api/token/*` response shape.
 * `token` is the secret string and also serves as the row identity.
 */
export interface Token extends ProfileAgentLabel {
  token: string;
  name: string;
  created_at: string | null;
}

/**
 * A (profile, agent) pair for topology fan-out.
 * Matches the canonical shape in the spec §0.
 */
export interface TopologyPair {
  profile_id: string;
  profile_name: string;
  agent_id: string;
  agent_name: string;
}

/**
 * Canonical topology object (nested form used by the UI).
 */
export interface Topology {
  profiles: Array<{
    profile_id: string;
    profile_name: string;
    agents: Array<{ agent_id: string; agent_name: string }>;
  }>;
}
