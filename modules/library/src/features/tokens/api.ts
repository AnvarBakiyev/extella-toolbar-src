/**
 * Tokens — direct-to-Main-Backend (Extella v0.8.0) API surface.
 *
 * Fan-out: when no scope is selected, the list call is fanned out across all
 * (profile, agent) topology pairs. Rows tagged with their owning pair.
 */

import axios from 'axios';
import { api, mbPost } from '@/lib/api';
import { normalizeToken, paginate } from '@/lib/normalize';
import type { Token, TopologyPair } from '@/lib/types';
import type { TokenListResponse, ListTokensParams, GenerateTokenResponse } from './schemas';

/** Derived validity of a token — the backend exposes no status field. */
export type TokenStatus = 'active' | 'revoked';

/* ─── helpers ──────────────────────────────────────────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractTokenList(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) {
    return body.filter(isRecord);
  }
  if (!isRecord(body)) return [];
  const candidate = body.tokens ?? body.items ?? body.results;
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

/* ─── list ─────────────────────────────────────────────────────── */

export async function listTokens(
  params: ListTokensParams = {},
  pairs: TopologyPair[] = [],
): Promise<TokenListResponse> {
  const { q, page = 1, page_size = 25, profileId, agentId } = params;
  const scopedPairs = buildScopedPairs(pairs, profileId, agentId);

  // `Promise.all` keeps result order aligned to `scopedPairs` regardless of
  // which request resolves first; flattening yields a deterministic list. A
  // shared-array push would order rows by network-completion time, reshuffling
  // the list on every refetch and breaking client-side pagination.
  const perPair = await Promise.all(
    scopedPairs.map(async (pair) => {
      try {
        const body = await mbPost<unknown>('/api/token/list', {}, {
          profileId: pair.profile_id,
          agentId: pair.agent_id,
        });
        const raw = extractTokenList(body);
        return raw.map((row) => normalizeToken(row, pair));
      } catch {
        // Single pair failure should not crash the whole list.
        return [] as Token[];
      }
    }),
  );
  const allItems: Token[] = perPair.flat();

  return paginate(allItems, {
    page,
    page_size,
    search: q,
    haystack: (t) => t.name,
  });
}

/* ─── generate ─────────────────────────────────────────────────── */

export async function generateToken(
  name?: string,
  pair?: { profileId?: string; agentId?: string },
): Promise<GenerateTokenResponse> {
  const reqBody: Record<string, unknown> = {};
  if (name && name.trim()) {
    reqBody.name = name.trim();
  }
  const resp = await mbPost<unknown>('/api/token/generate', reqBody, pair);
  if (!isRecord(resp)) {
    throw new Error('Unexpected response shape from /api/token/generate');
  }
  return {
    token: String(resp.token ?? ''),
    name: String(resp.name ?? ''),
    user_id: String(resp.user_id ?? ''),
  };
}

/* ─── probe (status) ───────────────────────────────────────────── */

/**
 * Determine whether a token still authenticates.
 *
 * The Main Backend exposes NO status field on tokens — `/api/token/list`
 * returns only token/name/created_at. So validity is *probed*: we call
 * `/api/token/list` with the candidate token as `X-Auth-Token`. That endpoint
 * resolves the user_id from this header alone (X-User-Id is omitted on purpose,
 * so the token itself is what gets validated) and its response is tiny — a
 * handful of tokens — regardless of account size, making it a fast, cheap check.
 *
 *   200        → token maps to a user            → 'active'
 *   401 / 403  → unbound/revoked (user_id missing) → 'revoked'
 *
 * `silentError` suppresses the global 401 toast: a revoked token is an expected
 * outcome here, not a session failure. Non-auth errors (network/5xx) re-throw so
 * the caller can show a neutral "unknown" state rather than a false 'revoked'.
 */
export async function probeToken(token: string): Promise<TokenStatus> {
  try {
    await api.post('/api/token/list', {}, {
      headers: { 'X-Auth-Token': token },
      silentError: true,
    });
    return 'active';
  } catch (err) {
    if (
      axios.isAxiosError(err) &&
      (err.response?.status === 401 || err.response?.status === 403)
    ) {
      return 'revoked';
    }
    throw err;
  }
}

/* ─── revoke ───────────────────────────────────────────────────── */

export async function revokeToken(
  token: string,
  pair?: { profileId?: string; agentId?: string },
): Promise<void> {
  await mbPost<unknown>('/api/token/revoke', { token }, pair);
}
