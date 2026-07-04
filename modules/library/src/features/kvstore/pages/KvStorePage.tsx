/**
 * KV Store page — main list view (standalone build).
 *
 * Mirrors ConceptsPage in structure:
 *   - Page header + "New entry" button.
 *   - Debounced search toolbar.
 *   - KvTable with Loading / Empty / Error states.
 *   - Client-side pagination (server returns full list).
 *   - KvCreateDialog: key (required), value (required textarea), description (optional).
 *   - KvEditDialog: key read-only, edit value + description.
 *   - ConfirmDialog danger for hard delete.
 *
 * No publish flow — KV is plain CRUD.
 */

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Search, Plus, X, Check, Database } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useDebounce } from '@/hooks/useDebounce';
import { Icon } from '@/lib/icon';
import { DEFAULT_PROFILE_ID, DEFAULT_AGENT_ID } from '@/lib/runtime';
import { ProfileAgentFilter, type ProfileAgentScope } from '@/components/shared/ProfileAgentFilter';
import { ProfileAgentSelector } from '@/components/shared/ProfileAgentSelector';
import { ProfileAgentBadge } from '@/components/shared/ProfileAgentBadge';

import { Button } from '@/components/ui/button';
import { Loader } from '@/components/ui/loader';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/layout/PageHeader';
import { ConfirmDialog } from '@/components/layout/ConfirmDialog';
import { SearchSpinner } from '@/components/shared/SearchSpinner';

import { KvTable } from '../components/KvTable';
import { useKvList, useSetKv, useRemoveKv } from '../hooks/useKv';
import {
  CreateKvBodySchema,
  UpdateKvBodySchema,
  type CreateKvBody,
  type UpdateKvBody,
  type KvEntry,
} from '../schemas';

/* ─── helpers ───────────────────────────────────────────────────── */


/* ─── field-level input primitives ────────────────────────────── */

interface FieldProps {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}

function Field({ id: _id, label, required, error, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={_id}
        className="text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: 'var(--ap-text-faint)' }}
      >
        {label}
        {required && (
          <span style={{ color: 'var(--ap-danger)', marginLeft: 2 }}>*</span>
        )}
      </label>
      {children}
      {error && (
        <p className="text-[12px]" style={{ color: 'var(--ap-danger)' }}>
          {error}
        </p>
      )}
    </div>
  );
}

const inputClass =
  'w-full rounded-md border border-border bg-bgCard px-2.5 py-1.5 text-sm outline-none placeholder:text-textFaint focus:border-accent focus:ring-1 focus:ring-accentSoftStrong';

const errorInputClass =
  'w-full rounded-md border px-2.5 py-1.5 text-sm outline-none placeholder:text-textFaint focus:ring-1 focus:ring-accentSoftStrong border-danger focus:border-danger focus:ring-dangerSoft bg-bgCard';

/* ─── KvCreateDialog ────────────────────────────────────────────── */

interface KvCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: CreateKvBody) => Promise<void>;
  /** Extra content rendered above the form fields (e.g. Profile/Agent selector). */
  extraContent?: React.ReactNode;
}

function KvCreateDialog({ open, onOpenChange, onSave, extraContent }: KvCreateDialogProps) {
  const { t } = useTranslation('kvstore');
  const { t: tCommon } = useTranslation('common');

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateKvBody>({
    resolver: zodResolver(CreateKvBodySchema),
    mode: 'onBlur',
  });

  function handleOpenChange(next: boolean) {
    if (isSubmitting) return;
    if (!next) reset();
    onOpenChange(next);
  }

  async function onSubmit(data: CreateKvBody) {
    await onSave(data);
    reset();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={[
          'flex flex-col overflow-hidden p-0 gap-0',
          'w-[92vw] max-w-[600px]',
          '[&>button:last-of-type]:hidden',
        ].join(' ')}
      >
        <DialogTitle className="sr-only">
          {t('create.title', 'New KV entry')}
        </DialogTitle>

        {/* header */}
        <div
          className="flex items-center justify-between shrink-0"
          style={{ padding: '14px 20px', borderBottom: '1px solid var(--ap-divider)' }}
        >
          <div className="flex items-center gap-2.5">
            <Icon
              as={Database}
              size={20}
              style={{ color: 'var(--ap-accent)' }}
            />
            <span className="font-semibold" style={{ fontSize: 16 }}>
              {t('create.title', 'New KV entry')}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => handleOpenChange(false)}
            aria-label="Close"
            disabled={isSubmitting}
          >
            <Icon as={X} size={14} />
          </Button>
        </div>

        {/* body */}
        <form
          id="kv-create-form"
          onSubmit={handleSubmit(onSubmit)}
          className="overflow-auto flex-1 min-h-0"
        >
          <div className="flex flex-col gap-4" style={{ padding: '16px 20px' }}>
            {extraContent ? <div>{extraContent}</div> : null}
            <Field
              id="kv-create-key"
              label={t('fields.key', 'Key')}
              required
              error={errors.key?.message}
            >
              <input
                id="kv-create-key"
                autoFocus
                className={errors.key ? errorInputClass : inputClass}
                placeholder={t('fields.keyPlaceholder', 'e.g. app.timeout')}
                {...register('key')}
              />
            </Field>

            <Field
              id="kv-create-value"
              label={t('fields.value', 'Value')}
              required
              error={errors.value?.message}
            >
              <textarea
                id="kv-create-value"
                rows={5}
                className={errors.value ? errorInputClass : inputClass}
                placeholder={t('fields.valuePlaceholder', 'Enter value…')}
                style={{ resize: 'vertical', minHeight: 80 }}
                {...register('value')}
              />
            </Field>

            <Field
              id="kv-create-description"
              label={t('fields.description', 'Description')}
              error={errors.description?.message}
            >
              <input
                id="kv-create-description"
                className={errors.description ? errorInputClass : inputClass}
                placeholder={t(
                  'fields.descriptionPlaceholder',
                  'Optional — brief note about this entry',
                )}
                {...register('description')}
              />
            </Field>
          </div>
        </form>

        {/* footer */}
        <div
          className="flex items-center justify-between shrink-0"
          style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--ap-divider)',
            background: 'var(--ap-bg-inset)',
          }}
        >
          <span style={{ fontSize: 11, color: 'var(--ap-text-faint)' }}>
            {t('create.directNote', 'Saved immediately to the KV store.')}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleOpenChange(false)}
              disabled={isSubmitting}
            >
              {tCommon('actions.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="submit"
              form="kv-create-form"
              disabled={isSubmitting}
            >
              <Icon as={Check} size={13} />
              {isSubmitting
                ? t('create.saving', 'Saving…')
                : t('create.save', 'Save')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── KvEditDialog ──────────────────────────────────────────────── */

interface KvEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: KvEntry | null;
  onSave: (key: string, data: UpdateKvBody) => Promise<void>;
}

function KvEditDialog({ open, onOpenChange, entry, onSave }: KvEditDialogProps) {
  const { t } = useTranslation('kvstore');
  const { t: tCommon } = useTranslation('common');

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<UpdateKvBody>({
    resolver: zodResolver(UpdateKvBodySchema),
    mode: 'onBlur',
    values: entry
      ? { value: entry.value, description: entry.description }
      : undefined,
  });

  function handleOpenChange(next: boolean) {
    if (isSubmitting) return;
    if (!next) reset();
    onOpenChange(next);
  }

  async function onSubmit(data: UpdateKvBody) {
    if (!entry) return;
    await onSave(entry.key, data);
    onOpenChange(false);
  }

  if (!entry) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={[
          'flex flex-col overflow-hidden p-0 gap-0',
          'w-[92vw] max-w-[600px]',
          '[&>button:last-of-type]:hidden',
        ].join(' ')}
      >
        <DialogTitle className="sr-only">
          {t('edit.title', 'Edit KV entry')}
        </DialogTitle>

        {/* header */}
        <div
          className="flex items-center justify-between shrink-0"
          style={{ padding: '14px 20px', borderBottom: '1px solid var(--ap-divider)' }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Icon
              as={Database}
              size={20}
              style={{ color: 'var(--ap-accent)' }}
            />
            <span
              className="font-mono font-semibold truncate"
              style={{ fontSize: 16, maxWidth: 300 }}
              title={entry.key}
            >
              {entry.key}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => handleOpenChange(false)}
            aria-label="Close"
            disabled={isSubmitting}
          >
            <Icon as={X} size={14} />
          </Button>
        </div>

        {/* read-only key notice */}
        <div
          style={{
            padding: '8px 20px',
            background: 'var(--ap-bg-inset)',
            borderBottom: '1px solid var(--ap-divider)',
            fontSize: 12,
            color: 'var(--ap-text-muted)',
          }}
        >
          {t('edit.keyReadOnly', 'Key is read-only — it serves as the identity.')}
        </div>

        {/* body */}
        <form
          id="kv-edit-form"
          onSubmit={handleSubmit(onSubmit)}
          className="overflow-auto flex-1 min-h-0"
        >
          <div className="flex flex-col gap-4" style={{ padding: '16px 20px' }}>
            <Field
              id="kv-edit-value"
              label={t('fields.value', 'Value')}
              required
              error={errors.value?.message}
            >
              <textarea
                id="kv-edit-value"
                autoFocus
                rows={5}
                className={errors.value ? errorInputClass : inputClass}
                placeholder={t('fields.valuePlaceholder', 'Enter value…')}
                style={{ resize: 'vertical', minHeight: 80 }}
                {...register('value')}
              />
            </Field>

            <Field
              id="kv-edit-description"
              label={t('fields.description', 'Description')}
              error={errors.description?.message}
            >
              <input
                id="kv-edit-description"
                className={errors.description ? errorInputClass : inputClass}
                placeholder={t(
                  'fields.descriptionPlaceholder',
                  'Optional — brief note about this entry',
                )}
                {...register('description')}
              />
            </Field>
          </div>
        </form>

        {/* footer */}
        <div
          className="flex items-center justify-end gap-2 shrink-0"
          style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--ap-divider)',
            background: 'var(--ap-bg-inset)',
          }}
        >
          <Button
            variant="secondary"
            size="sm"
            onClick={() => handleOpenChange(false)}
            disabled={isSubmitting}
          >
            {tCommon('actions.cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            form="kv-edit-form"
            disabled={isSubmitting}
          >
            <Icon as={Check} size={13} />
            {isSubmitting
              ? t('edit.saving', 'Saving…')
              : tCommon('actions.save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── page ──────────────────────────────────────────────────────── */

export function KvStorePage() {
  const { t } = useTranslation('kvstore');

  /* UI state */
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [scope, setScope] = useState<ProfileAgentScope>({});
  const [showCreate, setShowCreate] = useState(false);
  const [createScope, setCreateScope] = useState<ProfileAgentScope>({
    profileId: DEFAULT_PROFILE_ID,
    agentId: DEFAULT_AGENT_ID,
  });
  const [editEntry, setEditEntry] = useState<KvEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ key: string; profileId?: string; agentId?: string } | null>(null);

  const debouncedQ = useDebounce(q, 500);

  /* queries + mutations */
  const kvQuery = useKvList({
    q: debouncedQ || undefined,
    page,
    page_size: 25,
    profileId: scope.profileId,
    agentId: scope.agentId,
  });
  const setKvMutation = useSetKv();
  const removeMutation = useRemoveKv();

  // Semantic search in progress: from first keystroke (debounce) through fetch.
  const searching =
    (q.trim() !== '' && q !== debouncedQ) ||
    (debouncedQ.trim() !== '' && kvQuery.isFetching);

  const rows = kvQuery.data?.items ?? [];
  const total = kvQuery.data?.total ?? 0;

  /* handlers */
  async function handleCreate(data: CreateKvBody) {
    await setKvMutation.mutateAsync({
      key: data.key,
      value: data.value,
      description: data.description,
      profileId: createScope.profileId,
      agentId: createScope.agentId,
    });
  }

  async function handleEdit(key: string, data: UpdateKvBody) {
    await setKvMutation.mutateAsync({
      key,
      value: data.value,
      description: data.description,
      profileId: editEntry?.profile_id ?? undefined,
      agentId: editEntry?.agent_id ?? undefined,
    });
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* page header */}
      <PageHeader
        title={t('title', 'KV Store')}
        subtitle={`Workspace key-value store · ${total} ${total === 1 ? 'entry' : 'entries'}`}
        actions={
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowCreate(true)}
          >
            <Icon as={Plus} size={14} />
            {t('actions.newEntry', 'New KV')}
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
          <Icon
            as={Search}
            size={14}
            style={{ color: 'var(--ap-text-faint)' }}
          />
          <input
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-textFaint"
            placeholder={t('toolbar.searchPlaceholder', 'Search key, value, description')}
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
        {!kvQuery.isLoading && (
          <span
            className="ml-auto"
            style={{ fontSize: 12, color: 'var(--ap-text-muted)' }}
          >
            {rows.length} of {total}
          </span>
        )}
      </div>

      {/* content area */}
      <div className="overflow-auto flex-1 min-h-0">
        {kvQuery.isLoading ? (
          <Loader label={t('list.loading', 'Loading…')} />
        ) : kvQuery.isError ? (
          <div
            className="p-6 text-center"
            style={{ color: 'var(--ap-danger)', fontSize: 13 }}
          >
            {t('error.load', 'Failed to load KV store.')}{' '}
            <button
              className="underline"
              onClick={() => void kvQuery.refetch()}
            >
              {t('error.retry', 'Retry')}
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-20 gap-3"
            style={{ color: 'var(--ap-text-faint)' }}
          >
            <div style={{ fontSize: 40 }}>🗄️</div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 500,
                color: 'var(--ap-text)',
              }}
            >
              {q
                ? t('empty.search', 'No entries match your search')
                : t('empty.blank', 'No KV entries yet')}
            </div>
            <div style={{ fontSize: 13 }}>
              {q
                ? t('empty.searchHint', 'Try a different query.')
                : t(
                    'empty.blankHint',
                    'Create the first entry using the button above.',
                  )}
            </div>
          </div>
        ) : (
          <KvTable
            rows={rows}
            onOpen={(key) => {
              const entry = rows.find((r) => r.key === key);
              if (entry) setEditEntry(entry);
            }}
            onEdit={(entry) => setEditEntry(entry)}
            onDelete={(key) => {
              const row = rows.find((r) => r.key === key);
              setDeleteTarget({
                key,
                profileId: row?.profile_id ?? undefined,
                agentId: row?.agent_id ?? undefined,
              });
            }}
          />
        )}
      </div>

      {/* pagination */}
      {!kvQuery.isLoading && total > 25 && (
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
              disabled={!kvQuery.data?.has_more}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* create dialog */}
      <KvCreateDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onSave={handleCreate}
        extraContent={
          <ProfileAgentSelector
            value={createScope}
            onChange={setCreateScope}
          />
        }
      />

      {/* edit dialog */}
      <KvEditDialog
        open={Boolean(editEntry)}
        onOpenChange={(open) => {
          if (!open) setEditEntry(null);
        }}
        entry={editEntry}
        onSave={handleEdit}
      />

      {/* delete confirmation */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        variant="danger"
        title={t('delete.title', 'Delete entry?')}
        description={t('delete.description', {
          key: deleteTarget?.key ?? '',
          defaultValue:
            'Entry "{{key}}" will be deleted permanently. This action cannot be undone.',
        })}
        confirmLabel={
          removeMutation.isPending
            ? t('delete.deleting', 'Deleting…')
            : t('delete.confirm', 'Delete')
        }
        cancelLabel={t('delete.cancel', 'Cancel')}
        loading={removeMutation.isPending}
        onConfirm={async () => {
          if (!deleteTarget) return;
          const { key, profileId, agentId } = deleteTarget;
          try {
            await removeMutation.mutateAsync({ key, profileId, agentId });
            setDeleteTarget(null);
            // If editing that entry, close the edit dialog too
            if (editEntry?.key === key) setEditEntry(null);
          } catch {
            /* toast handled in hook */
          }
        }}
      />
    </div>
  );
}

export default KvStorePage;
