/**
 * KV Store — direct-to-Main-Backend (Extella v0.8.0) API surface.
 *
 * Fan-out: when no scope is selected, the list call is fanned out across all
 * (profile, agent) topology pairs. Rows tagged with their owning pair.
 */

import { mbPost } from '@/lib/api';
import { normalizeKv, paginate } from '@/lib/normalize';
import { SEARCH_SIMILARITY_THRESHOLD, SEARCH_RESULT_LIMIT } from '@/lib/constants';
import { getCurrentAccountFallbackPair } from '@/lib/runtime';
import type { KvEntry, TopologyPair } from '@/lib/types';
import type { KvListResponse, ListKvParams } from './schemas';

/* ─── helpers ──────────────────────────────────────────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractKvList(body: unknown): Record<string, unknown>[] {
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
    return getCurrentAccountFallbackPair();
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

/* ─── list ─────────────────────────────────────────────────────── */

export async function listKv(
  params: ListKvParams = {},
  pairs: TopologyPair[] = [],
): Promise<KvListResponse> {
  const { q, page = 1, page_size = 25, profileId, agentId } = params;
  const scopedPairs = buildScopedPairs(pairs, profileId, agentId);
  const qNorm = (q ?? '').trim();

  // `Promise.all` keeps result order aligned to `scopedPairs` regardless of
  // which request resolves first; flattening yields a deterministic list. A
  // shared-array push would order rows by network-completion time, reshuffling
  // the list on every refetch and breaking client-side pagination.
  const perPair = await Promise.all(
    scopedPairs.map(async (pair) => {
      try {
        let body: unknown;
        if (qNorm) {
          body = await mbPost<unknown>('/api/kv/search', { query: qNorm, limit: SEARCH_RESULT_LIMIT }, {
            profileId: pair.profile_id,
            agentId: pair.agent_id,
          });
        } else {
          body = await mbPost<unknown>('/api/kv/list', {}, {
            profileId: pair.profile_id,
            agentId: pair.agent_id,
          });
        }
        const raw = extractKvList(body);
        return raw.map((entry) => normalizeKv(entry, pair));
      } catch {
        // Single pair failure should not crash the whole list.
        return [] as KvEntry[];
      }
    }),
  );
  let allItems: KvEntry[] = perPair.flat();

  // `/api/kv/search` is semantic: drop weak hits below the threshold, rank by
  // relevance across pairs, then cap to the N most similar GLOBALLY (the
  // backend `limit` only bounds each per-pair request; the fan-out merges
  // several). The plain `/api/kv/list` path carries no similarity, so this
  // block is skipped there.
  if (qNorm) {
    allItems = allItems
      .filter((e) => e.similarity == null || e.similarity >= SEARCH_SIMILARITY_THRESHOLD)
      .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
      .slice(0, SEARCH_RESULT_LIMIT);
  }

  return paginate(allItems, { page, page_size });
}

/* ─── get ──────────────────────────────────────────────────────── */

export async function getKv(key: string): Promise<KvEntry> {
  const body = await mbPost<unknown>('/api/kv/get', { key });
  return normalizeKv(isRecord(body) ? body : {});
}

/* ─── set (upsert) ─────────────────────────────────────────────── */

export async function setKv(
  key: string,
  value: string,
  description?: string,
  pair?: { profileId?: string; agentId?: string },
): Promise<KvEntry> {
  const body = await mbPost<unknown>('/api/kv/set', {
    key,
    value,
    description: description ?? '',
  }, pair);
  return normalizeKv(isRecord(body) ? body : {});
}

/* ─── remove ───────────────────────────────────────────────────── */

export async function removeKv(
  key: string,
  pair?: { profileId?: string; agentId?: string },
): Promise<void> {
  // Платформа отвечает 200 даже когда НИЧЕГО не удалила: факт лежит в поле deleted,
  // а не в status (канон CORRECTION_DELETE_WORKS, проверено 28.07). У клиентских
  // агентов половина записей без id — их удалить нечем, и человек видел зелёное
  // «удалено» при живой записи, а потом находил её в списке снова.
  const res = await mbPost<{ deleted?: boolean; status?: string }>(
    '/api/kv/remove', { key }, pair);
  if (res && res.deleted === false) {
    throw new Error(
      `запись «${key}» не удалена: платформа ответила deleted: false. ` +
      'Так бывает у записей без идентификатора — их нечем адресовать.');
  }
}
