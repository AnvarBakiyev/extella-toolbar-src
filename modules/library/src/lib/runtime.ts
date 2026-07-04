/**
 * Runtime configuration provided by the Electron host.
 *
 * The Electron preload script writes the Main Backend credentials onto
 * `window` BEFORE the SPA boots:
 *
 *   contextBridge.exposeInMainWorld('__MB_BASE_URL__', 'https://api.extella.example');
 *   contextBridge.exposeInMainWorld('__MB_TOKEN__', '<api-token>');
 *   contextBridge.exposeInMainWorld('__MB_PROFILE_ID__', '<profile-uuid>');
 *   contextBridge.exposeInMainWorld('__MB_AGENT_ID__', '<agent-uuid>'); // optional
 *
 * The base URL has a hardcoded fallback so dev/preview still works without the
 * preload bridge. The token / profile / agent ids have no useful default: if
 * the token is missing the Main Backend answers 401 (`Authentication required`)
 * and the UI surfaces the error.
 */

declare global {
  interface Window {
    __MB_BASE_URL__?: string;
    __MB_TOKEN__?: string;
    __MB_PROFILE_ID__?: string;
    __MB_AGENT_ID__?: string;
    __DISNET_BASE_URL__?: string;
  }
}

/**
 * Default Main Backend URL — hardcoded per the standalone spec; the
 * Electron host can still override it at runtime via `window.__MB_BASE_URL__`.
 *
 * Matches `MAIN_BACKEND_URL` from the admin-panel root `.env`.
 */
export const DEFAULT_MB_BASE_URL = 'https://api.extella.ai';

/**
 * Default `X-Profile-Id` / `X-Agent-Id` — same values the admin-panel
 * backend uses by default (`MAIN_BACKEND_PROFILE_ID`, `MAIN_BACKEND_AGENT_ID`
 * in the root `.env`). The Electron host can override via window globals.
 */
export const DEFAULT_PROFILE_ID = 'default';
export const DEFAULT_AGENT_ID = 'agent_extella_default';

/**
 * Resolution order: `window.__MB_*` (Electron preload) → Vite env var
 * (`VITE_MB_*` from `.env.local`, dev convenience only) → hardcoded default.
 *
 * Production Electron builds rely on the preload bridge; the env-var fallback
 * exists so `npm run dev` can pick up credentials from `_standalone/.env.local`
 * without hand-poking `window.__MB_TOKEN__` in DevTools on every reload.
 */
export function getMainBackendBaseUrl(): string {
  // In `npm run dev` the browser would hit CORS calling Main Backend directly,
  // so we route through the Vite dev proxy mounted at `/__mb` instead. The
  // proxy target is configured in `vite.config.ts`. In Electron the SPA runs
  // from a `file://` origin and CORS doesn't apply, so the production build
  // uses the absolute URL directly.
  if (import.meta.env.DEV) {
    return '/__mb';
  }
  if (typeof window !== 'undefined' && window.__MB_BASE_URL__) {
    return window.__MB_BASE_URL__;
  }
  const envUrl = import.meta.env.VITE_MB_BASE_URL as string | undefined;
  if (envUrl) return envUrl;
  return DEFAULT_MB_BASE_URL;
}

export function getToken(): string {
  if (typeof window !== 'undefined' && window.__MB_TOKEN__) {
    return window.__MB_TOKEN__;
  }
  // Dev-only convenience: read the token from `.env.local` so `npm run dev`
  // works without poking `window.__MB_TOKEN__` in DevTools. Production
  // (Electron) builds intentionally have NO env fallback — Rollup tree-shakes
  // this branch out, so the token can only come from the preload bridge. When
  // it's missing the resolved value is an empty string, surfacing the absence.
  if (import.meta.env.DEV) {
    const envToken = import.meta.env.VITE_MB_TOKEN as string | undefined;
    if (envToken) return envToken;
  }
  return '';
}

export function getProfileId(): string {
  if (typeof window !== 'undefined' && window.__MB_PROFILE_ID__) {
    return window.__MB_PROFILE_ID__;
  }
  const envProfile = import.meta.env.VITE_MB_PROFILE_ID as string | undefined;
  if (envProfile) return envProfile;
  return DEFAULT_PROFILE_ID;
}

export function getAgentId(): string {
  if (typeof window !== 'undefined' && window.__MB_AGENT_ID__) {
    return window.__MB_AGENT_ID__;
  }
  const envAgent = import.meta.env.VITE_MB_AGENT_ID as string | undefined;
  if (envAgent) return envAgent;
  return DEFAULT_AGENT_ID;
}

export function hasMainBackendCredentials(): boolean {
  return Boolean(getToken());
}

/**
 * Default disnet (device task dispatcher) base URL. disnet is a SEPARATE
 * service from the Main Backend: it tracks tasks running on a device, keyed
 * by `device_name` (a device target UUID), and needs no auth header.
 */
export const DEFAULT_DISNET_BASE_URL = 'https://disnet.extella.ai';

/**
 * Resolve the disnet base URL. In `npm run dev` we route through the Vite proxy
 * at `/__disnet` to dodge CORS (same as `/__mb` for the Main Backend); in
 * Electron the SPA runs from `file://` so the absolute URL is used directly.
 */
export function getDisnetBaseUrl(): string {
  if (import.meta.env.DEV) {
    return '/__disnet';
  }
  if (typeof window !== 'undefined' && window.__DISNET_BASE_URL__) {
    return window.__DISNET_BASE_URL__;
  }
  const envUrl = import.meta.env.VITE_DISNET_BASE_URL as string | undefined;
  if (envUrl) return envUrl;
  return DEFAULT_DISNET_BASE_URL;
}

export {};
