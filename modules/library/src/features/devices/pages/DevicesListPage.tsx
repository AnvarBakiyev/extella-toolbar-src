/**
 * DevicesListPage — two-section layout per spec revision 5a.
 *
 * Section 1 (top): DefaultDeviceCard — shows the current default device from
 *   `/api/defaults/get_target`. A "Change default" button opens a dialog that
 *   calls `/api/defaults/set_target`.
 *
 * Section 2 (below): Registered-devices grid/list — from `/api/targets/list`.
 *   Any row whose `target` === the current default is EXCLUDED (defensive de-dup).
 *   Per-row "Set as default" action updates Section 1 and removes the row.
 *
 * URL: /devices           → list
 *      /devices/:id       → list + drawer open
 */

import { useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Search,
  ArrowUp,
  ArrowDown,
  Grid,
  List,
  Plus,
  ChevronDown,
  Trash2,
  Edit2,
  Star,
  MonitorSmartphone,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/layout/EmptyState';
import { ErrorBanner } from '@/components/layout/ErrorBanner';
import { ConfirmDialog } from '@/components/layout/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Loader } from '@/components/ui/loader';
import { Icon } from '@/lib/icon';
import { RowActionsMenu } from '@/components/shared/RowActionsMenu';
import { SearchSpinner } from '@/components/shared/SearchSpinner';
import { ProfileAgentFilter } from '@/components/shared/ProfileAgentFilter';
import { DeviceCard } from '../components/DeviceCard';
import { DevicesListTable } from '../components/DevicesListTable';
import { DevicePreviewDrawer } from '../components/DevicePreviewDrawer';
import { DeviceFormDialog } from '../components/DeviceFormDialog';
import { DefaultDeviceCard } from '../components/DefaultDeviceCard';
import { useDeviceTasks, useRemoveDeviceTask } from '../hooks/useDeviceTasks';
import {
  useDevicesList,
  useDefaultDevice,
  useCreateDevice,
  useUpdateDevice,
  useDeleteDevice,
  useSetDefaultDevice,
} from '../hooks/useDevices';
import type { SortKey, SortDir, ViewMode, CreateDeviceBody } from '../schemas';
import type { Device } from '@/lib/types';

const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

export function DevicesListPage() {
  const { t } = useTranslation('devices');
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();

  // Routing state for drawer
  const drawerDeviceId = params.id ?? null;

  const openPreview = useCallback(
    (id: string) => {
      navigate(`/devices/${encodeURIComponent(id)}`, { replace: false });
    },
    [navigate],
  );

  const closePreview = useCallback(() => {
    navigate('/devices', { replace: true });
  }, [navigate]);

  // UI state
  const [view, setView] = useState<ViewMode>('grid');
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<{ profileId?: string; agentId?: string }>({});
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: 'recent',
    dir: 'desc',
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(DEFAULT_PAGE_SIZE);
  const [sortOpen, setSortOpen] = useState(false);

  // Form dialog state
  const [formOpen, setFormOpen] = useState(false);
  const [editDevice, setEditDevice] = useState<Device | undefined>(undefined);

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<Device | null>(null);

  // ── Section 1: default device ───────────────────────────────────
  const {
    data: defaultData,
    isLoading: isDefaultLoading,
    isError: isDefaultError,
    refetch: refetchDefault,
  } = useDefaultDevice();

  const currentDefault = defaultData?.target ?? null;

  // ── Background tasks, grouped by device ────────────────────────
  const { groups: taskGroups, totalCount: taskTotal } = useDeviceTasks();
  const removeTaskMutation = useRemoveDeviceTask();
  // task_id pending a kill-confirmation, or null.
  const [killTarget, setKillTarget] = useState<string | null>(null);
  const confirmKill = async () => {
    if (!killTarget) return;
    try {
      await removeTaskMutation.mutateAsync(killTarget);
      setKillTarget(null);
    } catch {
      /* toast handled in hook */
    }
  };

  // ── Section 2: registered devices list ─────────────────────────
  const { data, isLoading, isError, refetch, isSearching } = useDevicesList({
    q,
    page,
    page_size: pageSize,
    sort_key: sort.key,
    sort_dir: sort.dir,
    profileId: scope.profileId,
    agentId: scope.agentId,
  });

  // While a search is active, results are ranked by relevance (similarity),
  // so the recent/name sort is inert — disable the control to make that clear.
  const searchActive = q.trim() !== '';

  // Mutations
  const createMutation = useCreateDevice();
  const updateMutation = useUpdateDevice();
  const deleteMutation = useDeleteDevice();
  const setDefaultMutation = useSetDefaultDevice();

  // All registered items from the API
  const rawItems = data?.items ?? [];
  const total = data?.total ?? 0;
  const hasMore = data?.has_more ?? false;

  // Defensive de-dup: exclude the default target from the registered list
  const items = rawItems.filter((d) => d.target !== currentDefault);
  // Adjust displayed total (approximate; search/filter is server-side but
  // de-dup is a client-side trim — we only hide at most 1 row)
  const displayTotal = Math.max(0, total - (rawItems.length - items.length));

  // Sort
  const setSortKey = (key: SortKey) => {
    if (sort.key === key) {
      setSort({ key, dir: sort.dir === 'asc' ? 'desc' : 'asc' });
    } else {
      setSort({ key, dir: key === 'recent' ? 'desc' : 'asc' });
    }
    setPage(1);
  };

  // Handlers
  const openCreate = () => {
    setEditDevice(undefined);
    setFormOpen(true);
  };

  const openEdit = (device: Device) => {
    setEditDevice(device);
    setFormOpen(true);
  };

  const openDelete = (device: Device) => {
    setDeleteTarget(device);
  };

  /**
   * Set a device (by target string) as default.
   * Returns a promise so DefaultDeviceCard / ChangeDefaultDialog can await it.
   */
  const handleSetDefault = useCallback(
    (target: string) => {
      return setDefaultMutation.mutateAsync(target);
    },
    [setDefaultMutation],
  );

  /**
   * Convenience wrapper for per-row actions that pass a Device object.
   */
  const handleSetDefaultDevice = (device: Device) => {
    void handleSetDefault(device.target);
  };

  const handleSave = async (values: CreateDeviceBody) => {
    if (editDevice) {
      await updateMutation.mutateAsync({
        id: editDevice.id,
        body: values,
        profileId: editDevice.profile_id ?? undefined,
        agentId: editDevice.agent_id ?? undefined,
      });
    } else {
      await createMutation.mutateAsync({ body: values });
    }
    setFormOpen(false);
    setEditDevice(undefined);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const targetId = deleteTarget.id;
    try {
      await deleteMutation.mutateAsync({
        id: targetId,
        profileId: deleteTarget.profile_id ?? undefined,
        agentId: deleteTarget.agent_id ?? undefined,
      });
      setDeleteTarget(null);
      if (drawerDeviceId === targetId) closePreview();
    } catch {
      /* toast handled in hook */
    }
  };

  const sortLabel: Record<SortKey, string> = {
    recent: t('sort.recent', 'Recent'),
    name: t('sort.name', 'Name'),
  };

  const sortOptions: Array<{ key: SortKey; label: string }> = [
    { key: 'recent', label: t('sort.recent', 'Recent') },
    { key: 'name', label: t('sort.name', 'Name') },
  ];

  const isMutating = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="relative flex flex-1 min-h-0 flex-col">
      {/* Page header */}
      <PageHeader
        className="border-b-0 pb-0"
        title={t('list.title', 'Devices')}
        subtitle={
          isLoading
            ? undefined
            : t('list.subtitle', 'Device registry · {{count}} devices', {
                count: displayTotal,
              })
        }
        actions={
          <Button variant="primary" size="sm" onClick={openCreate}>
            <Icon as={Plus} size={14} />
            {t('actions.newDevice', 'New device')}
          </Button>
        }
      />

      {/* ── Section 1: Default device ─────────────────────────── */}
      <DefaultDeviceCard
        isLoading={isDefaultLoading}
        isError={isDefaultError}
        defaultTarget={currentDefault}
        registeredDevices={rawItems}
        onRetry={() => void refetchDefault()}
        onSetDefault={handleSetDefault}
        isSettingDefault={setDefaultMutation.isPending}
      />

      {/* ── Background tasks, grouped by device ────────────────── */}
      <div className="px-7 pt-4">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.05em] text-textFaint">
            {t('backgroundTasks.heading', 'Background tasks')}
          </span>
          {taskTotal > 0 ? (
            <span className="inline-flex h-5 items-center rounded-pill bg-accentSoft px-1.5 text-xs font-medium text-accent">
              {taskTotal}
            </span>
          ) : null}
        </div>
        {taskGroups.length === 0 ? (
          <p className="text-sm text-textMuted">
            {t('backgroundTasks.empty', 'No background tasks running right now.')}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {taskGroups.map((group) => (
              <div key={group.target} className="flex flex-col gap-1.5">
                {/* Device header */}
                <div className="flex items-center gap-2">
                  <Icon as={MonitorSmartphone} size={13} className="text-iconMuted" />
                  <span className="text-sm font-medium" title={group.target}>
                    {group.isDefault
                      ? t('backgroundTasks.defaultDevice', 'Default device')
                      : group.label}
                  </span>
                  <span className="text-xs text-textFaint" style={{ fontFamily: 'var(--ap-font-mono)' }}>
                    {group.target.slice(0, 8)}…
                  </span>
                  <span className="inline-flex h-4 items-center rounded-pill bg-bg3 px-1.5 text-xs font-medium text-textMuted">
                    {group.tasks.length}
                  </span>
                </div>
                {/* Tasks on this device */}
                {group.tasks.map((tk) => (
                  <div
                    key={tk.taskId}
                    className="flex items-center justify-between gap-3 rounded-md border border-border bg-bgCard px-3 py-1.5"
                  >
                    <span className="truncate text-md text-textMuted">
                      {t('backgroundTasks.taskLabel', 'Task')} ·{' '}
                      <span style={{ fontFamily: 'var(--ap-font-mono)' }}>{tk.taskId}</span>
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={[
                          'inline-flex h-5 items-center rounded-pill px-1.5 text-xs font-medium',
                          tk.phase === 'running'
                            ? 'bg-accentSoft text-accent'
                            : 'bg-bg3 text-textMuted',
                        ].join(' ')}
                      >
                        {tk.status}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-danger hover:bg-dangerSoft hover:text-danger"
                        onClick={() => setKillTarget(tk.taskId)}
                        title={t('backgroundTasks.kill', 'Terminate')}
                      >
                        <Icon as={X} size={13} />
                        {t('backgroundTasks.kill', 'Terminate')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Section 2: Registered devices ─────────────────────── */}

      {/* Section label */}
      <div className="flex items-center gap-2 px-7 pt-4 pb-1">
        <span className="text-xs font-semibold uppercase tracking-[0.05em] text-textFaint">
          {t('registeredSection.heading', 'Registered devices')}
        </span>
        <span className="h-px flex-1 bg-divider" />
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-divider px-7 py-3">
        {/* Search */}
        <div className="relative flex max-w-xs flex-1 items-center">
          <Icon as={Search} size={14} className="absolute left-2.5 text-iconMuted" />
          <input
            type="search"
            placeholder={t('toolbar.searchPlaceholder', 'Search devices...')}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            className="h-8 w-full rounded-md border border-border bg-bgCard pl-8 pr-8 text-sm text-text placeholder:text-textFaint focus:outline-none focus:ring-2 focus:ring-accentSoftStrong"
            aria-label={t('toolbar.searchPlaceholder', 'Search devices...')}
          />
          <SearchSpinner busy={isSearching} className="absolute right-2.5" />
        </div>

        {/* Profile / Agent filter */}
        <ProfileAgentFilter
          value={scope}
          onChange={(s) => { setScope(s); setPage(1); }}
        />

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
            {sortLabel[sort.key]}
            <Icon as={ChevronDown} size={12} />
          </Button>
          {sortOpen && !searchActive ? (
            <div
              className="absolute left-0 top-[calc(100%+4px)] z-10 flex min-w-[160px] flex-col gap-0.5 rounded-md border border-border bg-bgCard p-1 shadow-pop"
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

        {/* Right: result count + view toggle */}
        <div className="ml-auto flex items-center gap-2">
          {!isLoading ? (
            <span className="text-sm text-textMuted">
              {t('toolbar.resultsCount', {
                count: displayTotal,
                defaultValue: `${displayTotal} results`,
              })}
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

      {/* Content area */}
      <div className="flex-1 overflow-y-auto">
        {isError ? (
          <div className="px-7 py-6">
            <ErrorBanner
              title={t('error.loadFailed', 'Failed to load devices')}
              onRetry={() => void refetch()}
            />
          </div>
        ) : isLoading ? (
          <Loader label={t('list.loading', 'Loading…')} />
        ) : items.length === 0 ? (
          /* Empty state */
          <div className="px-7 py-8">
            <EmptyState
              icon={<MonitorSmartphone className="h-6 w-6" />}
              title={
                q
                  ? t('empty.search.title', 'Nothing found')
                  : t('empty.title', 'No registered devices')
              }
              description={
                q
                  ? t('empty.search.subtitle', 'Try a different search term')
                  : t(
                      'empty.registeredSubtitle',
                      'Registered devices appear here. The default device is shown above.',
                    )
              }
              action={
                !q ? (
                  <Button variant="primary" size="sm" onClick={openCreate}>
                    <Icon as={Plus} size={14} />
                    {t('actions.newDevice', 'New device')}
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : view === 'grid' ? (
          /* Grid view */
          <div className="grid grid-cols-4 gap-2.5 px-7 py-5">
            {items.map((device) => (
              <div key={device.id} className="relative">
                <button
                  type="button"
                  className="block w-full cursor-pointer text-left"
                  onClick={() => openPreview(device.id)}
                >
                  <DeviceCard device={device} dense />
                </button>
                <div className="absolute right-2 top-2">
                  <RowActionsMenu
                    ariaLabel={`Actions for ${device.target}`}
                    actions={[
                      {
                        id: 'edit',
                        label: t('actions.edit', 'Edit'),
                        icon: <Edit2 className="h-3.5 w-3.5" strokeWidth={1.5} />,
                        onSelect: () => openEdit(device),
                      },
                      {
                        id: 'set-default',
                        label: t('actions.setDefault', 'Set as default'),
                        icon: <Star className="h-3.5 w-3.5" strokeWidth={1.5} />,
                        onSelect: () => handleSetDefaultDevice(device),
                      },
                      {
                        id: 'delete',
                        label: t('actions.delete', 'Delete'),
                        icon: <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />,
                        danger: true,
                        onSelect: () => openDelete(device),
                      },
                    ]}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* List view */
          <DevicesListTable
            items={items}
            sort={sort}
            onSort={setSortKey}
            onPreview={openPreview}
            onEdit={openEdit}
            onDelete={openDelete}
            onSetDefault={handleSetDefaultDevice}
          />
        )}

        {/* Pagination — use displayTotal so the count is consistent */}
        {!isLoading && (items.length > 0 || displayTotal > 0) ? (
          <div className="flex items-center justify-between border-t border-divider px-7 py-4">
            {/* Page size picker */}
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
                {Math.min((page - 1) * pageSize + 1, displayTotal)}–
                {Math.min(page * pageSize, displayTotal)} of {displayTotal}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                {t('pagination.previous', 'Previous')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!hasMore && page * pageSize >= displayTotal}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('pagination.next', 'Next')}
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Preview drawer */}
      <DevicePreviewDrawer
        open={Boolean(drawerDeviceId)}
        onOpenChange={(open) => {
          if (!open) closePreview();
        }}
        deviceId={drawerDeviceId ?? ''}
        onEdit={openEdit}
        onDelete={openDelete}
        onSetDefault={(device) => handleSetDefaultDevice(device)}
        isSettingDefault={setDefaultMutation.isPending}
      />

      {/* Create / Edit dialog */}
      <DeviceFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) {
            setFormOpen(false);
            setEditDevice(undefined);
          }
        }}
        device={editDevice}
        onSave={handleSave}
        loading={isMutating}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        variant="danger"
        title={t('delete.title', 'Delete device?')}
        description={t('delete.description', {
          name: deleteTarget?.target ?? '',
          defaultValue:
            'Device "{{name}}" will be permanently deleted. This action cannot be undone.',
        })}
        confirmLabel={
          deleteMutation.isPending
            ? t('delete.deleting', 'Deleting…')
            : t('delete.confirm', 'Delete')
        }
        cancelLabel={t('delete.cancel', 'Cancel')}
        loading={deleteMutation.isPending}
        onConfirm={() => void handleConfirmDelete()}
      />

      {/* Terminate background task confirm */}
      <ConfirmDialog
        open={killTarget != null}
        onOpenChange={(open) => {
          if (!open) setKillTarget(null);
        }}
        variant="danger"
        title={t('backgroundTasks.killTitle', 'Terminate task?')}
        description={t('backgroundTasks.killDescription', {
          id: killTarget ?? '',
          defaultValue: 'Are you sure you want to terminate this task? This cannot be undone.',
        })}
        confirmLabel={
          removeTaskMutation.isPending
            ? t('backgroundTasks.killing', 'Terminating…')
            : t('backgroundTasks.kill', 'Terminate')
        }
        cancelLabel={t('delete.cancel', 'Cancel')}
        loading={removeTaskMutation.isPending}
        onConfirm={() => void confirmKill()}
      />
    </div>
  );
}

export default DevicesListPage;
