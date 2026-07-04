/**
 * Zod schemas + inferred types for the Rules feature (standalone build).
 *
 * The canonical Rule row shape lives in `@/lib/types` — produced by
 * `normalizeRule()` at the Main Backend boundary. We re-export it here under
 * the schemas namespace so feature code follows the same import path it had
 * in the admin-panel build (`'./schemas'` not `'@/lib/types'`).
 *
 * Publication-request schemas are intentionally omitted — the standalone
 * build talks directly to Main Backend, which has no publish-request surface.
 */

import { z } from 'zod';

/* ─── Rule (mirrors lib/types::Rule) ───────────────────────────────── */

export const RuleSchema = z.object({
  id: z.string(),
  text: z.string(),
  is_active: z.boolean().default(true),
  is_pinned: z.boolean().default(false),
  author_id: z.string().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});
export type Rule = z.infer<typeof RuleSchema>;

/* ─── List envelope ─────────────────────────────────────────────────── */

export const RulesListResponseSchema = z.object({
  items: z.array(RuleSchema),
  page: z.number(),
  page_size: z.number(),
  total: z.number(),
  has_more: z.boolean(),
  /** v0.6.11 has no pinned-rule concept; always null in this build. */
  pinned_rule: z.null().optional(),
});
export type RulesListResponse = z.infer<typeof RulesListResponseSchema>;

/* ─── Form bodies ───────────────────────────────────────────────────── */

export const CreateRuleBodySchema = z.object({
  text: z.string().min(1, 'Content is required').max(4000, 'Max 4000 characters'),
});
export type CreateRuleBody = z.infer<typeof CreateRuleBodySchema>;

export const UpdateRuleBodySchema = CreateRuleBodySchema;
export type UpdateRuleBody = z.infer<typeof UpdateRuleBodySchema>;

/* ─── Query params ──────────────────────────────────────────────────── */

export interface ListRulesParams {
  q?: string;
  page?: number;
  page_size?: number;
  /** Scope filter for topology fan-out. */
  profileId?: string;
  agentId?: string;
}
