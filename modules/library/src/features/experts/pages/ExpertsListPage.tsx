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
  RotateCcw,
  Trash,
  Activity,
  ChevronRight,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/layout/EmptyState';
import { ErrorBanner } from '@/components/layout/ErrorBanner';
import { ConfirmDialog } from '@/components/layout/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader } from '@/components/ui/loader';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Icon } from '@/lib/icon';
import { RowActionsMenu } from '@/components/shared/RowActionsMenu';
import { SearchSpinner } from '@/components/shared/SearchSpinner';
import { ProfileAgentFilter } from '@/components/shared/ProfileAgentFilter';
import { useExpertsList } from '../hooks/useExpertsList';
import {
  useDeleteExpert,
  useExpertsTrash,
  useClearExpertsTrash,
  useRestoreExpert,
} from '../hooks/useExpertMutations';
import {
  deriveExpertType,
  EXPERT_TYPE_VALUES,
  EXPERT_TYPE_COLORS,
  type ExpertType,
  type SortKey,
  type SortDir,
  type ViewMode,
} from '../schemas';
import { ExpertCard } from '../components/ExpertCard';
import type { ExpertCardData } from '../components/ExpertCard';
import { ExpertsListTable } from '../components/ExpertsListTable';
import { ExpertPreviewDrawer } from '../components/ExpertPreviewDrawer';
import { ExpertRunsProvider, useExpertRuns } from '../runs/ExpertRunsContext';
import { useDeviceTasks } from '@/features/devices/hooks/useDeviceTasks';

type TabId = 'all' | 'trash';

const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

/**
 * Maps an API expert summary to the visual card shape expected by ExpertCard.
 * Derives type from name/description since the upstream doesn't expose it.
 */
function toCardData(
  item: {
    id?: string | null;
    name: string;
    description?: string | null;
    created_at?: string | null;
    profile_id?: string | null;
    profile_name?: string | null;
    agent_id?: string | null;
    agent_name?: string | null;
    is_global?: boolean | null;
  },
  locale: string,
): ExpertCardData {
  const description = item.description ?? '';
  const type = deriveExpertType(item.name, description);
  const createdAtISO = item.created_at ?? undefined;
  const date = createdAtISO
    ? new Date(createdAtISO).toLocaleDateString(locale)
    : undefined;
  return {
    id: item.id ?? item.name,
    name: item.name,
    description,
    type,
    depsCount: 0, // upstream has no dependency surface; always 0
    profileName: item.profile_name ?? null,
    agentName: item.agent_name ?? null,
    profileId: item.profile_id ?? null,
    agentId: item.agent_id ?? null,
    isGlobal: item.is_global ?? false,
    date,
    createdAtISO,
    pinned: false,
  };
}

/**
 * ExpertsListPage — Experts Library, Variant C (tabs + density toggle).
 *
 * URL: /experts           → list
 *      /experts/:id       → list + drawer open
 *
 * Standalone constraints:
 * - Pagination: server-side, page sizes 25/50/100.
 * - Dependency / graph surfaces are not exposed (no functional backend).
 */
export function ExpertsListPage() {
  return (
    <ExpertRunsProvider>
      <ExpertsListPageInner />
    </ExpertRunsProvider>
  );
}

function ExpertsListPageInner() {
  const { t, i18n } = useTranslation('experts');
  const intlLocale = i18n.language === 'ru' ? 'ru-RU' : i18n.language === 'kz' ? 'kk-KZ' : 'en-US';
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();

  // ── Routing state for drawer (deep-link support) ──
  const drawerName = params.id ?? null;

  const openPreview = useCallback(
    (name: string) => {
      navigate(`/experts/${encodeURIComponent(name)}`, { replace: false });
    },
    [navigate],
  );

  const closePreview = useCallback(() => {
    navigate('/experts', { replace: true });
  }, [navigate]);

  // Shared run state — manual launches (Run buttons + statuses on cards/table,
  // pin-to-top). Background device tasks are a separate, count-only banner.
  const runs = useExpertRuns();

  // Background tasks running on the user's devices (anything currently
  // dispatched, including runs started outside this UI). We only show a total
  // count here and send the user to the Devices page for the per-device list —
  // the tasks carry no expert mapping, so there is nothing to render on a card.
  const backgroundCount = useDeviceTasks().totalCount;

  // ── UI state ──
  const [tab, setTab] = useState<TabId>('all');
  const [view, setView] = useState<ViewMode>('grid');
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<{ profileId?: string; agentId?: string }>({});
  const [activeTypes, setActiveTypes] = useState<Set<ExpertType>>(new Set());
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'recent', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(DEFAULT_PAGE_SIZE);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const isTrashTab = tab === 'trash';

  // Standalone build is single-user: every object belongs to the current
  // profile, so we always query with scope='mine'. The Trash tab swaps the
  // data source entirely (see `trashQuery` below), so its params here are a
  // throwaway no-op kept only to satisfy the hook's prop shape.
  //
  // `types` + `sort_key` + `sort_dir` are applied catalogue-wide inside
  // `listExperts` BEFORE pagination, so the page-size slice the UI receives
  // is already the correct one — no client-side filter/sort needed here.
  const { data, isLoading, isError, refetch, isSearching } = useExpertsList(
    isTrashTab
      ? { q: '', page: 1, page_size: 1, scope: 'mine' }
      : {
          q,
          page,
          page_size: pageSize,
          scope: 'mine',
          types: [...activeTypes],
          sort_key: sort.key,
          sort_dir: sort.dir,
          profileId: scope.profileId,
          agentId: scope.agentId,
        },
  );

  // While a search is active, results are ranked by relevance (similarity),
  // so the recent/name sort is inert — disable the control to make that clear.
  const searchActive = !isTrashTab && q.trim() !== '';

  // ── Trash query (Studio v2 §3.A, v0.8.0) — only fetched when the tab is active.
  const trashQuery = useExpertsTrash(isTrashTab);

  // ── Delete + restore + clear mutations
  const [deleteTarget, setDeleteTarget] = useState<{
    name: string;
    profileId?: string;
    agentId?: string;
  } | null>(null);
  const deleteName = deleteTarget?.name ?? null;
  const [clearTrashOpen, setClearTrashOpen] = useState(false);
  const deleteMutation = useDeleteExpert();
  const restoreMutation = useRestoreExpert();
  const clearMutation = useClearExpertsTrash();

  const filterCount = activeTypes.size;

  const setSortKey = (key: SortKey) => {
    if (sort.key === key) {
      setSort({ key, dir: sort.dir === 'asc' ? 'desc' : 'asc' });
    } else {
      // 'recent' defaults to newest-first (desc); the others to A→Z (asc).
      setSort({ key, dir: key === 'recent' ? 'desc' : 'asc' });
    }
    setPage(1);
  };

  const resetFilters = () => {
    setQ('');
    setActiveTypes(new Set());
    setPage(1);
  };

  const toggleType = (t: ExpertType) => {
    const next = new Set(activeTypes);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    setActiveTypes(next);
    setPage(1);
  };

  const handleTabChange = (newTab: TabId) => {
    setTab(newTab);
    setPage(1);
    setSelected(new Set());
  };

  // Map API items to card data. Filter + sort are applied catalogue-wide by
  // `listExperts` BEFORE pagination, so we just project the page slice here.
  const rawItems = data?.items ?? [];
  const cards: ExpertCardData[] = rawItems.map((item) => toCardData(item, intlLocale));
  // Keep a map from expert name to its pair for delete pass-through.
  const pairByExpertName = new Map(
    rawItems.map((item) => [
      item.name,
      { profileId: item.profile_id ?? undefined, agentId: item.agent_id ?? undefined },
    ]),
  );
  // Pin currently-running experts (in this page slice) to the top so their
  // status is visible first. Array.sort is stable in V8, so non-running cards
  // keep their incoming order.
  const runningSet = new Set(runs.runningNames);
  const orderedCards = [...cards].sort(
    (a, b) => Number(runningSet.has(b.name)) - Number(runningSet.has(a.name)),
  );

  // Show the background-tasks banner only when the device actually reports live
  // tasks and we're not on the Trash tab.
  const showBackgroundBanner = !isTrashTab && backgroundCount > 0;

  // Total from API; falls back to 0
  const total = data?.total ?? 0;
  const hasMore = data?.has_more ?? false;

  // Sort label for toolbar display
  const sortLabel = {
    recent: t('sort.recent', 'Recent'),
    name: t('sort.name', 'Name'),
    type: t('sort.type', 'Type'),
  }[sort.key];

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'all', label: t('tabs.all', 'All') },
    { id: 'trash', label: t('tabs.trash', 'Trash') },
  ];

  // Trash rows: map upstream trash items to the same card shape so the same
  // grid/list components can render them with no special-casing in markup.
  const trashCards: ExpertCardData[] = (trashQuery.data?.experts ?? []).map((it) =>
    toCardData(
      {
        name: it.name,
        description: it.description ?? '',
        created_at: it.deleted_at ?? it.updated_at ?? it.created_at,
      },
      intlLocale,
    ),
  );
  const trashCount = trashQuery.data?.experts.length ?? 0;
  const retentionDays = trashQuery.data?.retention_days ?? 30;

  const requestDelete = (name: string, profileId?: string, agentId?: string) =>
    setDeleteTarget({ name, profileId, agentId });
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const { name, profileId, agentId } = deleteTarget;
    try {
      await deleteMutation.mutateAsync({ name, profileId, agentId });
      // If the drawer is open on the deleted item, close it.
      if (drawerName === name) closePreview();
      setDeleteTarget(null);
    } catch {
      /* toast handled in hook */
    }
  };
  const confirmClearTrash = async () => {
    try {
      await clearMutation.mutateAsync();
      setClearTrashOpen(false);
    } catch {
      /* toast handled in hook */
    }
  };

  const sortOptions: Array<{ key: SortKey; label: string }> = [
    { key: 'recent', label: t('sort.recent', 'Recent') },
    { key: 'name', label: t('sort.name', 'Name') },
    { key: 'type', label: t('sort.type', 'Type') },
  ];

  return (
    <TooltipProvider>
      <div className="relative flex flex-1 min-h-0 flex-col">
        {/* Page header */}
        <PageHeader
          className="border-b-0 pb-0"
          title={t('list.title', 'Experts Library')}
          subtitle={
            isLoading
              ? undefined
              : t('list.subtitle', 'Expert registry · {{count}} active', { count: total })
          }
        />

        {/* Tabs */}
        <div className="flex items-center gap-0.5 border-b border-divider px-7">
          {tabs.map((tab_) => (
            <button
              key={tab_.id}
              role="tab"
              aria-selected={tab === tab_.id}
              className={[
                'relative px-3 py-3 text-md transition-colors',
                tab === tab_.id ? 'font-medium text-text' : 'text-textMuted hover:text-text',
                tab === tab_.id
                  ? 'after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-t-sm after:bg-accent'
                  : '',
              ].join(' ')}
              onClick={() => handleTabChange(tab_.id)}
            >
              <span className="flex items-center gap-2">
                {tab_.label}
                {tab_.id === 'trash' ? (
                  trashCount > 0 ? (
                    <span
                      className="rounded-pill border border-border px-1.5 text-xs text-textMuted tabular-nums"
                      style={{
                        background: tab === tab_.id ? 'var(--ap-bg-3)' : 'transparent',
                      }}
                    >
                      {trashCount}
                    </span>
                  ) : null
                ) : !isLoading && data ? (
                  <span
                    className="rounded-pill border border-border px-1.5 text-xs text-textMuted tabular-nums"
                    style={{
                      background: tab === tab_.id ? 'var(--ap-bg-3)' : 'transparent',
                    }}
                  >
                    {total}
                  </span>
                ) : null}
              </span>
            </button>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 border-b border-divider px-7 py-3">
          {/* Search */}
          <div className="relative flex max-w-xs flex-1 items-center">
            <Icon as={Search} size={14} className="absolute left-2.5 text-iconMuted" />
            <input
              type="search"
              placeholder={t('toolbar.searchPlaceholder', 'Search experts...')}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              className="h-8 w-full rounded-md border border-border bg-bgCard pl-8 pr-8 text-sm text-text placeholder:text-textFaint focus:outline-none focus:ring-2 focus:ring-accentSoftStrong"
              aria-label="Search experts"
            />
            <SearchSpinner busy={isSearching} className="absolute right-2.5" />
          </div>

          {/* Filters button */}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setFiltersOpen(!filtersOpen)}
            style={
              filterCount > 0
                ? {
                    background: 'var(--ap-accent-soft)',
                    borderColor: 'var(--ap-accent-border)',
                    color: 'var(--ap-accent)',
                  }
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

          {/* Profile / Agent filter */}
          {!isTrashTab && (
            <ProfileAgentFilter
              value={scope}
              onChange={(s) => { setScope(s); setPage(1); }}
            />
          )}

          {/* Sort dropdown */}
          <div className="relative">
            <Button
              variant="secondary"
              size="sm"
              disabled={searchActive}
              title={searchActive ? t('toolbar.sortDisabledWhileSearching', 'Results are sorted by relevance while searching') : undefined}
              onClick={() => setSortOpen((o) => !o)}
            >
              <Icon as={sort.dir === 'asc' ? ArrowUp : ArrowDown} size={14} />
              {sortLabel}
              <Icon as={ChevronDown} size={12} />
            </Button>
            {sortOpen && !searchActive ? (
              <div
                className="absolute left-0 top-[calc(100%+4px)] z-10 flex min-w-[200px] flex-col gap-0.5 rounded-md border border-border bg-bgCard p-1 shadow-pop"
                onMouseLeave={() => setSortOpen(false)}
              >
                {sortOptions.map((o) => (
                  <button
                    key={o.key}
                    className="flex items-center justify-between rounded-sm px-2 py-1.5 text-left text-md text-text hover:bg-bg3"
                    style={{
                      background: sort.key === o.key ? 'var(--ap-bg-3)' : undefined,
                    }}
                    onClick={() => {
                      setSortKey(o.key);
                      setSortOpen(false);
                    }}
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

          {/* Right: results count + grid/list toggle */}
          <div className="ml-auto flex items-center gap-2">
            {!isLoading ? (
              <span className="text-sm text-textMuted">
                {t('toolbar.resultsCount', { count: total, defaultValue: `${total} results` })}
              </span>
            ) : null}

            {/* View toggle */}
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
          <div className="flex gap-6 border-b border-divider bg-bgInset px-7 py-3">
            {/* Type filters */}
            <div className="flex-1">
              <div className="mb-2 text-xs font-medium uppercase tracking-[0.04em] text-textFaint">
                {t('filters.type', 'Type')}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {EXPERT_TYPE_VALUES.map((typeVal) => {
                  const color = EXPERT_TYPE_COLORS[typeVal];
                  const active = activeTypes.has(typeVal);
                  return (
                    <button
                      key={typeVal}
                      className="flex items-center gap-1 rounded-pill border px-2 py-0.5 text-xs font-medium transition-colors"
                      style={{
                        background: active ? 'var(--ap-bg-3)' : 'var(--ap-bg-card)',
                        borderColor: active ? 'var(--ap-border-strong)' : 'var(--ap-border)',
                        color: active ? 'var(--ap-text)' : 'var(--ap-text-muted)',
                      }}
                      onClick={() => toggleType(typeVal)}
                      aria-pressed={active}
                    >
                      <span
                        className="inline-block h-2 w-2 rounded-[2px]"
                        style={{ background: color }}
                        aria-hidden="true"
                      />
                      {t(`types.${typeVal}`, typeVal)}
                    </button>
                  );
                })}
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

        {/* Bulk action bar */}
        {view === 'list' && selected.size > 0 ? (
          <div className="flex items-center gap-2 border-b border-divider bg-bgInset px-7 py-2 text-md">
            <strong>{selected.size}</strong>
            <span className="text-textMuted">selected</span>
            <div className="mx-1 h-4 w-px bg-divider" />
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => setSelected(new Set())}
            >
              <Icon as={X} size={14} />
            </Button>
          </div>
        ) : null}

        {/* Trash actions bar — shown only in the Trash tab. Holds the global
            Empty trash button (per-item permanent delete doesn't exist
            upstream; v0.8.0 only exposes bulk-clear). */}
        {isTrashTab ? (
          <div className="flex items-center gap-2 border-b border-divider bg-bgInset px-7 py-2 text-sm text-textMuted">
            <span>
              {t('trash.retention', {
                count: retentionDays,
                defaultValue:
                  'Items stay in trash for {{count}} days, then auto-purge. Restore individually below, or empty everything in one go.',
              })}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-danger hover:bg-dangerSoft hover:text-danger"
              disabled={trashCount === 0}
              onClick={() => setClearTrashOpen(true)}
            >
              <Icon as={Trash} size={13} />
              {t('trash.empty', 'Empty trash')}
            </Button>
          </div>
        ) : null}

        {/* Content area */}
        <div className="flex-1 overflow-y-auto">
          {/* Background-tasks banner — count only. The device task list has no
              expert mapping and is only addressable by device target, so the
              detail lives on the Devices page; here we just point to it. Running
              experts launched from this UI are pinned to the top of the grid. */}
          {showBackgroundBanner ? (
            <button
              type="button"
              onClick={() => navigate('/devices')}
              className="flex w-full items-center gap-3 border-b border-divider bg-bgInset px-7 py-3 text-left hover:bg-bg2"
            >
              <Icon as={Activity} size={15} className="text-accent" />
              <span className="text-md font-medium">
                {t('backgroundTasks.banner', 'Background tasks running: {{count}}', {
                  count: backgroundCount,
                })}
              </span>
              <span className="ml-auto flex items-center gap-1 text-sm text-textMuted">
                {t('backgroundTasks.cta', 'View in Devices')}
                <Icon as={ChevronRight} size={14} />
              </span>
            </button>
          ) : null}

          {isError ? (
            <div className="px-7 py-6">
              <ErrorBanner
                title="Failed to load experts"
                onRetry={() => void refetch()}
              />
            </div>
          ) : isTrashTab ? (
            /* Trash tab — separate render path so we can show Restore-only
               actions and the retention copy. */
            trashQuery.isLoading ? (
              <div className="flex flex-col gap-1 px-7 py-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : trashQuery.isError ? (
              <div className="px-7 py-6">
                <ErrorBanner
                  title={t('trash.errorTitle', 'Failed to load trash')}
                  onRetry={() => void trashQuery.refetch()}
                />
              </div>
            ) : trashCards.length === 0 ? (
              <div className="px-7 py-8">
                <EmptyState
                  icon={<Trash2 className="h-6 w-6" />}
                  title={t('trash.empty.title', 'Trash is empty')}
                  description={t(
                    'trash.empty.subtitle',
                    'Deleted experts will land here and can be restored within the retention window.',
                  )}
                />
              </div>
            ) : (
              <div className="flex flex-col">
                {trashCards.map((it) => (
                  <div
                    key={it.name}
                    className="flex items-center gap-3 border-b border-divider px-7 py-3 hover:bg-bg2"
                  >
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="text-md font-medium">{it.name}</span>
                      {it.description ? (
                        <span className="truncate text-sm text-textMuted">{it.description}</span>
                      ) : null}
                      {it.date ? (
                        <span className="text-xs text-textFaint">
                          {t('trash.deletedOn', 'Deleted')} · {it.date}
                        </span>
                      ) : null}
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={restoreMutation.isPending}
                      onClick={() => void restoreMutation.mutate(it.name)}
                    >
                      <Icon as={RotateCcw} size={13} />
                      {t('trash.restore', 'Restore')}
                    </Button>
                  </div>
                ))}
              </div>
            )
          ) : isLoading ? (
            <Loader label={t('list.loading', 'Loading…')} />
          ) : cards.length === 0 ? (
            /* Empty state */
            <div className="px-7 py-8">
              <EmptyState
                icon={<Search className="h-6 w-6" />}
                title={
                  q || filterCount > 0
                    ? t('empty.search.title', 'Nothing found')
                    : t('list.empty', 'No experts yet.')
                }
                description={
                  q || filterCount > 0
                    ? t(
                        'empty.search.subtitle',
                        'Try resetting filters or searching in another tab',
                      )
                    : undefined
                }
                action={
                  filterCount > 0 ? (
                    <Button variant="secondary" size="sm" onClick={resetFilters}>
                      Reset filters
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : view === 'grid' ? (
            /* Grid view */
            <div className="grid grid-cols-4 gap-2.5 px-7 py-5">
              {orderedCards.map((expert) => {
                const rv = runs.getRun(expert.name);
                return (
                <div key={expert.id ?? expert.name} className="relative">
                  <div
                    role="button"
                    tabIndex={0}
                    className="block w-full cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accentSoftStrong rounded-xl"
                    onClick={() => openPreview(expert.name)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openPreview(expert.name);
                      }
                    }}
                  >
                    <ExpertCard
                      expert={expert}
                      dense
                      runPhase={rv?.phase ?? 'idle'}
                      runStatus={rv?.status}
                      onRun={() =>
                        runs.run(expert.name, {
                          profileId: expert.profileId ?? undefined,
                          agentId: expert.agentId ?? undefined,
                        })
                      }
                      onStop={() => runs.stop(expert.name)}
                    />
                  </div>
                  <div className="absolute right-2 top-2">
                    <RowActionsMenu
                      ariaLabel={`Actions for ${expert.name}`}
                      actions={[
                        {
                          id: 'delete',
                          label: t('actions.delete', 'Delete'),
                          icon: <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />,
                          danger: true,
                          onSelect: () => {
                            const pair = pairByExpertName.get(expert.name);
                            requestDelete(expert.name, pair?.profileId, pair?.agentId);
                          },
                        },
                      ]}
                    />
                  </div>
                </div>
                );
              })}
            </div>
          ) : (
            /* List view */
            <ExpertsListTable
              items={orderedCards}
              sort={sort}
              onSort={setSortKey}
              selected={selected}
              onSelectChange={setSelected}
              onPreview={openPreview}
              onDelete={(name) => {
                const pair = pairByExpertName.get(name);
                requestDelete(name, pair?.profileId, pair?.agentId);
              }}
            />
          )}

          {/* Pagination */}
          {!isTrashTab && !isLoading && (cards.length > 0 || total > 0) ? (
            <div className="flex items-center justify-between border-t border-divider px-7 py-4">
              {/* Page size picker */}
              <div className="flex items-center gap-2 text-sm text-textMuted">
                <span>Rows:</span>
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <button
                    key={size}
                    className="rounded-sm px-2 py-0.5 text-sm transition-colors"
                    style={{
                      background: pageSize === size ? 'var(--ap-bg-3)' : 'transparent',
                      fontWeight: pageSize === size ? 600 : 400,
                      color: pageSize === size ? 'var(--ap-text)' : 'var(--ap-text-muted)',
                    }}
                    onClick={() => {
                      setPageSize(size);
                      setPage(1);
                    }}
                  >
                    {size}
                  </button>
                ))}
              </div>

              {/* Page navigation */}
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
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!hasMore && page * pageSize >= total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        {/* Preview drawer */}
        <ExpertPreviewDrawer
          open={Boolean(drawerName)}
          onOpenChange={(open) => { if (!open) closePreview(); }}
          expertName={drawerName ?? ''}
          onDelete={(name) => {
            const pair = pairByExpertName.get(name);
            requestDelete(name, pair?.profileId, pair?.agentId);
          }}
        />

        {/* Delete confirmation — soft delete via v0.8.0 trash. Tells the
            user the retention window so they know the action is reversible. */}
        <ConfirmDialog
          open={Boolean(deleteName)}
          onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
          variant="danger"
          title={t('delete.title', 'Move to trash?')}
          description={t('delete.description', {
            name: deleteName ?? '',
            days: retentionDays,
            defaultValue:
              'Expert "{{name}}" will be moved to the trash bin. You can restore it within {{days}} days from the Trash tab.',
          })}
          confirmLabel={
            deleteMutation.isPending
              ? t('delete.deleting', 'Deleting…')
              : t('delete.confirm', 'Move to trash')
          }
          cancelLabel={t('delete.cancel', 'Cancel')}
          loading={deleteMutation.isPending}
          onConfirm={() => void confirmDelete()}
        />

        {/* Empty-trash confirmation — bulk, irreversible. */}
        <ConfirmDialog
          open={clearTrashOpen}
          onOpenChange={(open) => { if (!open) setClearTrashOpen(false); }}
          variant="danger"
          title={t('trash.clear.title', 'Empty trash?')}
          description={t('trash.clear.description', {
            count: trashCount,
            defaultValue:
              'All {{count}} trashed experts will be permanently deleted. This cannot be undone.',
          })}
          confirmLabel={
            clearMutation.isPending
              ? t('trash.clear.clearing', 'Emptying…')
              : t('trash.clear.confirm', 'Empty trash')
          }
          cancelLabel={t('delete.cancel', 'Cancel')}
          loading={clearMutation.isPending}
          onConfirm={() => void confirmClearTrash()}
        />

      </div>
    </TooltipProvider>
  );
}

export default ExpertsListPage;
