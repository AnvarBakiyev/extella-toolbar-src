import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { ScopeOverride } from '@/lib/api';
import type { TopologyPair } from '@/lib/types';
import { runExpert, checkTask, getExpert } from '../api';
import { runPhaseFromStatus, type RunPhase } from '../schemas';

/**
 * Shared run state for experts the user launches **manually** via `run(name)`.
 *
 * We hold the `task_id` from `POST /api/expert/run` and poll
 * `POST /api/tasks/check` until terminal; synchronous (`fython`) experts return
 * no task_id and resolve immediately as a fire-and-forget `launched` state.
 *
 * This context covers ONLY manual launches — they drive the "pin running
 * experts to the top of the list" behaviour. Background tasks running on the
 * device (including anything started outside this UI) are a separate population
 * with no expert mapping; they live on the Devices page via `useDeviceTasks`,
 * with a count-only banner on Experts. See docs/experts-backend-asks.md.
 *
 * The provider is mounted once on the Experts page so cards and the drawer read
 * the same state and stay in sync.
 */

const SESSION_POLL_MS = 2000;

/** A view of a single expert's run state, consumed by cards + the drawer. */
export interface RunView {
  phase: RunPhase;
  /** Raw upstream status string (e.g. "STARTED", "SUCCESS"), for display. */
  status: string | null;
  /** Terminal result text, when available. */
  result: string | null;
  taskId: string | null;
}

interface SessionRun {
  taskId: string | null;
  phase: RunPhase;
  status: string | null;
  result: string | null;
}

export interface ExpertRunsValue {
  /** Launch (or relaunch) an expert by name. `scope` pins the run to the
   *  expert's owning (profile, agent) pair — required for non-default experts,
   *  which 500 ("Expert not found") when run under the default scope.
   *  `opts.cspl` is the execution strategy when the caller already knows it
   *  (the drawer does); omit it and the run path fetches the detail on click to
   *  learn it (the list cards must, since the list endpoint omits `cspl`). */
  run: (name: string, scope?: ScopeOverride, opts?: { cspl?: string }) => void;
  /** Clear local run state for an expert (no cancel API upstream). */
  stop: (name: string) => void;
  /** Current run view for an expert, or undefined when it was never launched. */
  getRun: (name: string) => RunView | undefined;
  /** Expert names that are currently pending/running (for pinning to the top). */
  runningNames: string[];
}

const ExpertRunsContext = createContext<ExpertRunsValue | null>(null);

function isActivePhase(p: RunPhase): boolean {
  return p === 'pending' || p === 'running';
}

/** Only a positively-known async strategy is treated as async. `fython` and
 *  an unknown strategy both block the run request, so both take the synchronous
 *  (long-timeout) path — the safe default that won't abort a slow run. */
function isSyncStrategy(cspl: string | undefined): boolean {
  return cspl !== 'nohup' && cspl !== 'parallel_task' && cspl !== 'wait_tasks';
}

export function ExpertRunsProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation('experts');

  // ── Session runs (name → state) ───────────────────────────────────────────
  const [runs, setRuns] = useState<Record<string, SessionRun>>({});
  const runsRef = useRef(runs);
  runsRef.current = runs;

  // task_ids we've already toasted a terminal result for (avoid repeats).
  const toastedRef = useRef<Set<string>>(new Set());

  const run = useCallback(
    (name: string, scope?: ScopeOverride, opts?: { cspl?: string }) => {
      setRuns((prev) => ({
        ...prev,
        [name]: { taskId: null, phase: 'pending', status: null, result: null },
      }));
      void (async () => {
        try {
          // Learn the execution strategy before running. The drawer passes
          // `cspl` (it already loaded the detail); list cards don't have it —
          // the list endpoint omits `cspl` (see docs/experts-backend-asks.md
          // #9) — so fetch the detail on click. A failed probe is tolerated:
          // `cspl` stays undefined → treated as synchronous → safe long timeout.
          let cspl = opts?.cspl;
          if (cspl == null) {
            try {
              const pairs: TopologyPair[] =
                scope?.profileId && scope?.agentId
                  ? [
                      {
                        profile_id: scope.profileId,
                        profile_name: '',
                        agent_id: scope.agentId,
                        agent_name: '',
                      },
                    ]
                  : [];
              const detail = await getExpert(name, pairs);
              cspl = detail.cspl ?? undefined;
            } catch {
              /* unknown strategy — falls through as synchronous below */
            }
          }

          const sync = isSyncStrategy(cspl);
          const res = await runExpert(name, undefined, scope, { sync });

          if (res.task_id) {
            // Async run: a task was dispatched — hand off to the poller.
            setRuns((prev) => ({
              ...prev,
              [name]: {
                taskId: res.task_id ?? null,
                phase: runPhaseFromStatus(res.status),
                status: res.status ?? null,
                result: prev[name]?.result ?? null,
              },
            }));
          } else {
            // No task_id: a synchronous run with nothing to poll. Mark it
            // launched (fire-and-forget) and stop — we do not re-check status.
            setRuns((prev) => ({
              ...prev,
              [name]: { taskId: null, phase: 'launched', status: null, result: null },
            }));
            toast.success(
              t('run.toasts.launched', { name, defaultValue: '"{{name}}" launched' }),
            );
          }
        } catch (error: unknown) {
          const message =
            (error instanceof Error ? error.message : String(error)) || null;
          setRuns((prev) => ({
            ...prev,
            [name]: { taskId: null, phase: 'error', status: 'ERROR', result: message },
          }));
          toast.error(t('run.toasts.failed', 'Failed to run expert'));
        }
      })();
    },
    [t],
  );

  const stop = useCallback((name: string) => {
    setRuns((prev) => {
      if (!(name in prev)) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  // ── Poll active session tasks until terminal ────────────────────────────────
  useEffect(() => {
    const id = window.setInterval(() => {
      const cur = runsRef.current;
      const active = Object.entries(cur).filter(
        ([, r]) => r.taskId && isActivePhase(r.phase),
      );
      if (active.length === 0) return;
      active.forEach(([name, r]) => {
        const taskId = r.taskId!;
        checkTask(taskId)
          .then((res) => {
            const phase = runPhaseFromStatus(res.status);
            setRuns((prev) => {
              const prevR = prev[name];
              if (!prevR || prevR.taskId !== taskId) return prev;
              return {
                ...prev,
                [name]: {
                  ...prevR,
                  phase,
                  status: res.status ?? prevR.status,
                  result: res.result ?? prevR.result,
                },
              };
            });
            if ((phase === 'success' || phase === 'error') && !toastedRef.current.has(taskId)) {
              toastedRef.current.add(taskId);
              if (phase === 'error') toast.error(t('run.toasts.failed', 'Failed to run expert'));
              else toast.success(t('run.toasts.done', { name, defaultValue: '"{{name}}" finished' }));
            }
          })
          .catch(() => {
            /* transient; next tick retries */
          });
      });
    }, SESSION_POLL_MS);
    return () => window.clearInterval(id);
  }, [t]);

  const getRun = useCallback(
    (name: string): RunView | undefined => {
      const s = runs[name];
      if (!s) return undefined;
      return { phase: s.phase, status: s.status, result: s.result, taskId: s.taskId };
    },
    [runs],
  );

  const runningNames = useMemo(() => {
    const names: string[] = [];
    for (const [name, r] of Object.entries(runs)) {
      if (isActivePhase(r.phase)) names.push(name);
    }
    return names;
  }, [runs]);

  const value = useMemo<ExpertRunsValue>(
    () => ({ run, stop, getRun, runningNames }),
    [run, stop, getRun, runningNames],
  );

  return <ExpertRunsContext.Provider value={value}>{children}</ExpertRunsContext.Provider>;
}

/**
 * Access the shared run state. Returns a no-op fallback when used outside a
 * provider (e.g. ExpertCard reused on the Agent page), so run controls simply
 * stay hidden there instead of throwing.
 */
export function useExpertRuns(): ExpertRunsValue {
  const ctx = useContext(ExpertRunsContext);
  if (ctx) return ctx;
  return NOOP_VALUE;
}

const NOOP_VALUE: ExpertRunsValue = {
  run: () => {},
  stop: () => {},
  getRun: () => undefined,
  runningNames: [],
};
