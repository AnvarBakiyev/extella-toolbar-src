import { z } from 'zod';

/**
 * Expert type classification. Derived heuristically from name/description
 * since the upstream Main Backend API does not expose a `type` field.
 */
export const EXPERT_TYPE_VALUES = [
  'code',
  'writing',
  'analysis',
  'research',
  'translate',
  'review',
  'domain',
  'legal',
  'general',
] as const;

export type ExpertType = (typeof EXPERT_TYPE_VALUES)[number];

/**
 * Design-system color per expert type. Matches the palette in experts-data.jsx
 * so the visual language is consistent.
 */
export const EXPERT_TYPE_COLORS: Record<ExpertType, string> = {
  code: 'oklch(0.6 0.16 195)',
  writing: 'oklch(0.62 0.18 220)',
  analysis: 'oklch(0.62 0.14 145)',
  research: 'oklch(0.65 0.18 290)',
  translate: 'oklch(0.62 0.14 70)',
  review: 'oklch(0.6 0.18 25)',
  domain: 'oklch(0.58 0.16 165)',
  legal: 'oklch(0.55 0.05 250)',
  general: 'oklch(0.58 0.12 240)',
};

/**
 * Heuristic type classifier. Looks for keywords in name + description.
 * Falls back to 'general'. Main Backend has no upstream type field; this is
 * purely UI-derived.
 */
export function deriveExpertType(name: string, description?: string): ExpertType {
  const blob = `${name} ${description ?? ''}`.toLowerCase();
  if (/код|code|sql|api|openapi|debug|bug|regex|регекс|typescript|javascript|python|node|react|backend|frontend|devops|terraform|k8s|query|запрос/.test(blob)) return 'code';
  if (/текст|writing|blog|блог|контент|content|copywrite|microcopy|саммари|summary|draft|шаблон|template|press|release|ответ|onboarding/.test(blob)) return 'writing';
  if (/анализ|analysis|анали|metric|метрик|dashboard|ltv|cac|roi|ab|a\/b|data|данн|cohort|когорт|unit economics|attribution/.test(blob)) return 'analysis';
  if (/ресёрч|research|competitor|конкурент|market|рынок|patent|патент|interview|интервью|hypothesis|гипотез/.test(blob)) return 'research';
  if (/перевод|translate|translation|перевод|локализ|locali|rtl|plural/.test(blob)) return 'translate';
  if (/ревью|review|audit|аудит|check|чеклист|checklist|critic|критик|security|безопасн|accessibility|wcag/.test(blob)) return 'review';
  if (/домен|domain|hr|career|карьер|okr|onboarding|manager|менеджер|product|продукт|pricing|цен|procurement|закупк/.test(blob)) return 'domain';
  if (/legal|law|gdpr|privacy|contract|контракт|compliance|соответствие|nda|patent|tax|налог/.test(blob)) return 'legal';
  return 'general';
}

// ─── Expert summary (list item) ───────────────────────────────────────────────

export const expertSummarySchema = z.object({
  /** Upstream `id` (string) — needed for routing/keys. */
  id: z.string().optional(),
  name: z.string(),
  description: z.string().nullish().transform(v => v ?? ''),
  /** Upstream may send null for these — use nullish so both null/undefined
   *  collapse to undefined post-parse. */
  code: z.string().nullish(),
  params: z.record(z.unknown()).nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  is_active: z.boolean().nullish(),
  owner_id: z.string().nullish(),
  /** UI-derived fields (not from API). `type` is nullish — backend literally
   *  returns null when no type, the heuristic in `deriveExpertType` runs UI-side. */
  type: z.enum(EXPERT_TYPE_VALUES).nullish(),
  deps_count: z.number().nullish(),
  /** Profile + Agent label fields — injected by fan-out, not from upstream. */
  profile_id: z.string().nullish(),
  profile_name: z.string().nullish(),
  agent_id: z.string().nullish(),
  agent_name: z.string().nullish(),
  /** UI-derived: true when the expert is returned under every scoped pair
   *  (a built-in/global expert). Not from upstream. */
  is_global: z.boolean().nullish(),
});

export type ExpertSummary = z.infer<typeof expertSummarySchema>;

// ─── Expert detail (single expert) ────────────────────────────────────────────

export const expertDetailSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  description: z.string().nullish().transform(v => v ?? ''),
  code: z.string().nullish(),
  // Backend types `params` as `list[Any] | dict[str, Any] | None` — accept both.
  params: z.union([z.record(z.unknown()), z.array(z.unknown())]).nullish(),
  /** Code-style/language tag, e.g. "fython". Comes from upstream's `cspl`. */
  cspl: z.string().nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  is_active: z.boolean().nullish(),
  owner_id: z.string().nullish(),
  type: z.enum(EXPERT_TYPE_VALUES).nullish(),
  /** Profile + Agent label fields — injected by fan-out, not from upstream. */
  profile_id: z.string().nullish(),
  profile_name: z.string().nullish(),
  agent_id: z.string().nullish(),
  agent_name: z.string().nullish(),
  /** UI-derived: true when the expert resolves under every scoped pair. */
  is_global: z.boolean().nullish(),
});

export type ExpertDetail = z.infer<typeof expertDetailSchema>;

// ─── Dependencies (always empty in iteration 1) ────────────────────────────────

const depRefSchema = z.object({
  id: z.string(),
  kind: z.string(),
  name: z.string().optional(),
  title: z.string().optional(),
});

export const dependenciesSchema = z.object({
  depends_on: z.array(depRefSchema).default([]),
  used_by: z.array(depRefSchema).default([]),
});

export type ExpertDependencies = z.infer<typeof dependenciesSchema>;

// ─── Paginated list ──────────────────────────────────────────────────────────

export const paginatedExpertsSchema = z.object({
  items: z.array(expertSummarySchema),
  page: z.number(),
  page_size: z.number(),
  total: z.number(),
  has_more: z.boolean(),
});

export type PaginatedExperts = z.infer<typeof paginatedExpertsSchema>;

// ─── Query params ─────────────────────────────────────────────────────────────

export type SortKey = 'recent' | 'name' | 'type';
export type SortDir = 'asc' | 'desc';
export type ViewMode = 'grid' | 'list';

export interface ListExpertsParams {
  q?: string;
  page?: number;
  page_size?: number;
  scope?: 'mine' | 'org';
  /** UI-derived type filter. Empty/undefined → no filter. Applied catalogue-wide
   *  in `listExperts` BEFORE pagination, so filtered totals are correct. */
  types?: ExpertType[];
  /** Sort key. Defaults to 'recent' when undefined. Applied catalogue-wide. */
  sort_key?: SortKey;
  /** Sort direction. Defaults to 'desc' when undefined. */
  sort_dir?: SortDir;
  /** Scope filter for topology fan-out. */
  profileId?: string;
  agentId?: string;
}

// ─── Trash (Studio v2 §3.A, v0.8.0) ──────────────────────────────────────────

export const trashedExpertSchema = z.object({
  id: z.string().nullish(),
  name: z.string(),
  description: z.string().nullish().transform(v => v ?? ''),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  deleted_at: z.string().nullish(),
});

export type TrashedExpert = z.infer<typeof trashedExpertSchema>;

export const trashListSchema = z.object({
  experts: z.array(trashedExpertSchema),
  retention_days: z.number().int().nonnegative(),
});

export type ExpertsTrashList = z.infer<typeof trashListSchema>;

export const trashClearSchema = z.object({
  experts_removed: z.number().int().nonnegative(),
  pipelines_removed: z.number().int().nonnegative(),
});

export type TrashClearResult = z.infer<typeof trashClearSchema>;

export const trashRestoreSchema = z.object({
  restored: z.boolean(),
});

export type TrashRestoreResult = z.infer<typeof trashRestoreSchema>;

// ─── Run / Task polling ────────────────────────────────────────────────────────

/**
 * Upstream `POST /api/expert/run` response shape.
 * `wait: false` means we always get a task_id back (async execution).
 */
export const runExpertResultSchema = z.object({
  status: z.string(),
  expert_name: z.string(),
  result: z.string().nullish().transform(v => v ?? ''),
  task_id: z.string().nullish(),
  execution_log: z.array(z.string()).default([]),
  run_time_ms: z.number().nullish(),
});

export type RunExpertResult = z.infer<typeof runExpertResultSchema>;

/**
 * Upstream `POST /api/tasks/check` response shape.
 * Terminal statuses (case-insensitive): SUCCESS, FAILURE, DONE, ERROR.
 */
export const taskStatusResultSchema = z.object({
  task_id: z.string(),
  status: z.string().nullish(),
  result: z.string().nullish(),
});

export type TaskStatusResult = z.infer<typeof taskStatusResultSchema>;

/** Return true when a task status string represents a terminal state. */
export function isTerminalStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  const upper = status.toUpperCase();
  return upper === 'SUCCESS' || upper === 'FAILURE' || upper === 'DONE' || upper === 'ERROR';
}

/**
 * Coarse run lifecycle phase used by the run UI (button states, status pills).
 * - `idle`    — never run / nothing to show.
 * - `pending` — request in flight, OR task accepted but not yet picked up by a
 *               worker (PENDING / QUEUED / RECEIVED / no status yet).
 * - `running` — worker is executing (STARTED / RUNNING / PROGRESS).
 * - `launched` — terminal, fire-and-forget. A synchronous (`fython`) run that
 *               returned no `task_id`: there is nothing to poll, so we mark it
 *               launched and stop tracking it. Set explicitly, never derived
 *               from a status string.
 * - `success` / `error` — terminal.
 */
export type RunPhase = 'idle' | 'pending' | 'running' | 'launched' | 'success' | 'error';

/** Map a raw upstream task status string to a {@link RunPhase}. */
export function runPhaseFromStatus(status: string | null | undefined): RunPhase {
  if (!status) return 'pending';
  const u = status.toUpperCase();
  if (u === 'SUCCESS' || u === 'DONE') return 'success';
  if (u === 'FAILURE' || u === 'ERROR') return 'error';
  if (
    u === 'STARTED' ||
    u === 'RUNNING' ||
    u === 'PROGRESS' ||
    u === 'IN_PROGRESS' ||
    u === 'EXECUTING'
  ) {
    return 'running';
  }
  // PENDING, QUEUED, RECEIVED, RETRY, SCHEDULED, …
  return 'pending';
}

/**
 * disnet `POST /get_tasks` response — a flat map of task_id → status string.
 * (Per the disnet OpenAPI schema: `tasks` has uuid keys and string values.)
 */
export const deviceTasksResponseSchema = z.object({
  tasks: z.record(z.string(), z.string()).default({}),
});

// ─── Share ─────────────────────────────────────────────────────────────────────

/**
 * Upstream `POST /api/expert/save` response shape (used by shareExpert).
 */
export const shareExpertResultSchema = z.object({
  status: z.string(),
  expert_name: z.string(),
  user_id: z.string().nullish(),
});

export type ShareExpertResult = z.infer<typeof shareExpertResultSchema>;
