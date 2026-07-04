/**
 * Devices — direct-to-Main-Backend (Extella v0.8.0) API surface.
 *
 * Fan-out: when no scope is selected, the list call is fanned out across all
 * (profile, agent) topology pairs. Rows tagged with their owning pair.
 *
 * Note: `is_default` is still computed client-side by comparing each device's
 * `target` to the default target from `/api/defaults/get_target`.
 */

import { mbPost } from '@/lib/api';
import { normalizeTarget, paginate } from '@/lib/normalize';
import { SEARCH_SIMILARITY_THRESHOLD, SEARCH_RESULT_LIMIT } from '@/lib/constants';
import type { Device, TopologyPair } from '@/lib/types';
import type {
  DevicesListResponse,
  ListDevicesParams,
  DefaultDeviceResponse,
  CreateDeviceBody,
  UpdateDeviceBody,
} from './schemas';

/* ─── helpers ──────────────────────────────────────────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractTargetList(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) {
    return body.filter(isRecord);
  }
  if (!isRecord(body)) return [];
  const candidate = body.results ?? body.items;
  if (!Array.isArray(candidate)) return [];
  return candidate.filter(isRecord);
}

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

function sortDevices(
  rows: Device[],
  key: ListDevicesParams['sort_key'],
  dir: ListDevicesParams['sort_dir'],
): Device[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    switch (key) {
      case 'name':
        return sign * a.target.localeCompare(b.target);
      case 'recent':
      default: {
        const ai = a.created_at ?? '';
        const bi = b.created_at ?? '';
        if (!ai && !bi) return 0;
        if (!ai) return 1;
        if (!bi) return -1;
        return sign * ai.localeCompare(bi);
      }
    }
  });
}

/* ─── default ──────────────────────────────────────────────────── */

export async function getDefaultTarget(): Promise<DefaultDeviceResponse> {
  const body = await mbPost<unknown>('/api/defaults/get_target', {});
  const obj = isRecord(body) ? body : {};
  const target = typeof obj.target === 'string' ? obj.target : null;
  return { target };
}

export async function setDefaultTarget(target: string): Promise<DefaultDeviceResponse> {
  const body = await mbPost<unknown>('/api/defaults/set_target', { target });
  const obj = isRecord(body) ? body : {};
  const resultTarget = typeof obj.target === 'string' ? obj.target : target;
  return { target: resultTarget };
}

/* ─── list ─────────────────────────────────────────────────────── */

export async function listDevices(
  params: ListDevicesParams = {},
  pairs: TopologyPair[] = [],
): Promise<DevicesListResponse> {
  const {
    q,
    page = 1,
    page_size = 25,
    sort_key = 'recent',
    sort_dir = 'desc',
    profileId,
    agentId,
  } = params;

  const qNorm = (q ?? '').trim();
  const scopedPairs = buildScopedPairs(pairs, profileId, agentId);

  const [defaultBody] = await Promise.all([getDefaultTarget()]);
  const defaultTarget = defaultBody.target;

  // `Promise.all` keeps result order aligned to `scopedPairs` regardless of
  // which request resolves first; flattening yields a deterministic list. A
  // shared-array push would order rows by network-completion time — and since
  // sortDevices has no stable tie-breaker, equal-keyed rows would reshuffle on
  // every refetch and break client-side pagination.
  const perPair = await Promise.all(
    scopedPairs.map(async (pair) => {
      try {
        let listBody: unknown;
        if (qNorm) {
          listBody = await mbPost<unknown>('/api/targets/search', { query: qNorm, limit: SEARCH_RESULT_LIMIT }, {
            profileId: pair.profile_id,
            agentId: pair.agent_id,
          });
        } else {
          listBody = await mbPost<unknown>('/api/targets/list', {}, {
            profileId: pair.profile_id,
            agentId: pair.agent_id,
          });
        }
        const raw = extractTargetList(listBody);
        return raw.map((entry) => {
          const device = normalizeTarget(entry, pair);
          return { ...device, is_default: device.target === defaultTarget };
        });
      } catch {
        // Single pair failure should not crash the whole list.
        return [] as Device[];
      }
    }),
  );
  let allItems: Device[] = perPair.flat();

  // `/api/targets/search` is semantic: drop weak hits, then keep the N most
  // similar GLOBALLY (the backend `limit` only bounds each per-pair request;
  // the fan-out merges several). The plain `/api/targets/list` path carries no
  // similarity, so this block is skipped there. Display order is then handed
  // to the user's chosen sort below.
  if (qNorm) {
    allItems = allItems
      .filter((d) => d.similarity == null || d.similarity >= SEARCH_SIMILARITY_THRESHOLD)
      .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
      .slice(0, SEARCH_RESULT_LIMIT);
  }

  // During an active semantic search, keep the relevance (similarity) order
  // from the slice above — the recent/name sort is for browsing the full
  // catalogue, not for ranking matches, and would otherwise clobber it.
  const sorted = qNorm ? allItems : sortDevices(allItems, sort_key, sort_dir);
  return paginate(sorted, { page, page_size });
}

/* ─── get ──────────────────────────────────────────────────────── */

export async function getDevice(id: string): Promise<Device | null> {
  const [listBody, defaultBody] = await Promise.all([
    mbPost<unknown>('/api/targets/list', {}),
    getDefaultTarget(),
  ]);

  const defaultTarget = defaultBody.target;
  const raw = extractTargetList(listBody);
  const found = raw.find((r) => {
    const rid = r.id !== undefined ? String(r.id) : '';
    return rid === id;
  });
  if (!found) return null;
  const device = normalizeTarget(found);
  return { ...device, is_default: device.target === defaultTarget };
}

/* ─── create ───────────────────────────────────────────────────── */

export async function createDevice(
  body: CreateDeviceBody,
  pair?: { profileId?: string; agentId?: string },
): Promise<Device> {
  const result = await mbPost<unknown>('/api/targets/add', {
    target: body.target,
    description: body.description ?? '',
  }, pair);
  const device = normalizeTarget(isRecord(result) ? result : {});
  return { ...device, is_default: false };
}

/* ─── update ───────────────────────────────────────────────────── */

export async function updateDevice(
  id: string,
  body: UpdateDeviceBody,
  defaultTarget?: string | null,
  pair?: { profileId?: string; agentId?: string },
): Promise<Device> {
  const result = await mbPost<unknown>('/api/targets/update', {
    id,
    ...(body.target !== undefined ? { target: body.target } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
  }, pair);
  const device = normalizeTarget(isRecord(result) ? result : {});
  return {
    ...device,
    is_default: defaultTarget != null && device.target === defaultTarget,
  };
}

/* ─── remove ───────────────────────────────────────────────────── */

export async function removeDevice(
  id: string,
  pair?: { profileId?: string; agentId?: string },
): Promise<void> {
  await mbPost<unknown>('/api/targets/remove', { id }, pair);
}
