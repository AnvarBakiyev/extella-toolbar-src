import axios from 'axios';
import { mbPost } from '@/lib/api';
import { getDisnetBaseUrl } from '@/lib/runtime';
import { deviceTasksResponseSchema } from './schemas';

/**
 * disnet (device task dispatcher) client.
 *
 * disnet is a SEPARATE backend from the Main Backend (Extella). It tracks tasks
 * running on a device, addressed by `device_name` — a device *target* UUID, the
 * same value the Main Backend returns from `/api/defaults/get_target`. Requests
 * carry no auth header; the device_name in the body is the only identity.
 *
 * Verified contract (disnet OpenAPI 1.0.12, 2026-06-12):
 *   POST /get_tasks      { device_name: uuid } → { tasks: { <task_id>: <status> } }
 *   POST /remove_task    { task_id: uuid }     → { removed: boolean, task_id }
 *
 * IMPORTANT: `/get_tasks` returns only task_id → status, with NO expert name.
 * There is no reliable way to map a device task back to a library expert, so
 * callers surface them as opaque tasks (see `useDeviceTasks`).
 */

const disnet = axios.create({
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
});

async function disnetPost<T = unknown>(path: string, body: object): Promise<T> {
  const { data } = await disnet.post<T>(`${getDisnetBaseUrl()}${path}`, body);
  return data;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export interface DeviceTask {
  taskId: string;
  status: string;
}

/**
 * The device target UUID used as `device_name` for disnet. Sourced from the
 * Main Backend default target. Returns null when no target is configured.
 */
export async function getDeviceName(): Promise<string | null> {
  const body = await mbPost<unknown>('/api/defaults/get_target', {});
  const target = asRecord(body).target;
  return typeof target === 'string' && target.length > 0 ? target : null;
}

/** List the device's tasks as `{ taskId, status }[]`. Empty on any parse miss. */
export async function getDeviceTasks(deviceName: string): Promise<DeviceTask[]> {
  const data = await disnetPost('/get_tasks', { device_name: deviceName });
  const parsed = deviceTasksResponseSchema.safeParse(data);
  if (!parsed.success) return [];
  return Object.entries(parsed.data.tasks).map(([taskId, status]) => ({ taskId, status }));
}

export interface RemoveTaskResult {
  removed: boolean;
  taskId: string;
}

/**
 * Terminate a running task by id. disnet keys this by `task_id` alone — no
 * device_name needed. The call is idempotent: an unknown/already-gone id
 * returns `{ removed: false }` (HTTP 200), not an error.
 */
export async function removeTask(taskId: string): Promise<RemoveTaskResult> {
  const data = await disnetPost('/remove_task', { task_id: taskId });
  const obj = asRecord(data);
  return {
    removed: Boolean(obj.removed),
    taskId: typeof obj.task_id === 'string' ? obj.task_id : taskId,
  };
}
