import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
  clearExpertsTrash,
  deleteExpert,
  listTrashedExperts,
  restoreExpert,
  runExpert,
  checkTask,
  shareExpert,
} from '../api';
import { EXPERTS_LIST_KEY } from './useExpertsList';
import { EXPERT_DETAIL_KEY } from './useExpert';
import {
  isTerminalStatus,
  type ExpertsTrashList,
  type RunExpertResult,
  type TaskStatusResult,
} from '../schemas';

export const EXPERTS_TRASH_KEY = 'experts-trash';

/**
 * Soft-delete an expert (moves it to the upstream trash bin, v0.8.0).
 * On success the catalogue list cache is invalidated and the trash list
 * cache is refreshed so the row appears under "Trash" without a page reload.
 */
export function useDeleteExpert() {
  const qc = useQueryClient();
  const { t } = useTranslation('experts');
  return useMutation({
    mutationFn: ({
      name,
      profileId,
      agentId,
    }: {
      name: string;
      profileId?: string;
      agentId?: string;
    }) => deleteExpert(name, { profileId, agentId }),
    onSuccess: (_, { name }) => {
      toast.success(t('trash.toasts.deleted', 'Moved to trash'));
      qc.invalidateQueries({ queryKey: [EXPERTS_LIST_KEY] });
      qc.invalidateQueries({ queryKey: [EXPERTS_TRASH_KEY] });
      qc.removeQueries({ queryKey: [EXPERT_DETAIL_KEY, name] });
    },
    onError: () => {
      toast.error(t('trash.toasts.deleteFailed', 'Failed to delete expert'));
    },
  });
}

/**
 * Query hook for the trash bin contents. Enabled by callers via the
 * `enabled` arg so we don't fetch trash on every page mount — only when the
 * user actually flips the toggle.
 */
export function useExpertsTrash(enabled: boolean) {
  return useQuery<ExpertsTrashList>({
    queryKey: [EXPERTS_TRASH_KEY],
    queryFn: () => listTrashedExperts(),
    enabled,
    staleTime: 15_000,
  });
}

/**
 * Permanently empty the trash bin (bulk-only — upstream has no per-item
 * purge). After success, the trash query is reset and the live list is
 * invalidated to keep both views honest.
 */
export function useClearExpertsTrash() {
  const qc = useQueryClient();
  const { t } = useTranslation('experts');
  return useMutation({
    mutationFn: () => clearExpertsTrash(),
    onSuccess: (result) => {
      toast.success(
        t('trash.toasts.cleared', {
          count: result.experts_removed,
          defaultValue: 'Trash emptied · {{count}} experts purged',
        }),
      );
      qc.invalidateQueries({ queryKey: [EXPERTS_TRASH_KEY] });
      qc.invalidateQueries({ queryKey: [EXPERTS_LIST_KEY] });
    },
    onError: () => {
      toast.error(t('trash.toasts.clearFailed', 'Failed to empty trash'));
    },
  });
}

/**
 * Restore one trashed expert back into the catalogue.
 */
export function useRestoreExpert() {
  const qc = useQueryClient();
  const { t } = useTranslation('experts');
  return useMutation({
    mutationFn: (name: string) => restoreExpert(name),
    onSuccess: () => {
      toast.success(t('trash.toasts.restored', 'Expert restored'));
      qc.invalidateQueries({ queryKey: [EXPERTS_TRASH_KEY] });
      qc.invalidateQueries({ queryKey: [EXPERTS_LIST_KEY] });
    },
    onError: () => {
      toast.error(t('trash.toasts.restoreFailed', 'Failed to restore expert'));
    },
  });
}

// ─── Run + Task polling ────────────────────────────────────────────────────────

export const TASK_STATUS_KEY = 'expert-task-status';

/**
 * Mutation hook that kicks off an async expert run.
 * Returns a `RunExpertResult` with a `task_id` that callers pass to
 * `useTaskStatus` for polling.
 */
export function useRunExpert() {
  const { t } = useTranslation('experts');
  return useMutation<
    RunExpertResult,
    Error,
    { name: string; params?: Record<string, unknown>; profileId?: string; agentId?: string }
  >({
    mutationFn: ({ name, params, profileId, agentId }) =>
      runExpert(name, params, { profileId, agentId }),
    onError: () => {
      toast.error(t('run.toasts.failed', 'Failed to run expert'));
    },
  });
}

/**
 * Polling query for a running task. Enabled only when `taskId` is non-null.
 * Polls every 2 seconds until the status becomes terminal, then stops.
 */
export function useTaskStatus(taskId: string | null) {
  return useQuery<TaskStatusResult>({
    queryKey: [TASK_STATUS_KEY, taskId],
    queryFn: () => checkTask(taskId!),
    enabled: Boolean(taskId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return isTerminalStatus(status) ? false : 2000;
    },
    staleTime: 0,
  });
}

// ─── Share ─────────────────────────────────────────────────────────────────────

/**
 * Mutation hook for sharing an expert with a recipient (by token).
 * On success the recipient token is intentionally NOT surfaced in the toast.
 */
export function useShareExpert() {
  const { t } = useTranslation('experts');
  return useMutation({
    mutationFn: ({
      name,
      recipientToken,
      profileId,
      agentId,
    }: {
      name: string;
      recipientToken: string;
      profileId?: string;
      agentId?: string;
    }) => shareExpert(name, recipientToken, { profileId, agentId }),
    onSuccess: (_, { name }) => {
      toast.success(
        t('share.toasts.success', { name, defaultValue: '"{{name}}" shared successfully' }),
      );
    },
    onError: () => {
      toast.error(t('share.toasts.failed', 'Failed to share expert'));
    },
  });
}
