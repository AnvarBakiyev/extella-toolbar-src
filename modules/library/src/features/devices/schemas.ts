/**
 * Devices — UI types and Zod schemas for the standalone build.
 *
 * The canonical row shape (`Device`) is produced by
 * `lib/normalize.ts::normalizeTarget` and re-exported here. The form schemas
 * are used by `DeviceFormDialog` for client-side validation.
 */

import { z } from 'zod';
import type { Device, Paginated } from '@/lib/types';

/* ─── canonical row + list shapes ──────────────────────────────── */

export type { Device };

/** Same envelope shape as other standalone list responses. */
export type DevicesListResponse = Paginated<Device>;

/* ─── form bodies ──────────────────────────────────────────────── */

export const CreateDeviceBodySchema = z.object({
  target: z
    .string()
    .min(1, 'Device name is required')
    .max(200, 'Max 200 characters'),
  description: z.string().max(1000, 'Max 1000 characters').optional(),
});

export type CreateDeviceBody = z.infer<typeof CreateDeviceBodySchema>;

export const UpdateDeviceBodySchema = z.object({
  target: z
    .string()
    .min(1, 'Device name is required')
    .max(200, 'Max 200 characters')
    .optional(),
  description: z.string().max(1000, 'Max 1000 characters').optional(),
});

export type UpdateDeviceBody = z.infer<typeof UpdateDeviceBodySchema>;

/* ─── query params ─────────────────────────────────────────────── */

export type SortKey = 'recent' | 'name';
export type SortDir = 'asc' | 'desc';
export type ViewMode = 'grid' | 'list';

export interface ListDevicesParams {
  q?: string;
  page?: number;
  page_size?: number;
  sort_key?: SortKey;
  sort_dir?: SortDir;
  /** Scope filter for topology fan-out. */
  profileId?: string;
  agentId?: string;
}

/* ─── default device response ──────────────────────────────────── */

export interface DefaultDeviceResponse {
  target: string | null;
}
