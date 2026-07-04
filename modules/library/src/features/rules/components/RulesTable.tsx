/**
 * Rules table — role-aware.
 * Ported from docs/design/style/source/rules/rules-section.jsx::RulesTable.
 *
 * Columns: Title+preview, Profile / Agent, Date, Actions
 *
 * "In prompt" toggle column HIDDEN per iter-1 spec.
 */

import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui/skeleton';
import { RCStatusBadge } from '@/components/shared/RCStatusBadge';
import { RowActionsMenu } from '@/components/shared/RowActionsMenu';
import { ProfileAgentBadge } from '@/components/shared/ProfileAgentBadge';
import type { Rule } from '../schemas';
import type { ProfileAgentLabel } from '@/lib/types';
import type { Role } from '@/hooks/usePermissions';
import type { AppLocale } from '@/lib/format';
import { formatDate } from '@/lib/format';

/* ─── helpers ───────────────────────────────────────────────────── */

function bodyPreview(text: string, max = 120): string {
  const first = text.split('\n').find((l) => l.trim()) ?? text;
  return first.length > max ? first.slice(0, max) + '…' : first;
}

function fmtDate(dt: string | null | undefined, locale: AppLocale): string {
  if (!dt) return '—';
  try {
    return formatDate(dt, 'dd MMM yyyy', locale);
  } catch {
    return dt;
  }
}

/* ─── augmented row type ─────────────────────────────────────────── */

export interface RuleRow extends Rule, ProfileAgentLabel {
  /** Status derived from publication state — injected by the page */
  status?: string;
  /** Internal ownership key — not in backend schema; injected by MSW and page
   *  layer. Used only for the `isOwn` check, never rendered. */
  author_id?: string;
  /** Whether the row belongs to the current user */
  isOwn?: boolean;
}

/* ─── component ─────────────────────────────────────────────────── */

export interface RulesTableProps {
  rows: RuleRow[];
  role: Role | null;
  currentUserId: string;
  loading?: boolean;
  onOpen: (id: string) => void;
  /** Optional — renders a destructive Delete entry in the per-row actions
   *  menu when provided. Hidden for read-only viewers. */
  onDelete?: (id: string, preview: string) => void;
  /**
   * When true, hides the "Profile / Agent" column. Additive prop — default
   * false so existing call sites are unaffected. Only for contexts where every
   * row is already scoped to the same agent (e.g. the Agent detail page).
   */
  hideProfileAgentColumn?: boolean;
}

export function RulesTable({ rows, role: _role, currentUserId, loading, onOpen, onDelete, hideProfileAgentColumn = false }: RulesTableProps) {
  const { t, i18n } = useTranslation('rules');
  const locale = (i18n.language ?? 'en') as AppLocale;

  if (loading) {
    return (
      <div className="p-4 flex flex-col gap-2">
        {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr style={{ background: 'var(--ap-bg-inset)', borderBottom: '1px solid var(--ap-divider)' }}>
          <th
            scope="col"
            className="text-left px-4 py-2 font-medium"
            style={{ color: 'var(--ap-text-muted)', fontSize: 11 }}
          >
            Title
          </th>
          {!hideProfileAgentColumn && (
            <th
              scope="col"
              className="text-left px-4 py-2 font-medium"
              style={{ width: 160, color: 'var(--ap-text-muted)', fontSize: 11 }}
            >
              Profile / Agent
            </th>
          )}
          <th
            scope="col"
            className="text-left px-4 py-2 font-medium"
            style={{ width: 140, color: 'var(--ap-text-muted)', fontSize: 11 }}
          >
            Date
          </th>
          <th scope="col" style={{ width: 40 }} aria-hidden="true" />
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td colSpan={hideProfileAgentColumn ? 3 : 4} className="py-12 text-center" style={{ color: 'var(--ap-text-faint)', fontSize: 13 }}>
              No rules found
            </td>
          </tr>
        )}
        {rows.map((r) => {
          const isOwn = r.author_id === currentUserId || r.isOwn;
          const status = r.status ?? (r.is_active ? 'published_active' : 'published_inactive');
          const isPublished = status.startsWith('published');

          return (
            <tr
              key={r.id}
              onClick={() => onOpen(r.id)}
              className="cursor-pointer border-b border-divider transition-colors hover:bg-bg3"
              style={{ borderBottom: '1px solid var(--ap-divider)' }}
            >
              {/* title + preview */}
              <td className="px-4 py-2">
                <div className="flex flex-col min-w-0" style={{ maxWidth: 540 }}>
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold" style={{ fontSize: 13 }}>
                      {r.text.split('\n')[0].slice(0, 80) || 'Untitled'}
                    </span>
                    {!isPublished && <RCStatusBadge status={status as never} size="sm" />}
                    {isOwn && isPublished && (
                      <span style={{ color: 'var(--ap-accent)', fontSize: 10, fontWeight: 500 }}>
                        · mine
                      </span>
                    )}
                  </div>
                  <span
                    className="truncate"
                    style={{ fontSize: 12, color: 'var(--ap-text-muted)' }}
                  >
                    {bodyPreview(r.text, 120)}
                  </span>
                </div>
              </td>

              {/* profile + agent */}
              {!hideProfileAgentColumn && (
                <td className="px-4 py-2">
                  <ProfileAgentBadge
                    profile_name={r.profile_name ?? undefined}
                    agent_name={r.agent_name ?? undefined}
                    stacked
                  />
                </td>
              )}

              {/* date */}
              <td className="px-4 py-2" style={{ fontSize: 12, color: 'var(--ap-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                {fmtDate(r.updated_at ?? r.created_at, locale)}
              </td>

              {/* actions column */}
              <td className="px-2 py-2">
                <RowActionsMenu
                  ariaLabel={`Actions for rule ${r.id}`}
                  actions={
                    onDelete
                      ? [
                          {
                            id: 'delete',
                            label: t('actions.delete', 'Delete'),
                            icon: <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />,
                            danger: true,
                            onSelect: () =>
                              onDelete(r.id, bodyPreview(r.text, 60)),
                          },
                        ]
                      : []
                  }
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
