/**
 * TanStack Query hooks for the Rules feature (standalone build).
 *
 * Fan-out: `useRules` fetches topology pairs via `usePairs()` and passes
 * them to `listRules` so the list aggregates across all (profile, agent) pairs.
 * Mutations carry the pair from the row or the create-form selectors.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { usePairs } from '@/features/shared/useTopology';
import {
  createRule,
  deleteRule,
  listRules,
  updateRule,
} from '../api';
import type { RulesListResponse, ListRulesParams } from '../schemas';

/* ─── query key factory ────────────────────────────────────────────── */

export const rulesKeys = {
  all: ['rules'] as const,
  list: (params: ListRulesParams) => [...rulesKeys.all, params] as const,
};

/* ─── useRules (paginated list) ──────────────────────────────────── */

export function useRules(params: ListRulesParams = {}) {
  const pairs = usePairs();

  return useQuery<RulesListResponse>({
    queryKey: [...rulesKeys.list(params), { pairsCount: pairs.length }],
    queryFn: () => listRules(params, pairs),
    staleTime: 30_000,
    enabled: pairs.length > 0,
  });
}

/* ─── useCreateRule ─────────────────────────────────────────────── */

export function useCreateRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      text,
      profileId,
      agentId,
    }: {
      text: string;
      profileId?: string;
      agentId?: string;
    }) => createRule(text, { profileId, agentId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: rulesKeys.all });
      toast.success('Rule created');
    },
    onError: () => {
      toast.error('Failed to create rule');
    },
  });
}

/* ─── useUpdateRule ─────────────────────────────────────────────── */

export function useUpdateRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      text,
      profileId,
      agentId,
    }: {
      id: string;
      text: string;
      profileId?: string;
      agentId?: string;
    }) => updateRule(id, text, { profileId, agentId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: rulesKeys.all });
      toast.success('Rule updated');
    },
    onError: () => {
      toast.error('Failed to update rule');
    },
  });
}

/* ─── useDeleteRule ─────────────────────────────────────────────── */

export function useDeleteRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      profileId,
      agentId,
    }: {
      id: string;
      profileId?: string;
      agentId?: string;
    }) => deleteRule(id, { profileId, agentId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: rulesKeys.all });
      toast.success('Rule deleted');
    },
    onError: () => {
      toast.error('Failed to delete rule');
    },
  });
}
