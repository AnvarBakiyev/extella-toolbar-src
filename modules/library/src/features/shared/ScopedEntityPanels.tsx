/**
 * ScopedEntityPanels — reusable "mini sections" for the Experts / Concepts /
 * Rules of a given (profile, agent) scope.
 *
 * Used by the Agent detail page (profile + agent) and the Team detail page
 * (profile only — fans out across every member agent). Each panel reuses the
 * SAME building blocks as the entity's own top-level section:
 *   - Experts → ExpertCard grid + ExpertPreviewDrawer
 *   - Concepts → ConceptsTable + RCDetailDialog (view / edit / delete) + create
 *   - Rules    → RulesTable + RCDetailDialog (view / edit / delete) + create
 * Plus the shared <Pagination> control.
 *
 * Team-only extras (opt-in via props, off on the Agent page):
 *   - `comparisonProfileId`: enables an "Only unique" filter — shows entities
 *     that exist in this scope but NOT in the comparison scope (Default profile).
 *   - `createScope` / `createScopeLabel`: enables a "New …" button that creates
 *     concepts/rules constrained to the given (profile, agent).
 *
 * Scope reset: pass a React `key` of the active scope at the call site so a
 * scope switch remounts the panel (page → 1, filters off, dialogs closed).
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import { Icon } from '@/lib/icon';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorBanner } from '@/components/layout/ErrorBanner';
import { EmptyState } from '@/components/layout/EmptyState';
import { ConfirmDialog } from '@/components/layout/ConfirmDialog';
import { Pagination } from '@/components/layout/Pagination';
import { RCDetailDialog } from '@/components/shared/RCDetailDialog';
import type { RCStatus } from '@/components/shared/RCStatusBadge';
import { AdminCreateModal } from '@/components/shared/AdminCreateModal';

import { useExpertsList } from '@/features/experts/hooks/useExpertsList';
import { ExpertCard } from '@/features/experts/components/ExpertCard';
import { ExpertPreviewDrawer } from '@/features/experts/components/ExpertPreviewDrawer';
import { ExpertRunsProvider } from '@/features/experts/runs/ExpertRunsContext';
import { deriveExpertType, type ExpertSummary } from '@/features/experts/schemas';

import {
  useConcepts,
  useCreateConcept,
  useUpdateConcept,
  useDeleteConcept,
} from '@/features/concepts/hooks/useConcepts';
import { ConceptsTable, type ConceptRow } from '@/features/concepts/components/ConceptsTable';

import {
  useRules,
  useCreateRule,
  useUpdateRule,
  useDeleteRule,
} from '@/features/rules/hooks/useRules';
import { RulesTable, type RuleRow } from '@/features/rules/components/RulesTable';

const DEFAULT_PAGE_SIZE = 25;
/** Page size for the comparison fetch that powers the "unique" filter. */
const COMPARISON_PAGE_SIZE = 500;

/* ─── shared props ───────────────────────────────────────────────── */

export interface ScopedPanelProps {
  profileId: string;
  /** Omit to scope to the whole profile (Team container = all member agents). */
  agentId?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  /**
   * When set (and different from `profileId`), enables the "Only unique" filter:
   * entities present in this scope but absent from the comparison scope
   * (typically the Default profile).
   */
  comparisonProfileId?: string;
}

export interface CreatableScopedPanelProps extends ScopedPanelProps {
  /** When set, shows a "New …" button creating items under this fixed scope. */
  createScope?: { profileId: string; agentId: string };
  /** Human label for the create target (e.g. "Sales · Bug Triager"). */
  createScopeLabel?: string;
}

function previewOf(text: string): string {
  return text.split('\n')[0].slice(0, 60);
}

/* ─── small shared UI ────────────────────────────────────────────── */

function PanelToolbar({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  if (!left && !right) return null;
  return (
    <div className="flex items-center gap-2 px-7 pb-1 pt-4">
      {left}
      {right ? <div className="ml-auto">{right}</div> : null}
    </div>
  );
}

function UniqueToggle({
  on,
  onChange,
  disabled,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!on)}
      aria-pressed={on}
      title="Show only entities unique to this team (not in the Default profile)"
      className="inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50"
      style={{
        background: on ? 'var(--ap-accent-soft)' : 'var(--ap-bg-card)',
        borderColor: on ? 'var(--ap-accent-border)' : 'var(--ap-border)',
        color: on ? 'var(--ap-accent)' : 'var(--ap-text-muted)',
      }}
    >
      <Icon as={Sparkles} size={12} />
      Only unique
    </button>
  );
}

function CreateScopeNote({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-border bg-bgInset px-3 py-2 text-sm text-textMuted">
      Will be added to <span className="font-medium text-text">{label}</span>.
    </div>
  );
}

/* ─── comparison probes (mounted only when the unique filter is enabled) ── */

function ExpertsCmpProbe({ profileId, onKeys }: { profileId: string; onKeys: (s: Set<string>) => void }) {
  const { data } = useExpertsList({ profileId, page_size: COMPARISON_PAGE_SIZE });
  useEffect(() => {
    onKeys(new Set((data?.items ?? []).map((e) => (e.name ?? '').trim().toLowerCase())));
  }, [data, onKeys]);
  return null;
}

function ConceptsCmpProbe({ profileId, onKeys }: { profileId: string; onKeys: (s: Set<string>) => void }) {
  const { data } = useConcepts({ profileId, page_size: COMPARISON_PAGE_SIZE });
  useEffect(() => {
    onKeys(new Set(((data?.items ?? []) as ConceptRow[]).map((c) => (c.text ?? '').trim())));
  }, [data, onKeys]);
  return null;
}

function RulesCmpProbe({ profileId, onKeys }: { profileId: string; onKeys: (s: Set<string>) => void }) {
  const { data } = useRules({ profileId, page_size: COMPARISON_PAGE_SIZE });
  useEffect(() => {
    onKeys(new Set(((data?.items ?? []) as RuleRow[]).map((r) => (r.text ?? '').trim())));
  }, [data, onKeys]);
  return null;
}

/* ─── ExpertsPanel ───────────────────────────────────────────────── */

export function ExpertsPanel({
  profileId,
  agentId,
  emptyTitle = 'No experts',
  emptyDescription = 'Experts in this scope will appear here.',
  comparisonProfileId,
}: ScopedPanelProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [drawerName, setDrawerName] = useState<string | null>(null);
  const [onlyUnique, setOnlyUnique] = useState(false);
  const [cmpKeys, setCmpKeys] = useState<Set<string> | null>(null);
  const uniqueEnabled = Boolean(comparisonProfileId && comparisonProfileId !== profileId);

  // When filtering to unique, fetch the full set (pagination is hidden) so the
  // filter spans everything, not just the current page.
  const { data, isLoading, isError, refetch } = useExpertsList({
    profileId,
    agentId,
    page: onlyUnique ? 1 : page,
    page_size: onlyUnique ? COMPARISON_PAGE_SIZE : pageSize,
  });
  const items = data?.items ?? [];
  const display =
    onlyUnique && cmpKeys
      ? items.filter((e) => !cmpKeys.has((e.name ?? '').trim().toLowerCase()))
      : items;

  let body: ReactNode;
  if (isLoading) {
    body = (
      <div className="grid grid-cols-3 gap-2.5 p-7">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
    );
  } else if (isError) {
    body = (
      <div className="p-7">
        <ErrorBanner title="Failed to load experts" onRetry={() => void refetch()} />
      </div>
    );
  } else if (display.length === 0) {
    body = (
      <div className="p-7">
        <EmptyState
          title={onlyUnique ? 'Nothing unique here' : emptyTitle}
          description={onlyUnique ? 'Every expert in this scope also exists in the Default profile.' : emptyDescription}
        />
      </div>
    );
  } else {
    body = (
      <div className="p-7 pb-3">
        <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          {display.map((e: ExpertSummary) => {
            const type = e.type ?? deriveExpertType(e.name, e.description ?? '');
            return (
              <button
                key={e.id ?? e.name}
                type="button"
                className="block w-full cursor-pointer text-left"
                onClick={() => setDrawerName(e.name)}
                aria-label={e.name}
              >
                <ExpertCard
                  expert={{
                    name: e.name,
                    description: e.description ?? '',
                    type,
                    depsCount: 0,
                    // Scope is implied by the panel context — don't repeat it per card.
                    profileName: null,
                    agentName: null,
                    isGlobal: e.is_global ?? false,
                    date: e.created_at ? new Date(e.created_at).toLocaleDateString() : undefined,
                  }}
                  dense
                />
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <ExpertRunsProvider>
      {uniqueEnabled && comparisonProfileId ? (
        <ExpertsCmpProbe profileId={comparisonProfileId} onKeys={setCmpKeys} />
      ) : null}
      {uniqueEnabled ? (
        <PanelToolbar
          left={<UniqueToggle on={onlyUnique} onChange={setOnlyUnique} disabled={!cmpKeys} />}
        />
      ) : null}
      {body}
      {!isLoading && !isError && !onlyUnique && items.length > 0 ? (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={data?.total ?? items.length}
          hasMore={data?.has_more ?? false}
          onPageChange={setPage}
          onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
        />
      ) : null}
      <ExpertPreviewDrawer
        open={Boolean(drawerName)}
        onOpenChange={(open) => { if (!open) setDrawerName(null); }}
        expertName={drawerName ?? ''}
      />
    </ExpertRunsProvider>
  );
}

/* ─── ConceptsPanel ──────────────────────────────────────────────── */

export function ConceptsPanel({
  profileId,
  agentId,
  emptyTitle = 'No concepts',
  emptyDescription = 'Concepts in this scope will appear here.',
  comparisonProfileId,
  createScope,
  createScopeLabel,
}: CreatableScopedPanelProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [onlyUnique, setOnlyUnique] = useState(false);
  const [cmpKeys, setCmpKeys] = useState<Set<string> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<
    { id: string; preview: string; profileId?: string; agentId?: string } | null
  >(null);
  const uniqueEnabled = Boolean(comparisonProfileId && comparisonProfileId !== profileId);

  const { data, isLoading, isError, refetch } = useConcepts({
    profileId,
    agentId,
    page: onlyUnique ? 1 : page,
    page_size: onlyUnique ? COMPARISON_PAGE_SIZE : pageSize,
  });
  const items = (data?.items ?? []) as ConceptRow[];
  const display =
    onlyUnique && cmpKeys ? items.filter((c) => !cmpKeys.has((c.text ?? '').trim())) : items;
  const detailItem = items.find((c) => c.id === detailId) ?? null;

  const createConcept = useCreateConcept();
  const updateConcept = useUpdateConcept();
  const deleteMutation = useDeleteConcept();

  let body: ReactNode;
  if (isLoading) {
    body = (
      <div className="p-4 flex flex-col gap-2">
        {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  } else if (isError) {
    body = (
      <div className="p-7">
        <ErrorBanner title="Failed to load concepts" onRetry={() => void refetch()} />
      </div>
    );
  } else if (display.length === 0) {
    body = (
      <div className="p-7">
        <EmptyState
          title={onlyUnique ? 'Nothing unique here' : emptyTitle}
          description={onlyUnique ? 'Every concept in this scope also exists in the Default profile.' : emptyDescription}
        />
      </div>
    );
  } else {
    body = (
      <ConceptsTable
        rows={display}
        role="org_admin"
        currentUserId=""
        loading={false}
        onOpen={(id) => setDetailId(id)}
        onDelete={(id, preview) => {
          const row = items.find((c) => c.id === id);
          setDeleteTarget({
            id,
            preview,
            profileId: row?.profile_id ?? undefined,
            agentId: row?.agent_id ?? undefined,
          });
        }}
        hideProfileAgentColumn
      />
    );
  }

  return (
    <div className="pb-2">
      {uniqueEnabled && comparisonProfileId ? (
        <ConceptsCmpProbe profileId={comparisonProfileId} onKeys={setCmpKeys} />
      ) : null}
      <PanelToolbar
        left={uniqueEnabled ? <UniqueToggle on={onlyUnique} onChange={setOnlyUnique} disabled={!cmpKeys} /> : undefined}
        right={
          createScope ? (
            <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
              <Icon as={Plus} size={13} />
              New concept
            </Button>
          ) : undefined
        }
      />
      {body}
      {!isLoading && !isError && !onlyUnique && items.length > 0 ? (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={data?.total ?? items.length}
          hasMore={data?.has_more ?? false}
          onPageChange={setPage}
          onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
        />
      ) : null}

      {detailItem && (
        <RCDetailDialog
          open={Boolean(detailItem)}
          onOpenChange={(open) => { if (!open) setDetailId(null); }}
          item={{
            id: detailItem.id,
            text: detailItem.text,
            status: (detailItem.status ?? 'published_active') as RCStatus,
            author_id: detailItem.author_id ?? '',
            profile_name: detailItem.profile_name,
            agent_name: detailItem.agent_name,
            created_at: detailItem.created_at,
            updated_at: detailItem.updated_at,
          }}
          kind="concept"
          role="org_admin"
          currentUserId=""
          onSave={async (text) => {
            await updateConcept.mutateAsync({
              id: detailItem.id,
              text,
              profileId: detailItem.profile_id ?? undefined,
              agentId: detailItem.agent_id ?? undefined,
            });
          }}
          onDelete={() => {
            setDeleteTarget({
              id: detailItem.id,
              preview: previewOf(detailItem.text),
              profileId: detailItem.profile_id ?? undefined,
              agentId: detailItem.agent_id ?? undefined,
            });
          }}
        />
      )}

      {createScope && (
        <AdminCreateModal
          open={createOpen}
          onOpenChange={setCreateOpen}
          kind="concept"
          onSave={async (text) => {
            await createConcept.mutateAsync({
              text,
              profileId: createScope.profileId,
              agentId: createScope.agentId,
            });
          }}
          extraFields={createScopeLabel ? <CreateScopeNote label={createScopeLabel} /> : undefined}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        variant="danger"
        title="Delete concept?"
        description={`Concept "${deleteTarget?.preview ?? ''}" will be deleted permanently. This action cannot be undone.`}
        confirmLabel={deleteMutation.isPending ? 'Deleting…' : 'Delete'}
        cancelLabel="Cancel"
        loading={deleteMutation.isPending}
        onConfirm={async () => {
          if (!deleteTarget) return;
          const { id, profileId: pId, agentId: aId } = deleteTarget;
          try {
            await deleteMutation.mutateAsync({ id, profileId: pId, agentId: aId });
            setDeleteTarget(null);
            if (detailId === id) setDetailId(null);
          } catch {
            /* toast handled in hook */
          }
        }}
      />
    </div>
  );
}

/* ─── RulesPanel ─────────────────────────────────────────────────── */

export function RulesPanel({
  profileId,
  agentId,
  emptyTitle = 'No rules',
  emptyDescription = 'Rules in this scope will appear here.',
  comparisonProfileId,
  createScope,
  createScopeLabel,
}: CreatableScopedPanelProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [onlyUnique, setOnlyUnique] = useState(false);
  const [cmpKeys, setCmpKeys] = useState<Set<string> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<
    { id: string; preview: string; profileId?: string; agentId?: string } | null
  >(null);
  const uniqueEnabled = Boolean(comparisonProfileId && comparisonProfileId !== profileId);

  const { data, isLoading, isError, refetch } = useRules({
    profileId,
    agentId,
    page: onlyUnique ? 1 : page,
    page_size: onlyUnique ? COMPARISON_PAGE_SIZE : pageSize,
  });
  const items = (data?.items ?? []) as RuleRow[];
  const display =
    onlyUnique && cmpKeys ? items.filter((r) => !cmpKeys.has((r.text ?? '').trim())) : items;
  const detailItem = items.find((r) => r.id === detailId) ?? null;

  const createRule = useCreateRule();
  const updateRule = useUpdateRule();
  const deleteMutation = useDeleteRule();

  let body: ReactNode;
  if (isLoading) {
    body = (
      <div className="p-4 flex flex-col gap-2">
        {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  } else if (isError) {
    body = (
      <div className="p-7">
        <ErrorBanner title="Failed to load rules" onRetry={() => void refetch()} />
      </div>
    );
  } else if (display.length === 0) {
    body = (
      <div className="p-7">
        <EmptyState
          title={onlyUnique ? 'Nothing unique here' : emptyTitle}
          description={onlyUnique ? 'Every rule in this scope also exists in the Default profile.' : emptyDescription}
        />
      </div>
    );
  } else {
    body = (
      <RulesTable
        rows={display}
        role="org_admin"
        currentUserId=""
        loading={false}
        onOpen={(id) => setDetailId(id)}
        onDelete={(id, preview) => {
          const row = items.find((r) => r.id === id);
          setDeleteTarget({
            id,
            preview,
            profileId: row?.profile_id ?? undefined,
            agentId: row?.agent_id ?? undefined,
          });
        }}
        hideProfileAgentColumn
      />
    );
  }

  return (
    <div className="pb-2">
      {uniqueEnabled && comparisonProfileId ? (
        <RulesCmpProbe profileId={comparisonProfileId} onKeys={setCmpKeys} />
      ) : null}
      <PanelToolbar
        left={uniqueEnabled ? <UniqueToggle on={onlyUnique} onChange={setOnlyUnique} disabled={!cmpKeys} /> : undefined}
        right={
          createScope ? (
            <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
              <Icon as={Plus} size={13} />
              New rule
            </Button>
          ) : undefined
        }
      />
      {body}
      {!isLoading && !isError && !onlyUnique && items.length > 0 ? (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={data?.total ?? items.length}
          hasMore={data?.has_more ?? false}
          onPageChange={setPage}
          onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
        />
      ) : null}

      {detailItem && (
        <RCDetailDialog
          open={Boolean(detailItem)}
          onOpenChange={(open) => { if (!open) setDetailId(null); }}
          item={{
            id: detailItem.id,
            text: detailItem.text,
            status: (detailItem.status ?? 'published_active') as RCStatus,
            author_id: detailItem.author_id ?? '',
            profile_name: detailItem.profile_name,
            agent_name: detailItem.agent_name,
            created_at: detailItem.created_at,
            updated_at: detailItem.updated_at,
          }}
          kind="rule"
          role="org_admin"
          currentUserId=""
          onSave={async (text) => {
            await updateRule.mutateAsync({
              id: detailItem.id,
              text,
              profileId: detailItem.profile_id ?? undefined,
              agentId: detailItem.agent_id ?? undefined,
            });
          }}
          onDelete={() => {
            setDeleteTarget({
              id: detailItem.id,
              preview: previewOf(detailItem.text),
              profileId: detailItem.profile_id ?? undefined,
              agentId: detailItem.agent_id ?? undefined,
            });
          }}
        />
      )}

      {createScope && (
        <AdminCreateModal
          open={createOpen}
          onOpenChange={setCreateOpen}
          kind="rule"
          onSave={async (text) => {
            await createRule.mutateAsync({
              text,
              profileId: createScope.profileId,
              agentId: createScope.agentId,
            });
          }}
          extraFields={createScopeLabel ? <CreateScopeNote label={createScopeLabel} /> : undefined}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        variant="danger"
        title="Delete rule?"
        description={`Rule "${deleteTarget?.preview ?? ''}" will be deleted permanently. This action cannot be undone.`}
        confirmLabel={deleteMutation.isPending ? 'Deleting…' : 'Delete'}
        cancelLabel="Cancel"
        loading={deleteMutation.isPending}
        onConfirm={async () => {
          if (!deleteTarget) return;
          const { id, profileId: pId, agentId: aId } = deleteTarget;
          try {
            await deleteMutation.mutateAsync({ id, profileId: pId, agentId: aId });
            setDeleteTarget(null);
            if (detailId === id) setDetailId(null);
          } catch {
            /* toast handled in hook */
          }
        }}
      />
    </div>
  );
}
