import { useMemo } from 'react';
import { useQueries, useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { getDeviceName, getDeviceTasks, removeTask } from '@/features/experts/disnetApi';
import { runPhaseFromStatus, type RunPhase } from '@/features/experts/schemas';
import { useDevicesList } from './useDevices';

/**
 * Source of truth for "what is running in the background right now", grouped by
 * device.
 *
 * Device tasks come from the disnet dispatcher (`POST /get_tasks`), addressed by
 * a device target UUID — there is NO way to list them per expert, so this is the
 * only handle on background work. We poll `get_tasks` for every device the user
 * has (the default target + registered devices) and group the results. Tasks
 * carry only `task_id` → `status`; they are surfaced as opaque tasks, with a
 * per-task "terminate" action backed by disnet `POST /remove_task`.
 *
 * Both the Devices page (full grouped list + kill) and the Experts banner
 * (count only) share this hook, so the count and the list never disagree.
 */

const DEVICE_POLL_MS = 8000;
/** Shared query-key prefix so a kill can invalidate every device's task list. */
export const DEVICE_TASKS_KEY = 'disnet-device-tasks';

export interface ActiveDeviceTask {
  taskId: string;
  status: string;
  phase: RunPhase;
}

export interface DeviceTaskGroup {
  /** The device target UUID this task list belongs to. */
  target: string;
  /** Human label — a registered device's description, else the target UUID. */
  label: string;
  /** True for the account's default device target. */
  isDefault: boolean;
  tasks: ActiveDeviceTask[];
}

export interface UseDeviceTasksResult {
  /** Devices that currently have at least one active background task. */
  groups: DeviceTaskGroup[];
  /** Total active tasks across all devices (drives the Experts banner). */
  totalCount: number;
  isLoading: boolean;
}

interface DeviceTarget {
  target: string;
  label: string;
  isDefault: boolean;
}

function isActivePhase(p: RunPhase): boolean {
  return p === 'pending' || p === 'running';
}

/** The full device set to poll: default target first, then registered devices. */
function useDeviceTargets(): DeviceTarget[] {
  const defaultQuery = useQuery({
    queryKey: ['disnet-device-name'],
    queryFn: getDeviceName,
    staleTime: Infinity,
    retry: 1,
  });
  // page_size 100 covers any realistic device count in one page.
  const devicesList = useDevicesList({ page_size: 100 });

  return useMemo(() => {
    const out: DeviceTarget[] = [];
    const seen = new Set<string>();
    const def = defaultQuery.data ?? null;
    if (def) {
      out.push({ target: def, label: def, isDefault: true });
      seen.add(def);
    }
    for (const d of devicesList.data?.items ?? []) {
      if (!d.target || seen.has(d.target)) continue;
      seen.add(d.target);
      out.push({ target: d.target, label: d.description || d.target, isDefault: false });
    }
    return out;
  }, [defaultQuery.data, devicesList.data]);
}

export function useDeviceTasks(): UseDeviceTasksResult {
  const targets = useDeviceTargets();

  const results = useQueries({
    queries: targets.map((dt) => ({
      queryKey: [DEVICE_TASKS_KEY, dt.target],
      queryFn: () => getDeviceTasks(dt.target),
      enabled: Boolean(dt.target),
      refetchInterval: DEVICE_POLL_MS,
      retry: false,
    })),
  });

  const groups = useMemo<DeviceTaskGroup[]>(() => {
    return targets
      .map((dt, i) => {
        const raw = results[i]?.data ?? [];
        const tasks = raw
          .map((tk) => ({ taskId: tk.taskId, status: tk.status, phase: runPhaseFromStatus(tk.status) }))
          // Only surface live work — a device may also report terminal ids.
          .filter((tk) => isActivePhase(tk.phase));
        return { target: dt.target, label: dt.label, isDefault: dt.isDefault, tasks };
      })
      .filter((g) => g.tasks.length > 0);
    // `results` is a fresh array each render but the memo body is cheap.
  }, [targets, results]);

  const totalCount = useMemo(() => groups.reduce((n, g) => n + g.tasks.length, 0), [groups]);
  const isLoading = results.some((r) => r.isLoading);

  return { groups, totalCount, isLoading };
}

/**
 * Terminate a background task by id (disnet `/remove_task`). On success every
 * device's task list is invalidated so the killed task disappears immediately
 * rather than waiting for the next poll.
 */
export function useRemoveDeviceTask() {
  const qc = useQueryClient();
  const { t } = useTranslation('devices');
  return useMutation({
    mutationFn: (taskId: string) => removeTask(taskId),
    onSuccess: (res) => {
      if (res.removed) {
        toast.success(t('backgroundTasks.killed', 'Task terminated'));
      } else {
        toast.message(t('backgroundTasks.killNoop', 'Task was no longer running'));
      }
      qc.invalidateQueries({ queryKey: [DEVICE_TASKS_KEY] });
    },
    onError: () => {
      toast.error(t('backgroundTasks.killFailed', 'Failed to terminate task'));
    },
  });
}
