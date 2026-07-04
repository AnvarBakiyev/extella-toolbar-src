/**
 * RBAC stub for the standalone build.
 *
 * The bundled token IS the user's authority — whatever Main Backend permits
 * is what's possible. We surface "org_admin" unconditionally so feature pages
 * show the full action set (create, edit, delete); Main Backend will still
 * 401/403 if the token lacks permission for a specific endpoint.
 */
export type Role = 'org_admin' | 'team_admin' | 'user';

export function usePermissions(): {
  role: Role;
  isAuthenticated: boolean;
  can: (...allow: Role[]) => boolean;
} {
  return {
    role: 'org_admin',
    isAuthenticated: true,
    can: () => true,
  };
}
