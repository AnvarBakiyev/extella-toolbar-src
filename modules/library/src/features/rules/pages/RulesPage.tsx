/**
 * Rules page — main list view (standalone build).
 *
 * Trimmed from the admin-panel build:
 *   - Single "All" tab (no "My Drafts" tab; v0.6.11 has no publish-requests).
 *   - No approval queue / ApprovalBadge / approval route.
 *   - No PublishModal / similarity check / MyPublicationsHint.
 *   - Single user, no admin role and no approval flow.
 *   - Delete is a single-stage hard delete (Main Backend has no soft-delete).
 *
 * Visual fidelity matches the admin-panel RulesPage's "All" tab layout.
 */

import { useState, useMemo } from 'react';
import axios from 'axios';
import { Search, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/hooks/useAuth';
import { useDebounce } from '@/hooks/useDebounce';
import { Icon } from '@/lib/icon';
import { Button } from '@/components/ui/button';
import { Loader } from '@/components/ui/loader';
import { PageHeader } from '@/components/layout/PageHeader';
import { getToken } from '@/lib/runtime';
import { DEFAULT_PROFILE_ID, DEFAULT_AGENT_ID } from '@/lib/runtime';

import { AdminCreateModal } from '@/components/shared/AdminCreateModal';
import { SearchSpinner } from '@/components/shared/SearchSpinner';
import { RCDetailDialog } from '@/components/shared/RCDetailDialog';
import type { RCStatus } from '@/components/shared/RCStatusBadge';
import { ProfileAgentFilter, type ProfileAgentScope } from '@/components/shared/ProfileAgentFilter';
import { ProfileAgentSelector } from '@/components/shared/ProfileAgentSelector';

import { ConfirmDialog } from '@/components/layout/ConfirmDialog';

import { RulesTable, type RuleRow } from '../components/RulesTable';
import {
  useRules,
  useCreateRule,
  useUpdateRule,
  useDeleteRule,
} from '../hooks/useRules';

/* ─── helpers ───────────────────────────────────────────────────── */

function formatDiagnostic(err: unknown): string {
  const lines: string[] = [];
  lines.push(`X-Auth-Token: ${getToken() ? '(set)' : '(empty)'}`);

  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const statusText = err.response?.statusText;
    const url = err.config?.baseURL
      ? `${err.config.baseURL}${err.config?.url ?? ''}`
      : (err.config?.url ?? '(unknown url)');
    const method = (err.config?.method ?? 'GET').toUpperCase();
    lines.push(`Request: ${method} ${url}`);
    lines.push(`Status:  ${status ?? '(no response)'} ${statusText ?? ''}`.trim());

    const data = err.response?.data;
    if (data !== undefined) {
      const body =
        typeof data === 'string' ? data : (() => {
          try { return JSON.stringify(data, null, 2); }
          catch { return String(data); }
        })();
      lines.push('Response body:');
      lines.push(body);
    } else {
      lines.push(`Error message: ${err.message}`);
    }
  } else if (err instanceof Error) {
    lines.push(`Error: ${err.name}: ${err.message}`);
    if (err.stack) lines.push(err.stack);
  } else {
    lines.push(`Error: ${String(err)}`);
  }

  return lines.join('\n');
}


/* ─── page ──────────────────────────────────────────────────────── */

export function RulesPage() {
  const { t } = useTranslation('rules');

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
  // Delete confirmation state — single-stage hard delete.
  const [deleteTarget, setDeleteTarget] = useState<
    { id: string; preview: string; profileId?: string; agentId?: string } | null
  >(null);

  const debouncedQ = useDebounce(q, 500);

  /* queries */
  const rulesQuery = useRules({
    q: debouncedQ || undefined,
    page,
    page_size: 25,
    profileId: scope.profileId,
    agentId: scope.agentId,
  });

  /* mutations */
  const createRule = useCreateRule();
  const updateRule = useUpdateRule();
  const deleteMutation = useDeleteRule();

  // Search in progress: from first keystroke (debounce) through the fetch.
  const searching =
    (q.trim() !== '' && q !== debouncedQ) ||
    (debouncedQ.trim() !== '' && rulesQuery.isFetching);

  /* derive rows */
  const allRows: RuleRow[] = useMemo(() => {
    const items = rulesQuery.data?.items ?? [];
    return items.map((r) => ({
      ...r,
      status: r.is_active ? 'published_active' : 'published_inactive',
    }));
  }, [rulesQuery.data?.items]);

  /* detail item */
  const detailItem = detailId ? allRows.find((r) => r.id === detailId) : null;

  /* totals */
  const total = rulesQuery.data?.total ?? 0;

  /* action handlers */
  async function handleAdminCreate(text: string) {
    await createRule.mutateAsync({
      text,
      profileId: createScope.profileId,
      agentId: createScope.agentId,
    });
  }

  async function handleSaveEdit(text: string) {
    if (!detailId) return;
    await updateRule.mutateAsync({
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
        subtitle={`${total} published rules`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowAdminCreate(true)}
            >
              <Icon as={Plus} size={14} />
              {t('actions.newRule')}
            </Button>
          </div>
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
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            style={{ fontSize: 13 }}
          />
          <SearchSpinner busy={searching} />
        </div>
        <ProfileAgentFilter
          value={scope}
          onChange={(s) => { setScope(s); setPage(1); }}
        />
        {!rulesQuery.isLoading && (
          <span className="ml-auto" style={{ fontSize: 12, color: 'var(--ap-text-muted)' }}>
            {allRows.length} of {total}
          </span>
        )}
      </div>

      {/* content area */}
      <div className="overflow-auto flex-1 min-h-0">
        {rulesQuery.isLoading ? (
          <Loader label={t('list.loading', 'Loading…')} />
        ) : rulesQuery.isError ? (
          <div className="p-6 text-left mx-auto" style={{ color: 'var(--ap-danger)', fontSize: 13, maxWidth: 720 }}>
            <div className="text-center mb-3">
              Failed to load rules.{' '}
              <button className="underline" onClick={() => void rulesQuery.refetch()}>Retry</button>
            </div>
            <pre
              className="whitespace-pre-wrap break-all text-left"
              style={{
                background: 'var(--ap-surface-2, #1c1c1c)',
                color: 'var(--ap-text, #ddd)',
                padding: 12,
                borderRadius: 6,
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              {formatDiagnostic(rulesQuery.error)}
            </pre>
          </div>
        ) : allRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3" style={{ color: 'var(--ap-text-faint)' }}>
            <div style={{ fontSize: 40 }}>📋</div>
            <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--ap-text)' }}>
              {q ? 'No rules match your search' : 'No rules yet'}
            </div>
            <div style={{ fontSize: 13 }}>
              {q ? 'Try a different query.' : 'Create the first rule using the button above.'}
            </div>
          </div>
        ) : (
          <RulesTable
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
      {!rulesQuery.isLoading && total > 25 && (
        <div
          className="flex items-center justify-between shrink-0"
          style={{ padding: '10px 28px', borderTop: '1px solid var(--ap-divider)' }}
        >
          <span style={{ fontSize: 12, color: 'var(--ap-text-muted)' }}>
            Page {page} · {total} total
          </span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button variant="secondary" size="sm" disabled={!rulesQuery.data?.has_more} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      {/* detail modal */}
      {detailItem && (
        <RCDetailDialog
          open={Boolean(detailItem)}
          onOpenChange={(open) => { if (!open) setDetailId(null); }}
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
          kind="rule"
          role={role}
          currentUserId={currentUserId}
          onSave={handleSaveEdit}
          onDelete={() => {
            if (!detailItem) return;
            setDeleteTarget({
              id: detailItem.id,
              preview: detailItem.text.split('\n')[0].slice(0, 60),
              profileId: detailItem.profile_id ?? undefined,
              agentId: detailItem.agent_id ?? undefined,
            });
          }}
        />
      )}

      {/* admin create modal */}
      <AdminCreateModal
        open={showAdminCreate}
        onOpenChange={setShowAdminCreate}
        kind="rule"
        onSave={handleAdminCreate}
        extraFields={
          <ProfileAgentSelector
            value={createScope}
            onChange={setCreateScope}
          />
        }
      />

      {/* delete confirmation — hard delete (no trash for rules upstream) */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        variant="danger"
        title={t('delete.title', 'Delete rule?')}
        description={t('delete.description', {
          preview: deleteTarget?.preview ?? '',
          defaultValue:
            'Rule "{{preview}}" will be deleted permanently. This action cannot be undone.',
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

export default RulesPage;
