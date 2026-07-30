/**
 * KV Store table — columns: Key, Description, Date, Actions.
 *
 * The Value is a secret — intentionally NOT rendered in the list.
 * Mirrors ConceptsTable in structure and visual language.
 */

import { Edit2, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui/skeleton';
import { RowActionsMenu } from '@/components/shared/RowActionsMenu';
import { ProfileAgentBadge } from '@/components/shared/ProfileAgentBadge';
import type { AppLocale } from '@/lib/format';
import { formatDate } from '@/lib/format';
import type { KvEntry } from '../schemas';

/* ─── helpers ───────────────────────────────────────────────────── */

function fmtDate(dt: string | null | undefined, locale: AppLocale): string {
  if (!dt) return '—';
  try {
    return formatDate(dt, 'dd MMM yyyy', locale);
  } catch {
    return dt;
  }
}

/* ─── types ─────────────────────────────────────────────────────── */

export interface KvTableProps {
  rows: KvEntry[];
  loading?: boolean;
  onOpen: (key: string) => void;
  onEdit: (entry: KvEntry) => void;
  onDelete: (key: string) => void;
}

/* ─── component ─────────────────────────────────────────────────── */

export function KvTable({ rows, loading, onOpen, onEdit, onDelete }: KvTableProps) {
  const { t: tCommon } = useTranslation('common');
  const { t, i18n } = useTranslation('kvstore');
  const locale = (i18n.language ?? 'en') as AppLocale;

  if (loading) {
    return (
      <div className="p-4 flex flex-col gap-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr
          style={{
            background: 'var(--ap-bg-inset)',
            borderBottom: '1px solid var(--ap-divider)',
          }}
        >
          <th
            scope="col"
            className="text-left px-4 py-2 font-medium"
            style={{ color: 'var(--ap-text-muted)', fontSize: 11 }}
          >
            {t('columns.key', 'Key')}
          </th>
          <th
            scope="col"
            className="text-left px-4 py-2 font-medium"
            style={{ color: 'var(--ap-text-muted)', fontSize: 11 }}
          >
            {t('columns.description', 'Description')}
          </th>
          <th
            scope="col"
            className="text-left px-4 py-2 font-medium"
            style={{ width: 160, color: 'var(--ap-text-muted)', fontSize: 11 }}
          >{tCommon('columns.profileAgent')}</th>
          <th
            scope="col"
            className="text-left px-4 py-2 font-medium"
            style={{ width: 130, color: 'var(--ap-text-muted)', fontSize: 11 }}
          >
            {t('columns.date', 'Date')}
          </th>
          <th scope="col" style={{ width: 40 }} aria-hidden="true" />
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td
              colSpan={5}
              className="py-12 text-center"
              style={{ color: 'var(--ap-text-faint)', fontSize: 13 }}
            >
              {t('table.empty', 'No entries found')}
            </td>
          </tr>
        )}
        {rows.map((entry) => (
          <tr
            key={entry.id}
            onClick={() => onOpen(entry.key)}
            className="cursor-pointer border-b border-divider transition-colors hover:bg-bg3"
            style={{ borderBottom: '1px solid var(--ap-divider)' }}
          >
            {/* key */}
            <td className="px-4 py-2" style={{ maxWidth: 240 }}>
              <span
                className="font-mono font-semibold truncate block"
                style={{ fontSize: 13 }}
                title={entry.key}
              >
                {entry.key}
              </span>
            </td>

            {/* description (value is a secret — not shown) */}
            <td className="px-4 py-2">
              <span
                className="truncate block"
                style={{ fontSize: 13, color: 'var(--ap-text)', maxWidth: 480 }}
                title={entry.description}
              >
                {entry.description || (
                  <span style={{ color: 'var(--ap-text-faint)', fontStyle: 'italic' }}>
                    {t('table.noDescription', 'No description')}
                  </span>
                )}
              </span>
            </td>

            {/* profile + agent */}
            <td className="px-4 py-2">
              <ProfileAgentBadge
                profile_name={entry.profile_name ?? undefined}
                agent_name={entry.agent_name ?? undefined}
                stacked
              />
            </td>

            {/* date */}
            <td
              className="px-4 py-2"
              style={{
                fontSize: 12,
                color: 'var(--ap-text-muted)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {fmtDate(entry.updated_at ?? entry.created_at, locale)}
            </td>

            {/* actions */}
            <td className="px-2 py-2">
              <RowActionsMenu
                ariaLabel={`Actions for ${entry.key}`}
                actions={[
                  {
                    id: 'edit',
                    label: t('actions.edit', 'Edit'),
                    icon: <Edit2 className="h-3.5 w-3.5" strokeWidth={1.5} />,
                    onSelect: () => {
                      onEdit(entry);
                    },
                  },
                  {
                    id: 'delete',
                    label: t('actions.delete', 'Delete'),
                    icon: <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />,
                    danger: true,
                    onSelect: () => onDelete(entry.key),
                  },
                ]}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
