/**
 * TanStack Query hooks for the Devices feature (standalone build).
 *
 * Fan-out: `useDevicesList` fetches topology pairs via `usePairs()` and passes
 * them to `listDevices` so the list aggregates across all (profile, agent) pairs.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useDebounce } from '@/hooks/useDebounce';
import { usePairs } from '@/features/shared/useTopology';

import {
  listDevices,
  getDevice,
  createDevice,
  updateDevice,
  removeDevice,
  getDefaultTarget,
  setDefaultTarget,
} from '../api';
import type {
  DevicesListResponse,
  ListDevicesParams,
  CreateDeviceBody,
  UpdateDeviceBody,
} from '../schemas';

/* ─── query key factory ────────────────────────────────────────── */

export const deviceKeys = {
  all: ['devices'] as const,
  list: (params: ListDevicesParams) => [...deviceKeys.all, 'list', params] as const,
  detail: (id: string) => [...deviceKeys.all, 'detail', id] as const,
  default: () => [...deviceKeys.all, 'default'] as const,
};

/* ─── useDevicesList ───────────────────────────────────────────── */

export function useDevicesList(params: ListDevicesParams = {}) {
  const {
    q,
    page = 1,
    page_size = 25,
    sort_key = 'recent',
    sort_dir = 'desc',
    profileId,
    agentId,
  } = params;

  const debouncedQ = useDebounce(q ?? '', 500);
  const pairs = usePairs();

  const query = useQuery<DevicesListResponse>({
    queryKey: [...deviceKeys.list({
      q: debouncedQ,
      page,
      page_size,
      sort_key,
      sort_dir,
      profileId,
      agentId,
    }), { pairsCount: pairs.length }],
    queryFn: () =>
      listDevices({
        q: debouncedQ || undefined,
        page,
        page_size,
        sort_key,
        sort_dir,
        profileId,
        agentId,
      }, pairs),
    // No placeholderData — same as Concepts. A new search shows the loading
    // state instead of the previous search's rows, so stale results never
    // linger at the top of a fresh query.
    staleTime: 30_000,
    enabled: pairs.length > 0,
  });

  // True from the first keystroke (debounce window) through the network
  // round-trip, but only while there is an actual query term — so the search
  // box can show an in-progress spinner.
  const isSearching =
    ((q ?? '').trim() !== '' && (q ?? '') !== debouncedQ) ||
    (debouncedQ.trim() !== '' && query.isFetching);

  return { ...query, isSearching };
}

/* ─── useDevice ────────────────────────────────────────────────── */

export function useDevice(id: string | null | undefined) {
  return useQuery({
    queryKey: deviceKeys.detail(id ?? ''),
    queryFn: () => getDevice(id!),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

/* ─── useDefaultDevice ─────────────────────────────────────────── */

export function useDefaultDevice() {
  return useQuery({
    queryKey: deviceKeys.default(),
    queryFn: () => getDefaultTarget(),
    staleTime: 60_000,
  });
}

/* ─── useSetDefaultDevice ──────────────────────────────────────── */

export function useSetDefaultDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (target: string) => setDefaultTarget(target),
    onSuccess: (_data, target) => {
      void qc.invalidateQueries({ queryKey: deviceKeys.all });
      toast.success(`Default device set to "${target}"`);
    },
    onError: () => {
      toast.error('Failed to set default device');
    },
  });
}

/* ─── useCreateDevice ──────────────────────────────────────────── */

export function useCreateDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      body,
      profileId,
      agentId,
    }: {
      body: CreateDeviceBody;
      profileId?: string;
      agentId?: string;
    }) => createDevice(body, { profileId, agentId }),
    onSuccess: (_data, { body: { target } }) => {
      void qc.invalidateQueries({ queryKey: deviceKeys.all });
      toast.success(`Device "${target}" created`);
    },
    onError: () => {
      toast.error('Failed to create device');
    },
  });
}

/* ─── useUpdateDevice ──────────────────────────────────────────── */

export function useUpdateDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
      defaultTarget,
      profileId,
      agentId,
    }: {
      id: string;
      body: UpdateDeviceBody;
      defaultTarget?: string | null;
      profileId?: string;
      agentId?: string;
    }) => updateDevice(id, body, defaultTarget, { profileId, agentId }),
    onSuccess: (_data, { body }) => {
      void qc.invalidateQueries({ queryKey: deviceKeys.all });
      toast.success(`Device "${body.target ?? 'device'}" updated`);
    },
    onError: () => {
      toast.error('Failed to update device');
    },
  });
}

/* ─── useDeleteDevice ──────────────────────────────────────────── */

export function useDeleteDevice() {
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
    }) => removeDevice(id, { profileId, agentId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: deviceKeys.all });
      toast.success('Device deleted');
    },
    onError: () => {
      toast.error('Failed to delete device');
    },
  });
}
