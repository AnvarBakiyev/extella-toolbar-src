/**
 * AgentsListPage — flat agents catalogue (standalone).
 *
 * Agent Teams now live in their own section at `/teams` (see src/features/teams).
 * This page is a flat Agents catalogue only — no segment switcher. Each card
 * surfaces the agent's team memberships via read-only chips.
 *
 * Per contract §2 standalone:
 *   - NO tabs (no All/Mine/Org concept in standalone)
 *   - Flat list rendered directly
 *   - Category filter (chips) replacing the All/Mine/Org tabs
 *   - Provider filter + Dependencies filter (tools.length) + sort popover + density toggle
 *   - Grid card shows category rail, initials avatar, category badge, tools count badge
 *   - Footer shows team membership chips + profile_name
 *   - Hover CTA = "Open page" (→ detail); no "open chat"
 *   - Pagination: client-side (existing standalone pattern per contract §2)
 *   - Delete via confirm dialog (hard delete, no trash for agents)
 *
 * URL:
 *   /agents          → list
 *   /agents/:id      → list + preview drawer open
 */

import { useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Search,
  Filter,
  ArrowUp,
  ArrowDown,
  Grid,
  List,
  X,
  ChevronDown,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { RowActionsMenu } from '@/components/shared/RowActionsMenu';
import { SearchSpinner } from '@/components/shared/SearchSpinner';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/layout/EmptyState';
import { ErrorBanner } from '@/components/layout/ErrorBanner';
import { DeleteByNameDialog } from '@/components/layout/DeleteByNameDialog';
import { Button } from '@/components/ui/button';
import { Loader } from '@/components/ui/loader';
import { Icon } from '@/lib/icon';
import { useAgentsList } from '../hooks/useAgentsList';
import { useDeleteAgent } from '../hooks/useDeleteAgent';
import {
  AGENT_PROVIDER_VALUES,
  AGENT_PROVIDER_COLORS,
  type AgentProvider,
  type AgentSortKey,
  type AgentSortDir,
  type AgentViewMode,
} from '../schemas';
import { AGENT_CATEGORY_COLORS, AGENT_CATEGORY_LABELS } from '../components/AgentCategoryBadge';
import { AgentCard, type AgentCardData } from '../components/AgentCard';
import { AgentsListTable } from '../components/AgentsListTable';
import { AgentPreviewDrawer } from '../components/AgentPreviewDrawer';
import type { AgentRow } from '@/lib/types';

const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

/** All known categories in a consistent order. */
const AGENT_CATEGORY_KEYS = Object.keys(AGENT_CATEGORY_LABELS) as Array<keyof typeof AGENT_CATEGORY_LABELS>;

function toCardData(item: AgentRow, locale: string): AgentCardData {
  return {
    id: item.id,
    name: item.name,
    description: item.description ?? '',
    provider: item.provider ?? null,
    model: item.model ?? null,
    toolsCount: item.tools?.length ?? 0,
    isPublic: item.is_public ?? null,
    date: item.created_at
      ? new Date(item.created_at).toLocaleDateString(locale)
      : undefined,
    category: item.category ?? null,
    profileName: item.profile_name ?? null,
  };
}

export function AgentsListPage() {
  const { t, i18n } = useTranslation('agents');
  const intlLocale = i18n.language === 'ru' ? 'ru-RU' : i18n.language === 'kz' ? 'kk-KZ' : 'en-US';
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();

  const drawerId = params.id ?? null;

  const openPreview = useCallback(
    (id: string) => navigate(`/agents/${encodeURIComponent(id)}`, { replace: false }),
    [navigate],
  );
  const closePreview = useCallback(() => navigate('/agents', { replace: true }), [navigate]);
  const openDetail = useCallback(
    (id: string) => navigate(`/agents/${encodeURIComponent(id)}/page`),
    [navigate],
  );

  // ── Delete ──
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
    profileId?: string;
    agentScopeId?: string;
  } | null>(null);
  const deleteMutation = useDeleteAgent();

  const requestDelete = useCallback(
    (id: string, name: string, profileId?: string, agentScopeId?: string) => {
      setDeleteTarget({ id, name, profileId, agentScopeId });
    },
    [],
  );

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync({
        agentId: deleteTarget.id,
        profileId: deleteTarget.profileId,
        agentScopeId: deleteTarget.agentScopeId,
      });
      setDeleteTarget(null);
      if (drawerId === deleteTarget.id) closePreview();
    } catch {
      /* toast already fired */
    }
  }, [deleteTarget, deleteMutation, drawerId, closePreview]);

  // ── UI state ──
  const [view, setView] = useState<AgentViewMode>('grid');
  const [q, setQ] = useState('');
  const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set());
  const [activeProviders, setActiveProviders] = useState<Set<AgentProvider>>(new Set());
  const [depsMode, setDepsMode] = useState<'any' | 'with' | 'without'>('any');
  const [sort, setSort] = useState<{ key: AgentSortKey; dir: AgentSortDir }>({
    key: 'recent',
    dir: 'desc',
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(DEFAULT_PAGE_SIZE);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, isLoading, isError, refetch, isSearching } = useAgentsList({
    q,
    page,
    page_size: pageSize,
    providers: activeProviders.size > 0 ? Array.from(activeProviders) : undefined,
    sort_key: sort.key,
    sort_dir: sort.dir,
  });

  const rawItems = data?.items ?? [];
  const total = data?.total ?? 0;
  const hasMore = data?.has_more ?? false;

  // Client-side category + dependency filter (standalone pattern per contract §2)
  const filteredItems = rawItems.filter((item) => {
    if (activeCategories.size > 0 && !activeCategories.has(item.category ?? '')) return false;
    if (depsMode === 'with' && (item.tools?.length ?? 0) === 0) return false;
    if (depsMode === 'without' && (item.tools?.length ?? 0) > 0) return false;
    return true;
  });

  const cards: AgentCardData[] = filteredItems.map((item) =>
    toCardData(item, intlLocale),
  );
  const pairByAgentId = new Map(
    rawItems.map((item) => [
      item.id,
      { profileId: item.profile_id ?? undefined, agentScopeId: item.agent_id ?? undefined },
    ]),
  );

  const filterCount =
    activeCategories.size +
    activeProviders.size +
    (depsMode !== 'any' ? 1 : 0);

  const setSortKey = (key: AgentSortKey) => {
    setSort((prev) => ({
      key,
      dir: prev.key === key ? (prev.dir === 'asc' ? 'desc' : 'asc') : key === 'tools' ? 'desc' : 'asc',
    }));
    setPage(1);
  };

  const resetFilters = () => {
    setQ('');
    setActiveCategories(new Set());
    setActiveProviders(new Set());
    setDepsMode('any');
    setPage(1);
  };

  const toggleCategory = (c: string) => {
    const next = new Set(activeCategories);
    if (next.has(c)) next.delete(c); else next.add(c);
    setActiveCategories(next);
    setPage(1);
  };

  const toggleProvider = (p: AgentProvider) => {
    const next = new Set(activeProviders);
    if (next.has(p)) next.delete(p); else next.add(p);
    setActiveProviders(next);
    setPage(1);
  };

  const sortOptions: Array<{ key: AgentSortKey; label: string }> = [
    { key: 'recent', label: t('sort.recent', 'Recent') },
    { key: 'name', label: t('sort.name', 'Name') },
    { key: 'provider', label: t('sort.provider', 'Provider') },
    { key: 'tools', label: t('sort.tools', 'Tools') },
  ];
  const sortLabel = sortOptions.find((o) => o.key === sort.key)?.label ?? sort.key;

  return (
    <div className="relative flex flex-1 min-h-0 flex-col">
      {/* Page header */}
      <PageHeader
        className="border-b-0 pb-0"
        title={t('list.title', 'Agents')}
        subtitle={
          isLoading
            ? undefined
            : t('list.subtitle', 'Agent catalogue · {{count}} active', { count: total })
        }
      />

      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-divider px-7 py-3">
        {/* Search */}
        <div className="relative flex max-w-xs flex-1 items-center">
          <Icon as={Search} size={14} className="absolute left-2.5 text-iconMuted" />
          <input
            type="search"
            placeholder={t('toolbar.searchPlaceholder', 'Search agents...')}
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            className="h-8 w-full rounded-md border border-border bg-bgCard pl-8 pr-8 text-sm text-text placeholder:text-textFaint focus:outline-none focus:ring-2 focus:ring-accentSoftStrong"
            aria-label="Search agents"
          />
          <SearchSpinner busy={isSearching} className="absolute right-2.5" />
        </div>

        {/* Filters button */}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setFiltersOpen((o) => !o)}
          style={
            filterCount > 0
              ? { background: 'var(--ap-accent-soft)', borderColor: 'var(--ap-accent-border)', color: 'var(--ap-accent)' }
              : undefined
          }
        >
          <Icon as={Filter} size={14} />
          {t('toolbar.filters', 'Filters')}
          {filterCount > 0 ? (
            <span
              className="flex h-4 min-w-[16px] items-center justify-center rounded-pill text-[10px] font-semibold"
              style={{ background: 'var(--ap-accent)', color: 'var(--ap-accent-fg)', padding: '0 5px' }}
            >
              {filterCount}
            </span>
          ) : null}
          <Icon as={ChevronDown} size={12} />
        </Button>

        {/* Sort dropdown */}
        <div className="relative">
          <Button variant="secondary" size="sm" onClick={() => setSortOpen((o) => !o)}>
            <Icon as={sort.dir === 'asc' ? ArrowUp : ArrowDown} size={14} />
            {sortLabel}
            <Icon as={ChevronDown} size={12} />
          </Button>
          {sortOpen ? (
            <div
              className="absolute left-0 top-[calc(100%+4px)] z-10 flex min-w-[200px] flex-col gap-0.5 rounded-md border border-border bg-bgCard p-1 shadow-pop"
              onMouseLeave={() => setSortOpen(false)}
            >
              {sortOptions.map((o) => (
                <button
                  key={o.key}
                  className="flex items-center justify-between rounded-sm px-2 py-1.5 text-left text-md text-text hover:bg-bg3"
                  style={{ background: sort.key === o.key ? 'var(--ap-bg-3)' : undefined }}
                  onClick={() => { setSortKey(o.key); setSortOpen(false); }}
                >
                  <span>{o.label}</span>
                  {sort.key === o.key ? (
                    <Icon
                      as={sort.dir === 'asc' ? ArrowUp : ArrowDown}
                      size={12}
                      className="text-textMuted"
                    />
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* Right: results + density toggle */}
        <div className="ml-auto flex items-center gap-2">
          {!isLoading ? (
            <span className="text-sm text-textMuted">
              {filteredItems.length}{' '}
              {filteredItems.length === 1
                ? t('toolbar.result', 'result')
                : t('toolbar.results', 'results')}
            </span>
          ) : null}
          <div className="flex gap-0.5 rounded-md bg-bgInset p-0.5">
            <button
              className="flex h-[26px] w-7 items-center justify-center rounded-sm transition-colors"
              style={{
                background: view === 'grid' ? 'var(--ap-bg-card)' : 'transparent',
                boxShadow: view === 'grid' ? 'var(--ap-shadow-card)' : 'none',
                color: view === 'grid' ? 'var(--ap-text)' : 'var(--ap-text-muted)',
              }}
              onClick={() => setView('grid')}
              aria-label={t('toolbar.view.grid', 'Grid')}
              aria-pressed={view === 'grid'}
            >
              <Icon as={Grid} size={13} />
            </button>
            <button
              className="flex h-[26px] w-7 items-center justify-center rounded-sm transition-colors"
              style={{
                background: view === 'list' ? 'var(--ap-bg-card)' : 'transparent',
                boxShadow: view === 'list' ? 'var(--ap-shadow-card)' : 'none',
                color: view === 'list' ? 'var(--ap-text)' : 'var(--ap-text-muted)',
              }}
              onClick={() => setView('list')}
              aria-label={t('toolbar.view.list', 'List')}
              aria-pressed={view === 'list'}
            >
              <Icon as={List} size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* Filter panel */}
      {filtersOpen ? (
        <div
          className="flex flex-wrap gap-6 border-b border-divider bg-bgInset px-7 py-3"
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto auto' }}
        >
          {/* Category */}
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-[0.04em] text-textFaint">
              {t('filters.category', 'Category')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {AGENT_CATEGORY_KEYS.map((cat) => {
                const color = AGENT_CATEGORY_COLORS[cat];
                const active = activeCategories.has(cat);
                return (
                  <button
                    key={cat}
                    className="flex items-center gap-1 rounded-pill border px-2 py-0.5 text-xs font-medium transition-colors"
                    style={{
                      background: active ? 'var(--ap-bg-3)' : 'var(--ap-bg-card)',
                      borderColor: active ? 'var(--ap-border-strong)' : 'var(--ap-border)',
                      color: active ? 'var(--ap-text)' : 'var(--ap-text-muted)',
                    }}
                    onClick={() => toggleCategory(cat)}
                    aria-pressed={active}
                  >
                    <span
                      className="inline-block h-2 w-2 rounded-[2px]"
                      style={{ background: color }}
                      aria-hidden="true"
                    />
                    {AGENT_CATEGORY_LABELS[cat]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Provider */}
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-[0.04em] text-textFaint">
              {t('filters.provider', 'Provider')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {AGENT_PROVIDER_VALUES.map((p) => {
                const color = AGENT_PROVIDER_COLORS[p];
                const active = activeProviders.has(p);
                return (
                  <button
                    key={p}
                    className="flex items-center gap-1 rounded-pill border px-2 py-0.5 text-xs font-medium transition-colors"
                    style={{
                      background: active ? 'var(--ap-bg-3)' : 'var(--ap-bg-card)',
                      borderColor: active ? 'var(--ap-border-strong)' : 'var(--ap-border)',
                      color: active ? 'var(--ap-text)' : 'var(--ap-text-muted)',
                    }}
                    onClick={() => toggleProvider(p)}
                    aria-pressed={active}
                  >
                    <span
                      className="inline-block h-2 w-2 rounded-[2px]"
                      style={{ background: color }}
                      aria-hidden="true"
                    />
                    {t(`providers.${p}`, p)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Dependencies */}
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-[0.04em] text-textFaint">
              {t('filters.dependencies', 'Dependencies')}
            </div>
            <div className="flex gap-1.5">
              {(['any', 'with', 'without'] as const).map((mode) => (
                <button
                  key={mode}
                  className="rounded-pill border px-2 py-0.5 text-xs font-medium transition-colors"
                  style={{
                    background: depsMode === mode ? 'var(--ap-bg-3)' : 'var(--ap-bg-card)',
                    borderColor: depsMode === mode ? 'var(--ap-border-strong)' : 'var(--ap-border)',
                    color: depsMode === mode ? 'var(--ap-text)' : 'var(--ap-text-muted)',
                  }}
                  onClick={() => setDepsMode(mode)}
                  aria-pressed={depsMode === mode}
                >
                  {t(`filters.deps.${mode}`, mode === 'any' ? 'Any' : mode === 'with' ? 'With tools' : 'Without tools')}
                </button>
              ))}
            </div>
          </div>

          {/* Reset */}
          <div className="flex flex-col justify-end">
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              <Icon as={X} size={12} />
              {t('filters.reset', 'Reset')}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Bulk action bar (list view) */}
      {view === 'list' && selected.size > 0 ? (
        <div className="flex items-center gap-2 border-b border-divider bg-bgInset px-7 py-2 text-md">
          <strong>{selected.size}</strong>
          <span className="text-textMuted">{t('bulk.selected', 'selected')}</span>
          <div className="mx-1 h-4 w-px bg-divider" />
          <Button
            variant="ghost"
            size="sm"
            className="text-danger hover:bg-dangerSoft hover:text-danger"
            onClick={() => {
              // Bulk delete: trigger confirm for each selected — simplified to
              // single item if only one is selected; multi-delete is future work.
              if (selected.size === 1) {
                const id = Array.from(selected)[0];
                const item = rawItems.find((a) => a.id === id);
                if (item) requestDelete(id, item.name);
              }
            }}
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            {t('actions.delete', 'Delete')}
          </Button>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setSelected(new Set())}>
            <Icon as={X} size={14} />
          </Button>
        </div>
      ) : null}

      {/* Content area */}
      <div className="flex-1 overflow-y-auto">
        {isError ? (
          <div className="px-7 py-6">
            <ErrorBanner
              title={t('list.errorTitle', 'Failed to load agents')}
              onRetry={() => void refetch()}
            />
          </div>
        ) : isLoading ? (
          <Loader label={t('list.loading', 'Loading…')} />
        ) : cards.length === 0 ? (
          <div className="px-7 py-8">
            <EmptyState
              icon={<Search className="h-6 w-6" />}
              title={
                q || filterCount > 0
                  ? t('empty.search.title', 'Nothing found')
                  : t('list.empty', 'No agents yet.')
              }
              description={
                q || filterCount > 0
                  ? t('empty.search.subtitle', 'Try resetting filters or searching for a different name')
                  : undefined
              }
              action={
                filterCount > 0 || q ? (
                  <Button variant="secondary" size="sm" onClick={resetFilters}>
                    {t('filters.reset', 'Reset')}
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : view === 'grid' ? (
          <div className="grid grid-cols-4 gap-2.5 px-7 py-5">
            {cards.map((agent) => (
              <div key={agent.id} className="relative">
                <button
                  type="button"
                  className="block w-full cursor-pointer text-left"
                  onClick={() => openPreview(agent.id)}
                  aria-label={agent.name}
                >
                  <AgentCard
                    agent={agent}
                    dense
                    onOpenPage={() => openDetail(agent.id)}
                  />
                </button>
                <div className="absolute right-2 top-2">
                  <RowActionsMenu
                    ariaLabel={t('actions.menuFor', { name: agent.name, defaultValue: `Actions for ${agent.name}` })}
                    actions={[
                      {
                        id: 'delete',
                        label: t('actions.delete', 'Delete'),
                        icon: <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />,
                        danger: true,
                        onSelect: () => {
                          const pair = pairByAgentId.get(agent.id);
                          requestDelete(agent.id, agent.name, pair?.profileId, pair?.agentScopeId);
                        },
                      },
                    ]}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <AgentsListTable
            items={cards}
            sort={sort}
            onSort={setSortKey}
            selected={selected}
            onSelectChange={setSelected}
            onPreview={openPreview}
            onDelete={(id, name) => {
              const pair = pairByAgentId.get(id);
              requestDelete(id, name, pair?.profileId, pair?.agentScopeId);
            }}
          />
        )}

        {/* Pagination */}
        {!isLoading && (cards.length > 0 || total > 0) ? (
          <div className="flex items-center justify-between border-t border-divider px-7 py-4">
            <div className="flex items-center gap-2 text-sm text-textMuted">
              <span>{t('pagination.rows', 'Rows:')}</span>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <button
                  key={size}
                  className="rounded-sm px-2 py-0.5 text-sm transition-colors"
                  style={{
                    background: pageSize === size ? 'var(--ap-bg-3)' : 'transparent',
                    fontWeight: pageSize === size ? 600 : 400,
                    color: pageSize === size ? 'var(--ap-text)' : 'var(--ap-text-muted)',
                  }}
                  onClick={() => { setPageSize(size); setPage(1); }}
                >
                  {size}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-textMuted tabular-nums">
                {Math.min((page - 1) * pageSize + 1, total)}–
                {Math.min(page * pageSize, total)} of {total}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                {t('pagination.prev', 'Previous')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!hasMore && page * pageSize >= total}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('pagination.next', 'Next')}
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Preview drawer */}
      <AgentPreviewDrawer
        open={Boolean(drawerId)}
        onOpenChange={(open) => { if (!open) closePreview(); }}
        agentId={drawerId ?? ''}
        onOpenPage={openDetail}
      />

      {/* Delete confirmation — requires typing the agent name to confirm. */}
      <DeleteByNameDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        expectedName={deleteTarget?.name ?? ''}
        title={t('delete.title', 'Delete agent?')}
        description={t('delete.description', {
          name: deleteTarget?.name ?? '',
          defaultValue: 'Agent "{{name}}" will be permanently deleted. This cannot be undone.',
        })}
        confirmLabel={
          deleteMutation.isPending
            ? t('delete.deleting', 'Deleting…')
            : t('delete.confirm', 'Delete')
        }
        cancelLabel={t('delete.cancel', 'Cancel')}
        loading={deleteMutation.isPending}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

export default AgentsListPage;
