/**
 * TanStack Query hooks for the Concepts feature (standalone build).
 *
 * Fan-out: `useConcepts` fetches topology pairs via `usePairs()` and passes
 * them to `listConcepts` so the list aggregates across all (profile, agent)
 * pairs. Mutations carry the pair from the row or the create-form selectors.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { usePairs } from '@/features/shared/useTopology';

import {
  createConcept,
  deleteConcept,
  listConcepts,
  updateConcept,
} from '../api';
import type { ConceptsListResponse, ListConceptsParams } from '../schemas';

/* ─── query key factory ────────────────────────────────────────── */

export const conceptsKeys = {
  all: ['intelligence', 'concepts'] as const,
  list: (params: ListConceptsParams) =>
    [...conceptsKeys.all, 'list', params] as const,
};

/* ─── useConcepts ──────────────────────────────────────────────── */

export function useConcepts(params: ListConceptsParams = {}) {
  const pairs = usePairs();

  return useQuery<ConceptsListResponse>({
    queryKey: [...conceptsKeys.list(params), { pairsCount: pairs.length }],
    queryFn: () => listConcepts(params, pairs),
    staleTime: 30_000,
    enabled: pairs.length > 0,
  });
}

/* ─── useCreateConcept ─────────────────────────────────────────── */

export function useCreateConcept() {
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
    }) => createConcept(text, { profileId, agentId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: conceptsKeys.all });
      toast.success('Concept created');
    },
    onError: () => {
      toast.error('Failed to create concept');
    },
  });
}

/* ─── useUpdateConcept ─────────────────────────────────────────── */

export function useUpdateConcept() {
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
    }) => updateConcept(id, text, { profileId, agentId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: conceptsKeys.all });
      toast.success('Concept updated');
    },
    onError: () => {
      toast.error('Failed to update concept');
    },
  });
}

/* ─── useDeleteConcept ─────────────────────────────────────────── */

export function useDeleteConcept() {
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
    }) => deleteConcept(id, { profileId, agentId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: conceptsKeys.all });
      toast.success('Concept deleted');
    },
    onError: () => {
      toast.error('Failed to delete concept');
    },
  });
}
