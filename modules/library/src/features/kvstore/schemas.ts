/**
 * KV Store — Zod schemas + inferred types (standalone build).
 *
 * The canonical row shape (`KvEntry`) is produced by
 * `lib/normalize.ts::normalizeKv` and re-exported here so call sites import
 * from `../schemas` like in every other feature. Zod parsing is used only for
 * form validation — the boundary normalizer already enforces the wire shape.
 */

import { z } from 'zod';
import type { KvEntry, Paginated } from '@/lib/types';

/* ─── canonical row + list shapes ──────────────────────────────── */

export type { KvEntry };

/** Paginated list response envelope. */
export type KvListResponse = Paginated<KvEntry>;

/* ─── form schemas ──────────────────────────────────────────────── */

export const CreateKvBodySchema = z.object({
  key: z
    .string()
    .min(1, 'Key is required')
    .max(256, 'Max 256 characters')
    .regex(/^[^\s]+$/, 'Key must not contain spaces'),
  value: z
    .string()
    .min(1, 'Value is required')
    .max(8000, 'Max 8000 characters'),
  description: z.string().max(1000, 'Max 1000 characters').optional(),
});
export type CreateKvBody = z.infer<typeof CreateKvBodySchema>;

export const UpdateKvBodySchema = z.object({
  value: z
    .string()
    .min(1, 'Value is required')
    .max(8000, 'Max 8000 characters'),
  description: z.string().max(1000, 'Max 1000 characters').optional(),
});
export type UpdateKvBody = z.infer<typeof UpdateKvBodySchema>;

/* ─── query params ─────────────────────────────────────────────── */

export interface ListKvParams {
  q?: string;
  page?: number;
  page_size?: number;
  /** Scope filter for topology fan-out. */
  profileId?: string;
  agentId?: string;
}
