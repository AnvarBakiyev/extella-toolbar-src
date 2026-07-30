import { ArrowDown, ArrowUp, ArrowUpDown, Trash2, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { RowActionsMenu } from '@/components/shared/RowActionsMenu';
import type { AgentSortKey, AgentSortDir } from '../schemas';
import { ProviderPlaque } from './ProviderPlaque';
import { ProviderBadge } from './ProviderBadge';
import type { AgentCardData } from './AgentCard';

export interface AgentsListTableProps {
  items: AgentCardData[];
  sort: { key: AgentSortKey; dir: AgentSortDir };
  onSort: (key: AgentSortKey) => void;
  selected: Set<string>;
  onSelectChange: (selected: Set<string>) => void;
  onPreview: (agentId: string) => void;
  onDelete?: (agentId: string, name: string) => void;
}

interface SortHeaderProps {
  label: string;
  sortKey: AgentSortKey;
  currentSort: { key: AgentSortKey; dir: AgentSortDir };
  onSort: (key: AgentSortKey) => void;
}

function SortHeader({ label, sortKey, currentSort, onSort }: SortHeaderProps) {
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
        onClick={() => onSort(sortKey)}
      >
        {label}
        <Icon_ className="h-2.5 w-2.5" strokeWidth={1.5} aria-hidden />
      </button>
    </th>
  );
}

/**
 * AgentsListTable — dense table of agents, mirroring ExpertsListTable.
 * Columns: checkbox | Agent | Provider | Model | Tools | Added | Actions
 */
export function AgentsListTable({
  items,
  sort,
  onSort,
  selected,
  onSelectChange,
  onPreview,
  onDelete,
}: AgentsListTableProps) {
  const { t: tCommon } = useTranslation('common');
  const { t } = useTranslation('agents');

  const toggleItem = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectChange(next);
  };

  const allSelected = items.length > 0 && items.every((a) => selected.has(a.id));
  const someSelected = items.some((a) => selected.has(a.id));

  const toggleAll = () => {
    if (allSelected) {
      onSelectChange(new Set());
    } else {
      onSelectChange(new Set(items.map((a) => a.id)));
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
                aria-label={tCommon('table.selectAll')}
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected && !allSelected;
                }}
                onChange={toggleAll}
                className="h-[14px] w-[14px] cursor-pointer rounded-sm border-border accent-accent"
              />
            </th>
            <SortHeader
              label={t('columns.agent', 'Agent')}
              sortKey="name"
              currentSort={sort}
              onSort={onSort}
            />
            <SortHeader
              label={t('columns.provider', 'Provider')}
              sortKey="provider"
              currentSort={sort}
              onSort={onSort}
            />
            <th
              scope="col"
              className="w-[160px] px-3 py-2 text-left text-xs font-medium uppercase tracking-[0.04em] text-textFaint"
            >
              {t('columns.model', 'Model')}
            </th>
            <th scope="col" className="w-[110px]">
              <button
                className="flex items-center gap-1 text-xs font-medium uppercase tracking-[0.04em] text-textFaint hover:text-textMuted"
                onClick={() => onSort('tools')}
                aria-sort={sort.key === 'tools' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
              >
                {t('columns.tools', 'Tools')}
                {sort.key === 'tools' ? (
                  sort.dir === 'asc' ? <ArrowUp className="h-2.5 w-2.5" strokeWidth={1.5} /> : <ArrowDown className="h-2.5 w-2.5" strokeWidth={1.5} />
                ) : (
                  <ArrowUpDown className="h-2.5 w-2.5" strokeWidth={1.5} />
                )}
              </button>
            </th>
            <th
              scope="col"
              className="w-[130px] px-3 py-2 text-left text-xs font-medium uppercase tracking-[0.04em] text-textFaint"
            >
              {t('columns.added', 'Added')}
            </th>
            <th scope="col" className="w-10" aria-label={tCommon('table.actions')} />
          </tr>
        </thead>
        <tbody>
          {items.map((agent) => (
            <tr
              key={agent.id}
              className="border-b border-divider hover:bg-bg2 data-[selected=true]:bg-accentBg"
              data-selected={selected.has(agent.id)}
            >
              {/* Checkbox */}
              <td className="w-9 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label={`Select ${agent.name}`}
                  checked={selected.has(agent.id)}
                  onChange={() => toggleItem(agent.id)}
                  className="h-[14px] w-[14px] cursor-pointer rounded-sm border-border accent-accent"
                />
              </td>

              {/* Agent name + description */}
              <td>
                <button
                  className="flex min-w-0 cursor-pointer items-center gap-2.5 text-left"
                  onClick={() => onPreview(agent.id)}
                >
                  <ProviderPlaque provider={agent.provider} size={28} />
                  <div className="flex min-w-0 flex-col">
                    <div className="flex items-center gap-1.5">
                      <span className="text-md font-semibold">{agent.name}</span>
                    </div>
                    <span
                      className="max-w-[360px] overflow-hidden text-ellipsis whitespace-nowrap text-sm text-textMuted"
                    >
                      {agent.description || '—'}
                    </span>
                  </div>
                </button>
              </td>

              {/* Provider */}
              <td className="px-3 py-2">
                <ProviderBadge provider={agent.provider} />
              </td>

              {/* Model */}
              <td className="px-3 py-2 text-sm text-textMuted" style={{ fontFamily: 'var(--ap-font-mono)' }}>
                {agent.model ?? '—'}
              </td>

              {/* Tools count */}
              <td className="px-3 py-2">
                {agent.toolsCount > 0 ? (
                  <span className="flex items-center gap-1.5 tabular-nums text-accent">
                    <Wrench className="h-3 w-3" strokeWidth={1.5} />
                    {agent.toolsCount}
                  </span>
                ) : (
                  <span className="text-sm text-textFaint">—</span>
                )}
              </td>

              {/* Date added */}
              <td className="px-3 py-2 tabular-nums text-textMuted">
                {agent.date ?? '—'}
              </td>

              {/* Actions */}
              <td className="px-2 py-2">
                <RowActionsMenu
                  ariaLabel={`Actions for ${agent.name}`}
                  actions={
                    onDelete
                      ? [
                          {
                            id: 'delete',
                            label: t('actions.delete', 'Delete'),
                            icon: <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />,
                            danger: true,
                            onSelect: () => onDelete(agent.id, agent.name),
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
