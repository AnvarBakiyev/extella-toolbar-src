import { ArrowDown, ArrowUp, ArrowUpDown, Pin, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/lib/icon';
import { RowActionsMenu } from '@/components/shared/RowActionsMenu';
import type { SortKey, SortDir } from '../schemas';
import { TypePlaque } from './TypePlaque';
import { TypeBadge } from './TypeBadge';
import { ProfileAgentBadge } from '@/components/shared/ProfileAgentBadge';
import type { ExpertCardData } from './ExpertCard';
import { useExpertRuns } from '../runs/ExpertRunsContext';
import { RunButton, RunStatusBadge } from '../runs/RunControls';

export interface ExpertsListTableProps {
  items: ExpertCardData[];
  sort: { key: SortKey; dir: SortDir };
  onSort: (key: SortKey) => void;
  selected: Set<string>;
  onSelectChange: (selected: Set<string>) => void;
  onPreview: (name: string) => void;
  onDelete?: (name: string) => void;
}

interface SortHeaderProps {
  label: string;
  sortKey: SortKey;
  currentSort: { key: SortKey; dir: SortDir };
  onSort: (key: SortKey) => void;
  align?: 'left' | 'right';
}

function SortHeader({ label, sortKey, currentSort, onSort, align = 'left' }: SortHeaderProps) {
  const active = currentSort.key === sortKey;
  const Icon_ = active ? (currentSort.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;

  return (
    <th
      scope="col"
      className="cursor-pointer select-none"
      aria-sort={active ? (currentSort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      <button
        className="flex items-center gap-1 text-xs font-medium uppercase tracking-[0.04em] text-textFaint hover:text-textMuted"
        style={{ justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}
        onClick={() => onSort(sortKey)}
      >
        {label}
        <Icon_ className="h-2.5 w-2.5" strokeWidth={1.5} aria-hidden />
      </button>
    </th>
  );
}

/**
 * ExpertsListTable — dense table view of experts list.
 * Port of ExpertsListTable from experts-C.jsx.
 * Columns: checkbox | Expert | Type | Profile / Agent | Added | Actions
 */
export function ExpertsListTable({
  items,
  sort,
  onSort,
  selected,
  onSelectChange,
  onPreview,
  onDelete,
}: ExpertsListTableProps) {
  const { t } = useTranslation('experts');
  const runs = useExpertRuns();

  const toggleItem = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onSelectChange(next);
  };

  const allSelected = items.length > 0 && items.every((e) => selected.has(e.name));
  const someSelected = items.some((e) => selected.has(e.name));

  const toggleAll = () => {
    if (allSelected) {
      onSelectChange(new Set());
    } else {
      onSelectChange(new Set(items.map((e) => e.name)));
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="w-9 px-3 py-2">
              <input
                type="checkbox"
                aria-label="Select all"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected && !allSelected;
                }}
                onChange={toggleAll}
                className="h-[14px] w-[14px] cursor-pointer rounded-sm border-border accent-accent"
              />
            </th>
            <SortHeader
              label={t('columns.expert', 'Expert')}
              sortKey="name"
              currentSort={sort}
              onSort={onSort}
            />
            <SortHeader
              label={t('columns.type', 'Type')}
              sortKey="type"
              currentSort={sort}
              onSort={onSort}
            />
            <th scope="col" className="w-[170px] px-3 py-2 text-left text-xs font-medium uppercase tracking-[0.04em] text-textFaint">
              {t('columns.profileAgent', 'Profile / Agent')}
            </th>
            <th scope="col" className="w-[130px] px-3 py-2 text-left text-xs font-medium uppercase tracking-[0.04em] text-textFaint">
              {t('columns.added', 'Added')}
            </th>
            <th scope="col" className="w-10" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {items.map((expert) => (
            <tr
              key={expert.id ?? expert.name}
              className="border-b border-divider hover:bg-bg2 data-[selected=true]:bg-accentBg"
              data-selected={selected.has(expert.name)}
            >
              {/* Checkbox */}
              <td className="w-9 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label={`Select ${expert.name}`}
                  checked={selected.has(expert.name)}
                  onChange={() => toggleItem(expert.name)}
                  className="h-[14px] w-[14px] cursor-pointer rounded-sm border-border accent-accent"
                />
              </td>

              {/* Expert name + description + run control */}
              <td>
                <div className="flex min-w-0 items-center gap-2">
                  <button
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left"
                    onClick={() => onPreview(expert.name)}
                  >
                    <TypePlaque type={expert.type} size={28} />
                    <div className="flex min-w-0 flex-col">
                      <div className="flex items-center gap-1.5">
                        <span className="text-md font-semibold">{expert.name}</span>
                        {expert.pinned ? (
                          <Icon as={Pin} size={11} className="text-accent" />
                        ) : null}
                        {(() => {
                          const rv = runs.getRun(expert.name);
                          return rv && rv.phase !== 'idle' ? (
                            <RunStatusBadge phase={rv.phase} status={rv.status} />
                          ) : null;
                        })()}
                      </div>
                      <span
                        className="max-w-[360px] overflow-hidden text-ellipsis whitespace-nowrap text-sm text-textMuted"
                      >
                        {expert.description}
                      </span>
                    </div>
                  </button>
                  {/* Run/launch button temporarily hidden.
                  <RunButton
                    phase={runs.getRun(expert.name)?.phase ?? 'idle'}
                    onRun={() =>
                      runs.run(expert.name, {
                        profileId: expert.profileId ?? undefined,
                        agentId: expert.agentId ?? undefined,
                      })
                    }
                    onStop={() => runs.stop(expert.name)}
                  /> */}
                </div>
              </td>

              {/* Type */}
              <td className="px-3 py-2">
                <TypeBadge type={expert.type} />
              </td>

              {/* Profile / Agent */}
              <td className="px-3 py-2">
                <ProfileAgentBadge
                  profile_name={expert.profileName}
                  agent_name={expert.agentName}
                  stacked
                />
              </td>

              {/* Date added */}
              <td className="px-3 py-2 tabular-nums text-textMuted">
                {expert.date ?? '—'}
              </td>

              {/* Actions */}
              <td className="px-2 py-2">
                <RowActionsMenu
                  ariaLabel={`Actions for ${expert.name}`}
                  actions={
                    onDelete
                      ? [
                          {
                            id: 'delete',
                            label: t('actions.delete', 'Delete'),
                            icon: <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />,
                            danger: true,
                            onSelect: () => onDelete(expert.name),
                          },
                        ]
                      : []
                  }
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
