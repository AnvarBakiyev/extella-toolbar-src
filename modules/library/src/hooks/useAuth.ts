import { getProfileId } from '@/lib/runtime';

/**
 * Standalone build runs with a single, externally-provided Main Backend token
 * (injected by the Electron preload script). There is no admin-panel session
 * to query — `useAuth` synthesises a stable user identity from the runtime
 * profile id so feature pages keep working.
 */
export interface CurrentUser {
  id: string;
  email?: string;
  display_name?: string;
  role: 'org_admin';
  force_password_change: false;
}

export function useAuth(): {
  user: CurrentUser | null;
  isLoading: false;
  isAuthenticated: boolean;
} {
  const user: CurrentUser = {
    id: getProfileId(),
    display_name: 'You',
    role: 'org_admin',
    force_password_change: false,
  };
  return {
    user,
    isLoading: false,
    isAuthenticated: true,
  };
}
