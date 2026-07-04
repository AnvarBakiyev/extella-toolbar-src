/**
 * Agents — UI types and provider palette.
 *
 * In the standalone build we hit Main Backend (Extella) directly and
 * normalize responses at the boundary via `lib/normalize.ts::normalizeAgent`.
 * Zod parsing isn't needed because the row shape is already enforced by
 * `AgentRow` (see `lib/types.ts`). To keep call sites identical to the
 * source feature, we re-export `AgentSummary`, `AgentDetail`, and
 * `PaginatedAgents` as type aliases over the canonical shapes.
 */

import type { AgentRow, Paginated } from '@/lib/types';

/**
 * Known LLM providers we render with a dedicated color. The backend stores
 * the raw upstream value (e.g. `openAI`, `anthropic`) — `normalizeProvider`
 * collapses casing variants to a stable key for lookup.
 */
export const AGENT_PROVIDER_VALUES = [
  'anthropic',
  'openai',
  'google',
  'bedrock',
  'azure',
  'custom',
  'other',
] as const;

export type AgentProvider = (typeof AGENT_PROVIDER_VALUES)[number];

/**
 * Provider → color tint. Same OKLCH palette as ExpertType so the two
 * libraries feel visually related.
 */
export const AGENT_PROVIDER_COLORS: Record<AgentProvider, string> = {
  anthropic: 'oklch(0.6 0.16 28)',
  openai: 'oklch(0.62 0.14 165)',
  google: 'oklch(0.62 0.18 250)',
  bedrock: 'oklch(0.6 0.14 65)',
  azure: 'oklch(0.62 0.18 220)',
  custom: 'oklch(0.6 0.12 290)',
  other: 'oklch(0.58 0.05 250)',
};

/**
 * Normalize an upstream provider string (`openAI`, `azureOpenAI`, …) to one
 * of our canonical keys. Returns `other` when nothing matches so the UI can
 * always render a colored chip.
 */
export function normalizeProvider(provider: string | null | undefined): AgentProvider {
  if (!provider) return 'other';
  const p = provider.toLowerCase();
  if (p.includes('anthropic')) return 'anthropic';
  if (p.includes('openai')) return p.includes('azure') ? 'azure' : 'openai';
  if (p.includes('azure')) return 'azure';
  if (p.includes('google') || p.includes('gemini') || p.includes('vertex')) return 'google';
  if (p.includes('bedrock') || p.includes('aws')) return 'bedrock';
  if (p.includes('custom')) return 'custom';
  return 'other';
}

// ─── Response types (aliases over the canonical row shape) ────────────────────
//
// Source used distinct `AgentSummary` / `AgentDetail` zod schemas. Since the
// Main Backend `/api/agent/list` and `/api/agent/get` both flow through
// `normalizeAgent` here, the shape is uniform — both are `AgentRow`.

export type AgentSummary = AgentRow;
export type AgentDetail = AgentRow;
export type PaginatedAgents = Paginated<AgentRow>;

// ─── Query params ─────────────────────────────────────────────────────────────

export type AgentSortKey = 'recent' | 'name' | 'provider' | 'tools';
export type AgentSortDir = 'asc' | 'desc';
export type AgentViewMode = 'grid' | 'list';

export interface ListAgentsParams {
  q?: string;
  page?: number;
  page_size?: number;
  /**
   * Restrict to one or more canonical providers. Empty or omitted = no filter.
   * Match is performed via `normalizeProvider(row.provider)`.
   */
  providers?: AgentProvider[];
  sort_key?: AgentSortKey;
  sort_dir?: AgentSortDir;
  /** Scope filter for topology fan-out. */
  profileId?: string;
  agentId?: string;
}
