/**
 * Pure permission helpers for Rules / Concepts screens.
 *
 * Single-user standalone build: there is no admin role and no approval flow,
 * so the user can always edit / delete / force-create, and nothing is ever
 * read-only or pending. The publish / recall / resubmit verbs no longer apply
 * and always return false. Signatures are kept stable so existing callers
 * keep compiling.
 */

import type { Role } from '@/hooks/usePermissions';

/** Minimal item shape required by the helpers. */
export interface RCItem {
  status?: string | null;
  author_id?: string | null;
}

/** Current user id from useAuth().user.id */
export type UserId = string;

/** The single user can always edit. */
export function canEdit(_role: Role | null, _item: RCItem, _currentUserId: UserId): boolean {
  return true;
}

/** No approval flow — publishing is not a separate action. */
export function canPublish(_role: Role | null, _item: RCItem, _currentUserId: UserId): boolean {
  return false;
}

/** No approval flow — nothing to resubmit. */
export function canResubmit(_role: Role | null, _item: RCItem, _currentUserId: UserId): boolean {
  return false;
}

/** No approval flow — nothing to recall. */
export function canRecall(_role: Role | null, _item: RCItem, _currentUserId: UserId): boolean {
  return false;
}

/** Nothing is read-only for the single user. */
export function isReadonly(_role: Role | null, _item: RCItem, _currentUserId: UserId): boolean {
  return false;
}

/** The single user can always force-create. */
export function canForceCreate(_role: Role | null): boolean {
  return true;
}

/** The single user can always delete. */
export function canDelete(_role: Role | null): boolean {
  return true;
}
