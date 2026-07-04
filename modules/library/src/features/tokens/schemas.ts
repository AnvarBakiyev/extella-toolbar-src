/**
 * Tokens — Zod schemas + inferred types (standalone build).
 *
 * The canonical row shape (`Token`) is produced by
 * `lib/normalize.ts::normalizeToken` and re-exported here.
 * Zod parsing is used only for form validation.
 */

import { z } from 'zod';
import type { Token, Paginated } from '@/lib/types';

/* ─── canonical row + list shapes ──────────────────────────────── */

export type { Token };

/** Paginated list response envelope. */
export type TokenListResponse = Paginated<Token>;

/* ─── generate response shape ───────────────────────────────────── */

/** Shape returned by generateToken() — carries the full token string. */
export interface GenerateTokenResponse {
  token: string;
  name: string;
  user_id: string;
}

/* ─── form schema ───────────────────────────────────────────────── */

export const GenerateTokenBodySchema = z.object({
  name: z.string().max(256, 'Max 256 characters').optional(),
});
export type GenerateTokenBody = z.infer<typeof GenerateTokenBodySchema>;

/* ─── query params ─────────────────────────────────────────────── */

export interface ListTokensParams {
  q?: string;
  page?: number;
  page_size?: number;
  /** Scope filter for topology fan-out. */
  profileId?: string;
  agentId?: string;
}
