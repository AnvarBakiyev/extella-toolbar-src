/**
 * Concepts page — main list view (standalone build).
 *
 * Trimmed from the source `apps/frontend` page:
 *   - No "My Drafts" tab — single "All" view only.
 *   - No publication-request flow (no `PublishModal`, no `ApprovalBadge`,
 *     no `MyPublicationsHint`, no draft-mode CTA).
 *   - Single user, no admin role and no approval flow.
 *
 * Kept:
 *   - Page header + subtitle + "Create manually" button.
 *   - Search toolbar (debounced) + pagination.
 *   - `ConceptsTable` row click → `RCDetailDialog` for view/edit.
 *   - `AdminCreateModal` for direct creation (no approval).
 *   - `ConfirmDialog` for single-stage hard delete (no trash in v0.8.0).
 */

import { useMemo, useState } from 'react';
import { Search, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_PROFILE_ID, DEFAULT_AGENT_ID } from '@/lib/runtime';
import { ProfileAgentFilter, type ProfileAgentScope } from '@/components/shared/ProfileAgentFilter';
import { ProfileAgentBadge } from '@/components/shared/ProfileAgentBadge';
import { ProfileAgentSelector } from '@/components/shared/ProfileAgentSelector';

import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { useDebounce } from '@/hooks/useDebounce';
import { Icon } from '@/lib/icon';
import type { AppLocale } from '@/lib/format';

import { Button } from '@/components/ui/button';
import { Loader } from '@/components/ui/loader';
import { PageHeader } from '@/components/layout/PageHeader';
import { ConfirmDialog } from '@/components/layout/ConfirmDialog';

import { AdminCreateModal } from '@/components/shared/AdminCreateModal';
import { SearchSpinner } from '@/components/shared/SearchSpinner';
import { RCDetailDialog } from '@/components/shared/RCDetailDialog';
import type { RCStatus } from '@/components/shared/RCStatusBadge';

import { ConceptsTable, type ConceptRow } from '../components/ConceptsTable';
import {
  useConcepts,
  useCreateConcept,
  useDeleteConcept,
  useUpdateConcept,
} from '../hooks/useConcepts';

/* ─── helpers ───────────────────────────────────────────────────── */

/* ─── page ──────────────────────────────────────────────────────── */

export function ConceptsPage() {
  const { t, i18n } = useTranslation('concepts');
  // AppLocale narrowing — i18n.language is only ever 'en' in the standalone
  // build today; cast keeps formatDate happy without spreading `any`.
  const locale = (i18n.language ?? 'en') as AppLocale;

  const { role } = usePermissions();
  const { user } = useAuth();

  const currentUserId = user?.id ?? '';

  /* UI state */
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [scope, setScope] = useState<ProfileAgentScope>({});
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showAdminCreate, setShowAdminCreate] = useState(false);
  const [createScope, setCreateScope] = useState<ProfileAgentScope>({
    profileId: DEFAULT_PROFILE_ID,
    agentId: DEFAULT_AGENT_ID,
  });
  // Single-stage hard delete — Main Backend v0.8.0 has no trash for concepts.
  const [deleteTarget, setDeleteTarget] = useState<
    { id: string; preview: string; profileId?: string; agentId?: string } | null
  >(null);

  const debouncedQ = useDebounce(q, 500);

  /* queries + mutations */
  const conceptsQuery = useConcepts({
    q: debouncedQ || undefined,
    page,
    page_size: 25,
    profileId: scope.profileId,
    agentId: scope.agentId,
  });
  const createConcept = useCreateConcept();
  const updateConcept = useUpdateConcept();
  const deleteMutation = useDeleteConcept();

  // Semantic search in progress: from first keystroke (debounce) through the
  // network round-trip, only while there's a query term.
  const searching =
    (q.trim() !== '' && q !== debouncedQ) ||
    (debouncedQ.trim() !== '' && conceptsQuery.isFetching);

  /* derive rows */
  const allRows: ConceptRow[] = useMemo(() => {
    const items = conceptsQuery.data?.items ?? [];
    return items.map((c) => ({
      ...c,
      status: c.is_active ? 'published_active' : 'published_inactive',
    }));
  }, [conceptsQuery.data?.items]);

  const detailItem = detailId
    ? allRows.find((c) => c.id === detailId) ?? null
    : null;

  const total = conceptsQuery.data?.total ?? 0;

  /* action handlers */
  async function handleAdminCreate(text: string) {
    await createConcept.mutateAsync({
      text,
      profileId: createScope.profileId,
      agentId: createScope.agentId,
    });
  }

  async function handleSaveEdit(text: string) {
    if (!detailId) return;
    await updateConcept.mutateAsync({
      id: detailId,
      text,
      profileId: detailItem?.profile_id ?? undefined,
      agentId: detailItem?.agent_id ?? undefined,
    });
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* page header */}
      <PageHeader
        title={t('title')}
        subtitle={`Workspace knowledge base · ${total} concepts`}
        actions={
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowAdminCreate(true)}
          >
            <Icon as={Plus} size={14} />
            {t('actions.newConcept')}
          </Button>
        }
      />

      {/* toolbar */}
      <div
        className="flex items-center gap-2 shrink-0 flex-wrap"
        style={{ padding: '12px 28px', borderBottom: '1px solid var(--ap-divider)' }}
      >
        <div
          className="flex items-center gap-1.5 rounded-md border border-border bg-bgCard px-2.5"
          style={{ height: 30, maxWidth: 320 }}
        >
          <Icon as={Search} size={14} style={{ color: 'var(--ap-text-faint)' }} />
          <input
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-textFaint"
            placeholder={t('toolbar.searchPlaceholder')}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            style={{ fontSize: 13 }}
          />
          <SearchSpinner busy={searching} />
        </div>
        <ProfileAgentFilter
          value={scope}
          onChange={(s) => { setScope(s); setPage(1); }}
        />
        {!conceptsQuery.isLoading && (
          <span
            className="ml-auto"
            style={{ fontSize: 12, color: 'var(--ap-text-muted)' }}
          >
            {allRows.length} of {total}
          </span>
        )}
      </div>

      {/* content area */}
      <div className="overflow-auto flex-1 min-h-0">
        {conceptsQuery.isLoading ? (
          <Loader label={t('list.loading', 'Loading…')} />
        ) : conceptsQuery.isError ? (
          <div
            className="p-6 text-center"
            style={{ color: 'var(--ap-danger)', fontSize: 13 }}
          >
            Failed to load concepts.{' '}
            <button
              className="underline"
              onClick={() => void conceptsQuery.refetch()}
            >
              Retry
            </button>
          </div>
        ) : allRows.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-20 gap-3"
            style={{ color: 'var(--ap-text-faint)' }}
          >
            <div style={{ fontSize: 40 }}>📚</div>
            <div
              style={{ fontSize: 16, fontWeight: 500, color: 'var(--ap-text)' }}
            >
              {q ? 'No concepts match your search' : 'No concepts yet'}
            </div>
            <div style={{ fontSize: 13 }}>
              {q
                ? 'Try a different query.'
                : 'Create the first concept using the button above.'}
            </div>
          </div>
        ) : (
          <ConceptsTable
            rows={allRows}
            role={role}
            currentUserId={currentUserId}
            onOpen={(id) => setDetailId(id)}
            onDelete={(id, preview) => {
              const row = allRows.find((r) => r.id === id);
              setDeleteTarget({
                id,
                preview,
                profileId: row?.profile_id ?? undefined,
                agentId: row?.agent_id ?? undefined,
              });
            }}
          />
        )}
      </div>

      {/* pagination */}
      {!conceptsQuery.isLoading && total > 25 && (
        <div
          className="flex items-center justify-between shrink-0"
          style={{
            padding: '10px 28px',
            borderTop: '1px solid var(--ap-divider)',
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--ap-text-muted)' }}>
            Page {page} · {total} total
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!conceptsQuery.data?.has_more}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* detail modal */}
      {detailItem && (
        <RCDetailDialog
          open={Boolean(detailItem)}
          onOpenChange={(open) => {
            if (!open) setDetailId(null);
          }}
          item={{
            id: detailItem.id,
            text: detailItem.text,
            status: (detailItem.status ?? 'published_active') as RCStatus,
            author_id: detailItem.author_id ?? currentUserId,
            profile_name: detailItem.profile_name,
            agent_name: detailItem.agent_name,
            created_at: detailItem.created_at,
            updated_at: detailItem.updated_at,
          }}
          kind="concept"
          role={role}
          currentUserId={currentUserId}
          onSave={handleSaveEdit}
          onDelete={() => {
            if (!detailItem) return;
            setDeleteTarget({
              id: detailItem.id,
              preview: detailItem.text.split('\n')[0].slice(0, 60),
            });
          }}
        />
      )}

      {/* admin create modal */}
      <AdminCreateModal
        open={showAdminCreate}
        onOpenChange={setShowAdminCreate}
        kind="concept"
        onSave={handleAdminCreate}
        extraFields={
          <ProfileAgentSelector
            value={createScope}
            onChange={setCreateScope}
          />
        }
      />

      {/* delete confirmation — hard delete (no trash for concepts upstream) */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        variant="danger"
        title={t('delete.title', 'Delete concept?')}
        description={t('delete.description', {
          preview: deleteTarget?.preview ?? '',
          defaultValue:
            'Concept "{{preview}}" will be deleted permanently. This action cannot be undone.',
        })}
        confirmLabel={
          deleteMutation.isPending
            ? t('delete.deleting', 'Deleting…')
            : t('delete.confirm', 'Delete')
        }
        cancelLabel={t('delete.cancel', 'Cancel')}
        loading={deleteMutation.isPending}
        onConfirm={async () => {
          if (!deleteTarget) return;
          const { id: targetId, profileId, agentId } = deleteTarget;
          try {
            await deleteMutation.mutateAsync({ id: targetId, profileId, agentId });
            setDeleteTarget(null);
            if (detailId === targetId) setDetailId(null);
          } catch {
            /* toast handled in hook */
          }
        }}
      />
    </div>
  );
}

export default ConceptsPage;
