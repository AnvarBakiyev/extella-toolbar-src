/**
 * TanStack Query hooks for the Tokens feature (standalone build).
 *
 * Fan-out: `useTokensList` fetches topology pairs via `usePairs()` and passes
 * them to `listTokens` so the list aggregates across all (profile, agent) pairs.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { usePairs } from '@/features/shared/useTopology';

import { listTokens, generateToken, revokeToken, probeToken } from '../api';
import type { TokenStatus } from '../api';
import type { TokenListResponse, ListTokensParams, GenerateTokenResponse } from '../schemas';

/* ─── query key factory ────────────────────────────────────────── */

export const tokenKeys = {
  all: ['tokens'] as const,
  list: (params: ListTokensParams) => [...tokenKeys.all, 'list', params] as const,
  status: (token: string) => [...tokenKeys.all, 'status', token] as const,
};

/* ─── useTokenStatus ───────────────────────────────────────────── */

/**
 * Probe a single token's validity (active/revoked). Backend has no status
 * field, so this fires one cheap `/api/token/list` call per token. Keyed by the
 * token value, so the result is cached and shared — re-renders don't re-probe.
 */
export function useTokenStatus(token: string) {
  return useQuery<TokenStatus>({
    queryKey: tokenKeys.status(token),
    queryFn: () => probeToken(token),
    staleTime: 60_000,
    retry: false,
    enabled: token.length > 0,
  });
}

/* ─── useTokensList ────────────────────────────────────────────── */

export function useTokensList(params: ListTokensParams = {}) {
  const pairs = usePairs();

  return useQuery<TokenListResponse>({
    queryKey: [...tokenKeys.list(params), { pairsCount: pairs.length }],
    queryFn: () => listTokens(params, pairs),
    staleTime: 30_000,
    enabled: pairs.length > 0,
  });
}

/* ─── useGenerateToken ─────────────────────────────────────────── */

export function useGenerateToken() {
  const qc = useQueryClient();
  return useMutation<
    GenerateTokenResponse,
    Error,
    { name?: string; profileId?: string; agentId?: string }
  >({
    mutationFn: ({ name, profileId, agentId }) =>
      generateToken(name, { profileId, agentId }),
    onSuccess: (_data, { name }) => {
      void qc.invalidateQueries({ queryKey: tokenKeys.all });
      toast.success(
        name ? `Token "${name}" generated` : 'Token generated',
      );
    },
    onError: () => {
      toast.error('Failed to generate token');
    },
  });
}

/* ─── useRevokeToken ───────────────────────────────────────────── */

export function useRevokeToken() {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { token: string; profileId?: string; agentId?: string }
  >({
    mutationFn: ({ token, profileId, agentId }) =>
      revokeToken(token, { profileId, agentId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tokenKeys.all });
      toast.success('Token revoked');
    },
    onError: () => {
      toast.error('Failed to revoke token');
    },
  });
}
