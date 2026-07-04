import axios, {
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios';
import { toast } from 'sonner';

declare module 'axios' {
  interface AxiosRequestConfig {
    /** When true, the response interceptor skips the global error toast for
     *  this request — the caller handles the failure itself (fan-out probes). */
    silentError?: boolean;
  }
}
import {
  getAgentId,
  getMainBackendBaseUrl,
  getProfileId,
  getToken,
} from './runtime';

/**
 * Direct HTTP client for Main Backend (Extella) v0.6.11+.
 *
 * Wire contract — mirrors `apps/backend/src/main_backend/http.py` exactly:
 *   - All endpoints are POST; the path is the only verb hint.
 *   - `X-Auth-Token` header is the caller credential — required on every request.
 *     Missing → 401 (`Authentication required`).
 *   - `X-Profile-Id` is required for any endpoint that resolves a profile
 *     server-side (concepts, rules, agent list, etc.). Missing → 401.
 *   - `X-Agent-Id` is optional for most endpoints.
 *   - Bodies are JSON. Field names are NOT canonical — `concept_id`/`concept_text`,
 *     `rule`/`rule_id`, `expert_name`/`expert_code`, `createdAt`/`updatedAt`.
 *     Normalization happens in feature/<x>/api.ts at the boundary so UI code
 *     only ever sees a single shape (id/text/created_at/updated_at).
 *
 * The token + profile/agent ids are sourced from `lib/runtime.ts` on every
 * request via the request interceptor so the Electron host can hot-swap them
 * without rebuilding the SPA.
 */
export const api: AxiosInstance = axios.create({
  baseURL: getMainBackendBaseUrl(),
  timeout: 30_000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  // Re-resolve base URL on every request — the Electron host may inject it
  // late (preload script runs before the SPA, but the SPA may import this
  // module before window.__MB_BASE_URL__ is set when bundled differently).
  if (!config.baseURL || config.baseURL === api.defaults.baseURL) {
    config.baseURL = getMainBackendBaseUrl();
  }

  const token = getToken();
  // Do NOT clobber an X-Auth-Token already present on the per-request config
  // (used by shareExpert to save as a different user via mbPostAs).
  if (!config.headers.has('X-Auth-Token') && token) {
    config.headers.set('X-Auth-Token', token);
  }

  // Do NOT clobber X-Profile-Id / X-Agent-Id already set on the per-request
  // config (used by mbPost/mbPostAs with a {profileId, agentId} override for
  // multi-profile fan-out). Only inject the runtime defaults when the header
  // is absent — mirrors the X-Auth-Token guard above.
  if (!config.headers.has('X-Profile-Id')) {
    const profileId = getProfileId();
    if (profileId) {
      config.headers.set('X-Profile-Id', profileId);
    }
  }
  if (!config.headers.has('X-Agent-Id')) {
    const agentId = getAgentId();
    if (agentId) {
      config.headers.set('X-Agent-Id', agentId);
    }
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (!axios.isAxiosError(error)) return Promise.reject(error);

    // Caller-handled requests opt out of the global error toast. Used by the
    // topology-pair fan-out (getExpert/listExperts), where most pairs return
    // 500/404 by design — the caller tolerates per-pair failure and only
    // surfaces a problem when EVERY probe fails. Without this, a single drawer
    // open fires one "Server error" toast per non-owning pair.
    if (error.config?.silentError) {
      return Promise.reject(error);
    }

    const status = error.response?.status;

    if (status === 401) {
      toast.error('Authorization failed. Please re-launch the app.');
    } else if (status === 429) {
      const retryAfter = error.response?.headers?.['retry-after'];
      toast.warning(
        retryAfter
          ? `Too many requests. Retry in ${retryAfter}s.`
          : 'Too many requests.',
      );
    } else if (status && status >= 500) {
      toast.error('Server error. Please try again.');
    }
    return Promise.reject(error);
  },
);

/**
 * Per-call scope override — pass `{ profileId, agentId }` to pin the request
 * to a specific (profile, agent) pair without mutating global state. The
 * interceptor's no-clobber guard ensures these headers are not overwritten by
 * the runtime defaults when already present.
 */
export interface ScopeOverride {
  profileId?: string;
  agentId?: string;
}

/**
 * Per-call request options. `silent: true` suppresses the global error toast
 * for requests whose failure the caller handles itself — notably the
 * topology-pair fan-out, where most pairs are expected to 404/500.
 */
export interface MbRequestOptions {
  silent?: boolean;
  /** Per-request timeout in ms, overriding the axios instance default (30s).
   *  Needed for synchronous (`fython`) expert runs, which block upstream for
   *  the full execution and routinely exceed 30s. */
  timeout?: number;
}

/**
 * Convenience helper: POST to a Main Backend endpoint with the standard
 * `{...}` body and return the parsed JSON.
 *
 * Most Main Backend endpoints are POST even for reads (see http.py for the
 * full surface: `/api/concept/list`, `/api/rules/list`, etc.).
 *
 * Pass an optional `scope` to override the default profile/agent identity for
 * this specific request (used in fan-out across topology pairs).
 */
export async function mbPost<T = unknown>(
  path: string,
  body: object = {},
  scope?: ScopeOverride,
  opts?: MbRequestOptions,
): Promise<T> {
  const extraHeaders: Record<string, string> = {};
  if (scope?.profileId) extraHeaders['X-Profile-Id'] = scope.profileId;
  if (scope?.agentId) extraHeaders['X-Agent-Id'] = scope.agentId;

  const { data } = await api.post<T>(path, body, {
    headers: Object.keys(extraHeaders).length > 0 ? extraHeaders : undefined,
    silentError: opts?.silent,
    ...(opts?.timeout != null ? { timeout: opts.timeout } : {}),
  });
  return data;
}

/**
 * Like mbPost, but issues the request with a specific `X-Auth-Token` header,
 * overriding the default credential from runtime. Used by shareExpert to save
 * an expert as a different (recipient) user without mutating global state.
 *
 * Also accepts an optional `scope` to override the profile/agent pair, same
 * as `mbPost`.
 *
 * The request interceptor intentionally skips writing X-Auth-Token / X-Profile-Id
 * / X-Agent-Id when those headers are already set on the per-request config.
 */
export async function mbPostAs<T = unknown>(
  path: string,
  body: object,
  opts: { token: string } & ScopeOverride,
): Promise<T> {
  const extraHeaders: Record<string, string> = {
    'X-Auth-Token': opts.token,
  };
  if (opts.profileId) extraHeaders['X-Profile-Id'] = opts.profileId;
  if (opts.agentId) extraHeaders['X-Agent-Id'] = opts.agentId;

  const { data } = await api.post<T>(path, body, {
    headers: extraHeaders,
  });
  return data;
}
