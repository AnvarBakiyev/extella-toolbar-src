/**
 * Concepts — UI types for the standalone build.
 *
 * The canonical row shape (`Concept`) is produced by
 * `lib/normalize.ts::normalizeConcept` and re-exported here so call sites can
 * keep importing from `../schemas` like in the source feature. Zod parsing is
 * not needed at runtime because the boundary normalizer already enforces the
 * shape; we keep `CreateConceptBodySchema` as the form schema since the
 * `AdminCreateModal` reuses the same client-side validation rules.
 */

import { z } from 'zod';
import type { Concept, Paginated } from '@/lib/types';

/* ─── canonical row + list shapes ──────────────────────────────── */

export type { Concept };

/** Same envelope the source feature returned from `listConcepts`. */
export type ConceptsListResponse = Paginated<Concept>;

/* ─── form bodies ──────────────────────────────────────────────── */

export const CreateConceptBodySchema = z.object({
  text: z
    .string()
    .min(1, 'Content is required')
    .max(8000, 'Max 8000 characters'),
});
export type CreateConceptBody = z.infer<typeof CreateConceptBodySchema>;

export const UpdateConceptBodySchema = CreateConceptBodySchema;
export type UpdateConceptBody = z.infer<typeof UpdateConceptBodySchema>;

/* ─── query params ─────────────────────────────────────────────── */

export interface ListConceptsParams {
  q?: string;
  page?: number;
  page_size?: number;
  /** Scope filter — both present → single pair; only profileId → all agents in profile. */
  profileId?: string;
  agentId?: string;
}
