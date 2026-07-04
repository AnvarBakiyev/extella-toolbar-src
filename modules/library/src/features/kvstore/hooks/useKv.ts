/**
 * TanStack Query hooks for the KV Store feature (standalone build).
 *
 * Fan-out: `useKvList` fetches topology pairs via `usePairs()` and passes
 * them to `listKv` so the list aggregates across all (profile, agent) pairs.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { usePairs } from '@/features/shared/useTopology';

import { listKv, setKv, removeKv } from '../api';
import type { KvListResponse, ListKvParams } from '../schemas';

/* ─── query key factory ────────────────────────────────────────── */

export const kvKeys = {
  all: ['kvstore'] as const,
  list: (params: ListKvParams) => [...kvKeys.all, 'list', params] as const,
};

/* ─── useKvList ────────────────────────────────────────────────── */

export function useKvList(params: ListKvParams = {}) {
  const pairs = usePairs();

  return useQuery<KvListResponse>({
    queryKey: [...kvKeys.list(params), { pairsCount: pairs.length }],
    queryFn: () => listKv(params, pairs),
    staleTime: 30_000,
    enabled: pairs.length > 0,
  });
}

/* ─── useSetKv (create + update upsert) ────────────────────────── */

export function useSetKv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      key,
      value,
      description,
      profileId,
      agentId,
    }: {
      key: string;
      value: string;
      description?: string;
      profileId?: string;
      agentId?: string;
    }) => setKv(key, value, description, { profileId, agentId }),
    onSuccess: (_data, { key }, _ctx) => {
      void qc.invalidateQueries({ queryKey: kvKeys.all });
      toast.success(`KV entry "${key}" saved`);
    },
    onError: () => {
      toast.error('Failed to save KV entry');
    },
  });
}

/* ─── useRemoveKv ──────────────────────────────────────────────── */

export function useRemoveKv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      key,
      profileId,
      agentId,
    }: {
      key: string;
      profileId?: string;
      agentId?: string;
    }) => removeKv(key, { profileId, agentId }),
    onSuccess: (_data, { key }) => {
      void qc.invalidateQueries({ queryKey: kvKeys.all });
      toast.success(`KV entry "${key}" deleted`);
    },
    onError: () => {
      toast.error('Failed to delete KV entry');
    },
  });
}
