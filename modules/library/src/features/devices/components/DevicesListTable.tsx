import { ArrowDown, ArrowUp, ArrowUpDown, Edit2, Star, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/lib/icon';
import { RowActionsMenu } from '@/components/shared/RowActionsMenu';
import type { SortKey, SortDir } from '../schemas';
import type { Device } from '@/lib/types';

export interface DevicesListTableProps {
  items: Device[];
  sort: { key: SortKey; dir: SortDir };
  onSort: (key: SortKey) => void;
  onPreview: (id: string) => void;
  onEdit: (device: Device) => void;
  onDelete: (device: Device) => void;
  onSetDefault: (device: Device) => void;
}

interface SortHeaderProps {
  label: string;
  sortKey: SortKey;
  currentSort: { key: SortKey; dir: SortDir };
  onSort: (key: SortKey) => void;
}

function SortHeader({ label, sortKey, currentSort, onSort }: SortHeaderProps) {
  const active = currentSort.key === sortKey;
  const SortIcon = active ? (currentSort.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;

  return (
    <th
      scope="col"
      className="cursor-pointer select-none"
      aria-sort={active ? (currentSort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      <button
        className="flex items-center gap-1 text-xs font-medium uppercase tracking-[0.04em] text-textFaint hover:text-textMuted"
        onClick={() => onSort(sortKey)}
      >
        {label}
        <SortIcon className="h-2.5 w-2.5" strokeWidth={1.5} aria-hidden />
      </button>
    </th>
  );
}

/**
 * DevicesListTable — dense table view of devices.
 * Columns: Device (target + description) | Default | Added | Actions
 */
export function DevicesListTable({
  items,
  sort,
  onSort,
  onPreview,
  onEdit,
  onDelete,
  onSetDefault,
}: DevicesListTableProps) {
  const { t: tCommon } = useTranslation('common');
  const { t } = useTranslation('devices');

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <SortHeader
              label={t('columns.device', 'Device')}
              sortKey="name"
              currentSort={sort}
              onSort={onSort}
            />
            <th
              scope="col"
              className="w-[100px] px-3 py-2 text-left text-xs font-medium uppercase tracking-[0.04em] text-textFaint"
            >
              {t('columns.status', 'Status')}
            </th>
            <SortHeader
              label={t('columns.added', 'Added')}
              sortKey="recent"
              currentSort={sort}
              onSort={onSort}
            />
            <th scope="col" className="w-10" aria-label={tCommon('table.actions')} />
          </tr>
        </thead>
        <tbody>
          {items.map((device) => {
            const formattedDate = device.created_at
              ? new Date(device.created_at).toLocaleDateString()
              : '—';

            return (
              <tr
                key={device.id}
                className="border-b border-divider hover:bg-bg2"
              >
                {/* Device target + description */}
                <td>
                  <button
                    className="flex min-w-0 cursor-pointer items-center gap-2.5 px-3 py-2.5 text-left"
                    onClick={() => onPreview(device.id)}
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="text-md font-semibold">{device.target}</span>
                      {device.description ? (
                        <span className="max-w-[360px] overflow-hidden text-ellipsis whitespace-nowrap text-sm text-textMuted">
                          {device.description}
                        </span>
                      ) : null}
                    </div>
                  </button>
                </td>

                {/* Default badge */}
                <td className="px-3 py-2">
                  {device.is_default ? (
                    <span className="inline-flex items-center gap-1 rounded-pill bg-accentSoft px-1.5 py-0.5 text-xs font-medium text-accent">
                      <Icon as={Star} size={10} />
                      {t('badge.default', 'Default')}
                    </span>
                  ) : (
                    <span className="text-textFaint text-xs">—</span>
                  )}
                </td>

                {/* Added date */}
                <td className="px-3 py-2 tabular-nums text-textMuted">{formattedDate}</td>

                {/* Actions */}
                <td className="px-2 py-2">
                  <RowActionsMenu
                    ariaLabel={`Actions for ${device.target}`}
                    actions={[
                      {
                        id: 'edit',
                        label: t('actions.edit', 'Edit'),
                        icon: <Edit2 className="h-3.5 w-3.5" strokeWidth={1.5} />,
                        onSelect: () => onEdit(device),
                      },
                      {
                        id: 'set-default',
                        label: device.is_default
                          ? t('actions.defaultAlready', 'Already default')
                          : t('actions.setDefault', 'Set as default'),
                        icon: <Star className="h-3.5 w-3.5" strokeWidth={1.5} />,
                        disabled: device.is_default,
                        onSelect: () => onSetDefault(device),
                      },
                      {
                        id: 'delete',
                        label: t('actions.delete', 'Delete'),
                        icon: <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />,
                        danger: true,
                        onSelect: () => onDelete(device),
                      },
                    ]}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
