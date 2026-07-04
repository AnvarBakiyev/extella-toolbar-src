/**
 * Tokens page — list + generate + revoke (standalone build).
 *
 * Mirrors KvStorePage in structure:
 *   - Page header + "Generate token" button.
 *   - Debounced search toolbar (by name).
 *   - TokensTable with Loading / Empty / Error states.
 *   - Client-side pagination (server returns full list).
 *   - GenerateDialog: optional name input → on success reveal the full token
 *     once with a Copy button + "store it now" note.
 *   - ConfirmDialog danger for revoke.
 *
 * No edit — tokens are immutable (generate new, revoke old).
 */

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Search, KeyRound, Copy, Check, X, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useDebounce } from '@/hooks/useDebounce';
import { Icon } from '@/lib/icon';
import { DEFAULT_PROFILE_ID, DEFAULT_AGENT_ID } from '@/lib/runtime';

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
import { ProfileAgentFilter, type ProfileAgentScope } from '@/components/shared/ProfileAgentFilter';
import { ProfileAgentSelector } from '@/components/shared/ProfileAgentSelector';

import { TokensTable } from '../components/TokensTable';
import { useTokensList, useGenerateToken, useRevokeToken } from '../hooks/useTokens';
import {
  GenerateTokenBodySchema,
  type GenerateTokenBody,
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

/* ─── TokenRevealBox ────────────────────────────────────────────── */

interface TokenRevealBoxProps {
  token: string;
}

function TokenRevealBox({ token }: TokenRevealBoxProps) {
  const { t } = useTranslation('tokens');
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(token);
      } else {
        const el = document.createElement('textarea');
        el.value = token;
        el.style.position = 'fixed';
        el.style.opacity = '0';
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      }
      setCopied(true);
      toast.success(t('actions.copied', 'Token copied to clipboard'));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('actions.copyFailed', 'Failed to copy token'));
    }
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-md p-3"
      style={{
        background: 'var(--ap-bg-inset)',
        border: '1px solid var(--ap-divider)',
      }}
    >
      <div
        className="font-mono break-all select-all"
        style={{
          fontSize: 13,
          color: 'var(--ap-text)',
          lineHeight: 1.5,
          userSelect: 'all',
        }}
        role="textbox"
        aria-readonly="true"
        aria-label={t('reveal.tokenLabel', 'Your new token')}
      >
        {token}
      </div>
      <div className="flex items-center justify-between">
        <span style={{ fontSize: 11, color: 'var(--ap-danger)', fontWeight: 500 }}>
          {t('reveal.storeNote', 'Store it now — this token will not be shown again.')}
        </span>
        <Button
          variant={copied ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => void handleCopy()}
        >
          <Icon as={copied ? Check : Copy} size={13} />
          {copied ? t('reveal.copied', 'Copied!') : t('reveal.copy', 'Copy')}
        </Button>
      </div>
    </div>
  );
}

/* ─── GenerateDialog ────────────────────────────────────────────── */

interface GenerateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate: (data: GenerateTokenBody, scope: ProfileAgentScope) => Promise<string>;
}

const DEFAULT_SCOPE: ProfileAgentScope = {
  profileId: DEFAULT_PROFILE_ID,
  agentId: DEFAULT_AGENT_ID,
};

function GenerateDialog({ open, onOpenChange, onGenerate }: GenerateDialogProps) {
  const { t } = useTranslation('tokens');
  const { t: tCommon } = useTranslation('common');

  const [newToken, setNewToken] = useState<string | null>(null);
  const [scope, setScope] = useState<ProfileAgentScope>(DEFAULT_SCOPE);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<GenerateTokenBody>({
    resolver: zodResolver(GenerateTokenBodySchema),
    mode: 'onBlur',
  });

  function handleOpenChange(next: boolean) {
    if (isSubmitting) return;
    if (!next) {
      reset();
      setScope(DEFAULT_SCOPE);
      setNewToken(null);
    }
    onOpenChange(next);
  }

  async function onSubmit(data: GenerateTokenBody) {
    const token = await onGenerate(data, scope);
    setNewToken(token);
    reset();
  }

  const isRevealing = newToken !== null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={[
          'flex flex-col overflow-hidden p-0 gap-0',
          'w-[92vw] max-w-[560px]',
          '[&>button:last-of-type]:hidden',
        ].join(' ')}
      >
        <DialogTitle className="sr-only">
          {t('generate.title', 'Generate token')}
        </DialogTitle>

        {/* header */}
        <div
          className="flex items-center justify-between shrink-0"
          style={{ padding: '14px 20px', borderBottom: '1px solid var(--ap-divider)' }}
        >
          <div className="flex items-center gap-2.5">
            <Icon
              as={KeyRound}
              size={20}
              style={{ color: 'var(--ap-accent)' }}
            />
            <span className="font-semibold" style={{ fontSize: 16 }}>
              {isRevealing
                ? t('generate.titleReveal', 'Your new token')
                : t('generate.title', 'Generate token')}
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
        {isRevealing ? (
          /* reveal state — show the full token once */
          <div className="flex flex-col gap-4 overflow-auto flex-1 min-h-0" style={{ padding: '16px 20px' }}>
            <p style={{ fontSize: 13, color: 'var(--ap-text-muted)' }}>
              {t('generate.revealDescription', 'Your API token has been generated. Copy it now — it will not be shown again.')}
            </p>
            <TokenRevealBox token={newToken} />
          </div>
        ) : (
          /* generate form */
          <form
            id="token-generate-form"
            onSubmit={handleSubmit(onSubmit)}
            className="overflow-auto flex-1 min-h-0"
          >
            <div className="flex flex-col gap-4" style={{ padding: '16px 20px' }}>
              <Field
                id="token-generate-name"
                label={t('fields.name', 'Name')}
                error={errors.name?.message}
              >
                <input
                  id="token-generate-name"
                  autoFocus
                  className={inputClass}
                  placeholder={t('fields.namePlaceholder', 'e.g. my-script, ci-runner (optional)')}
                  {...register('name')}
                />
              </Field>
              <p style={{ fontSize: 12, color: 'var(--ap-text-muted)' }}>
                {t('generate.nameHint', 'A descriptive name helps you identify this token later.')}
              </p>
              <ProfileAgentSelector
                value={scope}
                onChange={setScope}
                profileLabel={t('fields.profile', 'Profile')}
                agentLabel={t('fields.agent', 'Agent')}
                disabled={isSubmitting}
              />
            </div>
          </form>
        )}

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
            {isRevealing
              ? t('generate.closeNote', 'You can close this dialog now.')
              : t('generate.directNote', 'Token is generated immediately.')}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleOpenChange(false)}
              disabled={isSubmitting}
            >
              {isRevealing ? tCommon('actions.close', 'Close') : tCommon('actions.cancel')}
            </Button>
            {!isRevealing && (
              <Button
                variant="primary"
                size="sm"
                type="submit"
                form="token-generate-form"
                disabled={isSubmitting}
              >
                <Icon as={KeyRound} size={13} />
                {isSubmitting
                  ? t('generate.generating', 'Generating…')
                  : t('generate.generate', 'Generate')}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── page ──────────────────────────────────────────────────────── */

export function TokensPage() {
  const { t } = useTranslation('tokens');

  /* UI state */
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [scope, setScope] = useState<{ profileId?: string; agentId?: string }>({});
  const [showGenerate, setShowGenerate] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<{
    token: string;
    profileId?: string;
    agentId?: string;
  } | null>(null);

  const debouncedQ = useDebounce(q, 500);

  /* queries + mutations */
  const tokensQuery = useTokensList({
    q: debouncedQ || undefined,
    page,
    page_size: 25,
    profileId: scope.profileId,
    agentId: scope.agentId,
  });
  const generateMutation = useGenerateToken();
  const revokeMutation = useRevokeToken();

  // Search in progress: from first keystroke (debounce) through the fetch.
  const searching =
    (q.trim() !== '' && q !== debouncedQ) ||
    (debouncedQ.trim() !== '' && tokensQuery.isFetching);

  const rows = tokensQuery.data?.items ?? [];
  const total = tokensQuery.data?.total ?? 0;

  /* handlers */
  async function handleGenerate(
    data: GenerateTokenBody,
    genScope: ProfileAgentScope,
  ): Promise<string> {
    const result = await generateMutation.mutateAsync({
      name: data.name,
      profileId: genScope.profileId,
      agentId: genScope.agentId,
    });
    return result.token;
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* page header */}
      <PageHeader
        title={t('title', 'Tokens')}
        subtitle={`API tokens · ${total} ${total === 1 ? 'token' : 'tokens'}`}
        actions={
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowGenerate(true)}
          >
            <Icon as={Plus} size={14} />
            {t('actions.generate', 'New token')}
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
            placeholder={t('toolbar.searchPlaceholder', 'Search by name')}
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
        {!tokensQuery.isLoading && (
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
        {tokensQuery.isLoading ? (
          <Loader label={t('list.loading', 'Loading…')} />
        ) : tokensQuery.isError ? (
          <div
            className="p-6 text-center"
            style={{ color: 'var(--ap-danger)', fontSize: 13 }}
          >
            {t('error.load', 'Failed to load tokens.')}{' '}
            <button
              className="underline"
              onClick={() => void tokensQuery.refetch()}
            >
              {t('error.retry', 'Retry')}
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-20 gap-3"
            style={{ color: 'var(--ap-text-faint)' }}
          >
            <div style={{ fontSize: 40 }}>🔑</div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 500,
                color: 'var(--ap-text)',
              }}
            >
              {q
                ? t('empty.search', 'No tokens match your search')
                : t('empty.blank', 'No tokens yet')}
            </div>
            <div style={{ fontSize: 13 }}>
              {q
                ? t('empty.searchHint', 'Try a different name.')
                : t(
                    'empty.blankHint',
                    'Generate the first token using the button above.',
                  )}
            </div>
          </div>
        ) : (
          <TokensTable
            rows={rows}
            onRevoke={(token) => {
              const row = rows.find((r) => r.token === token);
              setRevokeTarget({
                token,
                profileId: row?.profile_id ?? undefined,
                agentId: row?.agent_id ?? undefined,
              });
            }}
          />
        )}
      </div>

      {/* pagination */}
      {!tokensQuery.isLoading && total > 25 && (
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
              disabled={!tokensQuery.data?.has_more}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* generate dialog */}
      <GenerateDialog
        open={showGenerate}
        onOpenChange={setShowGenerate}
        onGenerate={handleGenerate}
      />

      {/* revoke confirmation */}
      <ConfirmDialog
        open={Boolean(revokeTarget)}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
        variant="danger"
        title={t('revoke.title', 'Revoke token?')}
        description={t(
          'revoke.description',
          'This token will be permanently revoked. Any scripts or services using it will lose access immediately.',
        )}
        confirmLabel={
          revokeMutation.isPending
            ? t('revoke.revoking', 'Revoking…')
            : t('revoke.confirm', 'Revoke')
        }
        cancelLabel={t('revoke.cancel', 'Cancel')}
        loading={revokeMutation.isPending}
        onConfirm={async () => {
          if (!revokeTarget) return;
          const { token, profileId, agentId } = revokeTarget;
          try {
            await revokeMutation.mutateAsync({ token, profileId, agentId });
            setRevokeTarget(null);
          } catch {
            /* toast handled in hook */
          }
        }}
      />
    </div>
  );
}

export default TokensPage;
