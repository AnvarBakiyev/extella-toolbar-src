import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, Loader2, Play, Share2, Square, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/lib/icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/layout/EmptyState';
import {
  Drawer,
  DrawerContent,
  DrawerClose,
} from '@/components/ui/Drawer';
import { useExpert } from '../hooks/useExpert';
import { useShareExpert } from '../hooks/useExpertMutations';
import { useExpertRuns } from '../runs/ExpertRunsContext';
import { deriveExpertType, EXPERT_TYPE_COLORS, type ExpertDetail, type RunPhase } from '../schemas';
import { TypeBadge } from './TypeBadge';
import { ProfileAgentBadge } from '@/components/shared/ProfileAgentBadge';

export interface ExpertPreviewDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expertName: string;
  /** Optional — when provided, renders a destructive Delete button in the
   *  top action bar. Page fires its own confirm + mutation. */
  onDelete?: (name: string) => void;
}

interface DrawerSectionProps {
  title: string;
  count?: number;
  children: React.ReactNode;
}

function DrawerSection({ title, count, children }: DrawerSectionProps) {
  return (
    <section className="border-t border-divider px-5 py-4">
      <div className="mb-2.5 text-xs font-medium uppercase tracking-[0.04em] text-textFaint">
        {title}
        {count != null ? <span className="ml-1.5">· {count}</span> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * ExpertPreviewDrawer — 460px right-side panel with expert detail.
 * Built on Radix Dialog (via ui/drawer.tsx) for proper focus trap, ESC,
 * and return-focus semantics.
 *
 * Usage:
 *   <ExpertPreviewDrawer
 *     open={Boolean(drawerName)}
 *     onOpenChange={(open) => { if (!open) closePreview(); }}
 *     expertName={drawerName ?? ''}
 *   />
 */
export function ExpertPreviewDrawer({
  open,
  onOpenChange,
  expertName,
  onDelete,
}: ExpertPreviewDrawerProps) {
  const { t: tCommon } = useTranslation('common');
  const { t } = useTranslation('experts');

  const { data: expert, isLoading, isError } = useExpert(expertName);

  // ── Run state — sourced from the shared run manager so the drawer stays in
  //    sync with the same expert's card on the list. ───────────────────────────
  const runs = useExpertRuns();
  const runView = expert ? runs.getRun(expert.name) : undefined;
  const phase: RunPhase = runView?.phase ?? 'idle';
  const taskStatus = runView?.status ?? null;
  const taskResult = runView?.result ?? null;

  function handleRun() {
    if (!expert) return;
    // The drawer already loaded the detail, so it knows `cspl` — pass it so the
    // run path skips the extra on-click `getExpert` probe the cards must do.
    runs.run(
      expert.name,
      {
        profileId: expert.profile_id ?? undefined,
        agentId: expert.agent_id ?? undefined,
      },
      { cspl: expert.cspl ?? undefined },
    );
  }

  function handleStop() {
    // "Stop" clears local run state — there's no cancel API upstream.
    if (!expert) return;
    runs.stop(expert.name);
  }

  // ── Share state ────────────────────────────────────────────────────────────
  const [shareOpen, setShareOpen] = useState(false);
  const [recipientToken, setRecipientToken] = useState('');
  const shareMutation = useShareExpert();
  const shareInputRef = useRef<HTMLInputElement>(null);

  function handleShareToggle() {
    setShareOpen((prev) => !prev);
    setRecipientToken('');
    shareMutation.reset();
  }

  function handleShareConfirm() {
    if (!expert || !recipientToken.trim()) return;
    shareMutation.mutate(
      {
        name: expert.name,
        recipientToken: recipientToken.trim(),
        profileId: expert.profile_id ?? undefined,
        agentId: expert.agent_id ?? undefined,
      },
      {
        onSuccess: () => {
          setShareOpen(false);
          setRecipientToken('');
        },
      },
    );
  }

  // Focus the share input when the inline row opens.
  useEffect(() => {
    if (shareOpen) {
      // Defer to after the DOM update.
      const id = window.setTimeout(() => shareInputRef.current?.focus(), 50);
      return () => window.clearTimeout(id);
    }
  }, [shareOpen]);

  const type = expert ? deriveExpertType(expert.name, expert.description) : 'general';
  const typeColor = EXPERT_TYPE_COLORS[type] ?? EXPERT_TYPE_COLORS.general;

  const formattedDate = expert?.created_at
    ? new Date(expert.created_at).toLocaleDateString()
    : '—';
  const formattedUpdated = expert?.updated_at
    ? new Date(expert.updated_at).toLocaleDateString()
    : null;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent width={460}>
        {/* Top chrome */}
        <div className="flex min-h-11 items-center gap-2 border-b border-divider px-3.5 py-2.5">
          <div className="flex-1" />

          {/* Share button — toggles inline share row below */}
          {expert ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleShareToggle}
              aria-pressed={shareOpen}
              title={t('actions.share', 'Share')}
            >
              <Icon as={Share2} size={13} />
              {t('actions.share', 'Share')}
            </Button>
          ) : null}

          {onDelete && expert ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(expert.name)}
              className="text-danger hover:bg-dangerSoft hover:text-danger"
              title={t('actions.delete', 'Delete')}
            >
              <Icon as={Trash2} size={13} />
              {t('actions.delete', 'Delete')}
            </Button>
          ) : null}

          {/* Close button */}
          <DrawerClose asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={tCommon('actions.close')}
            >
              <Icon as={X} size={14} />
            </Button>
          </DrawerClose>
        </div>

        {/* Inline Share row — appears below chrome when share is toggled */}
        {shareOpen && expert ? (
          <div
            className="flex items-center gap-2 border-b border-divider bg-bg2 px-3.5 py-2.5"
            role="group"
            aria-label={t('share.label', 'Share expert')}
          >
            <label
              htmlFor="share-recipient-input"
              className="shrink-0 text-sm text-textMuted"
            >
              {t('share.recipientLabel', 'Recipient token')}
            </label>
            <Input
              id="share-recipient-input"
              ref={shareInputRef}
              value={recipientToken}
              onChange={(e) => setRecipientToken(e.target.value)}
              placeholder={t('share.recipientPlaceholder', 'token…')}
              wrapperClassName="h-[26px] text-sm flex-1"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleShareConfirm();
                if (e.key === 'Escape') handleShareToggle();
              }}
              autoComplete="off"
            />
            <Button
              variant="primary"
              size="sm"
              disabled={!recipientToken.trim() || shareMutation.isPending}
              onClick={handleShareConfirm}
            >
              {shareMutation.isPending ? (
                <Icon as={Loader2} size={13} className="animate-spin" />
              ) : null}
              {t('share.confirm', 'Share')}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleShareToggle}>
              {t('share.cancel', 'Cancel')}
            </Button>
          </div>
        ) : null}

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <DrawerSkeleton />
          ) : isError ? (
            <div className="p-5">
              <p className="text-sm text-danger">Failed to load expert. Try again.</p>
            </div>
          ) : expert ? (
            <>
              {/* HERO */}
              <div className="px-5 pb-4 pt-[18px]">
                <div className="mb-3.5 flex min-w-0 flex-col gap-2">
                  <div className="flex min-w-0 items-baseline gap-1.5">
                    <h2 className="flex-1 min-w-0 truncate text-xl font-semibold tracking-[-0.01em]">
                      {expert.name}
                    </h2>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <TypeBadge type={type} />
                    {expert.cspl ? (
                      <span
                        className="inline-flex h-5 items-center rounded-pill bg-bg3 px-1.5 text-xs font-medium text-textMuted"
                        style={{ fontFamily: 'var(--ap-font-mono)' }}
                        title={t('drawer.cspl', 'Language')}
                      >
                        {expert.cspl}
                      </span>
                    ) : null}
                  </div>
                </div>

                <p className="mb-3.5 text-base leading-relaxed text-text">
                  {expert.description}
                </p>

                {/* RUN CONTROL — temporarily hidden.
                <RunControl
                  phase={phase}
                  taskStatus={taskStatus}
                  taskResult={taskResult}
                  onRun={handleRun}
                  onStop={handleStop}
                /> */}
              </div>

              {/* METADATA */}
              <DrawerSection title={t('drawer.metadata', 'Metadata')}>
                <div
                  className="grid text-md"
                  style={{ gridTemplateColumns: 'auto 1fr', gap: '10px 12px' }}
                >
                  {expert.profile_name || expert.agent_name ? (
                    <>
                      <span className="text-textMuted">
                        {t('drawer.profileAgent', 'Profile / Agent')}
                      </span>
                      <ProfileAgentBadge
                        profile_name={expert.profile_name}
                        agent_name={expert.agent_name}
                      />
                    </>
                  ) : null}
                  <span className="text-textMuted">{t('drawer.added', 'Added')}</span>
                  <span>{formattedDate}</span>
                  {formattedUpdated ? (
                    <>
                      <span className="text-textMuted">
                        {t('drawer.updated', 'Updated')}
                      </span>
                      <span>{formattedUpdated}</span>
                    </>
                  ) : null}
                  {expert.cspl ? (
                    <>
                      <span className="text-textMuted">
                        {t('drawer.cspl', 'Language')}
                      </span>
                      <span style={{ fontFamily: 'var(--ap-font-mono)' }}>
                        {expert.cspl}
                      </span>
                    </>
                  ) : null}
                </div>
              </DrawerSection>

              {/* PARAMETERS — mapped from upstream `expert_params` */}
              <ParametersSection params={expert.params} />

              {/* CODE — mapped from upstream `expert_code` */}
              <CodeSection code={expert.code} />

              {/* HISTORY — only real data: created event */}
              <DrawerSection title={t('drawer.history', 'History')}>
                <div className="relative flex flex-col gap-2.5 pl-3.5">
                  {/* Timeline line */}
                  <span
                    className="absolute bottom-1 left-1 top-1 w-px"
                    style={{ background: 'var(--ap-divider)' }}
                  />
                  <div className="flex items-start gap-2.5">
                    <span
                      className="relative shrink-0 mt-[5px] h-2 w-2 rounded-full border-2 border-bgCard shadow-[0_0_0_1px_var(--ap-border)]"
                      style={{ background: typeColor, marginLeft: -14 }}
                    />
                    <div className="flex flex-col text-md">
                      <span>created</span>
                      <span className="text-xs text-textFaint">
                        {expert.profile_name
                          ? `${formattedDate} · ${expert.profile_name}`
                          : formattedDate}
                      </span>
                    </div>
                  </div>
                </div>
              </DrawerSection>
            </>
          ) : null}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

// ─── RunControl ────────────────────────────────────────────────────────────────

interface RunControlProps {
  phase: RunPhase;
  taskStatus: string | null;
  taskResult: string | null;
  onRun: () => void;
  onStop: () => void;
}

function RunControl({ phase, taskStatus, taskResult, onRun, onStop }: RunControlProps) {
  const { t } = useTranslation('experts');

  const isPending = phase === 'pending';
  const isRunning = phase === 'running';
  const isActive = isPending || isRunning;
  const isLaunched = phase === 'launched';
  const isSuccess = phase === 'success';
  const taskFailed = phase === 'error';

  return (
    <div className="flex flex-col gap-2">
      {/* Run / Stop button row */}
      <div className="flex items-center gap-2">
        {isActive ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled
              aria-label={isPending ? t('run.pending', 'Pending') : t('drawer.running', 'Running')}
            >
              <Icon as={Loader2} size={13} className="animate-spin" />
              {isPending ? t('run.pending', 'Pending…') : t('drawer.running', 'Running…')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onStop}
              aria-label={t('drawer.stop', 'Stop')}
            >
              <Icon as={Square} size={13} />
              {t('drawer.stop', 'Stop')}
            </Button>
          </>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={onRun}
            aria-label={t('drawer.useExpert', 'Use')}
          >
            <Icon as={Play} size={13} />
            {t('drawer.useExpert', 'Use')}
          </Button>
        )}

        {/* Inline status pill. `launched` is a fire-and-forget terminal state
            (synchronous run, no task_id to poll) — label it explicitly since it
            carries no upstream status string. */}
        {isLaunched ? (
          <span className="inline-flex h-5 items-center rounded-pill bg-bg3 px-1.5 text-xs font-medium text-textMuted">
            {t('run.statusBadge.launched', 'Launched')}
          </span>
        ) : taskStatus && !isActive ? (
          <span
            className={[
              'inline-flex h-5 items-center rounded-pill px-1.5 text-xs font-medium',
              isSuccess
                ? 'bg-successSoft text-success'
                : taskFailed
                  ? 'bg-dangerSoft text-danger'
                  : 'bg-bg3 text-textMuted',
            ].join(' ')}
          >
            {taskStatus}
          </span>
        ) : null}
      </div>

      {/* Result / error row — only when terminal and there's something to show */}
      {!isActive && (isSuccess || taskFailed) && taskResult ? (
        <div
          className={[
            'rounded-md border px-3 py-2 text-sm',
            isSuccess
              ? 'border-successSoft bg-successSoft text-success'
              : 'border-dangerSoft bg-dangerSoft text-danger',
          ].join(' ')}
          role="status"
        >
          <pre
            style={{
              margin: 0,
              fontFamily: 'inherit',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {taskResult}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function DrawerSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-5 pt-5">
      <div className="h-6 w-2/3 animate-pulse rounded-md bg-bg3" />
      <div className="h-4 w-1/3 animate-pulse rounded-md bg-bg3" />
      <div className="mt-2 h-20 w-full animate-pulse rounded-md bg-bg3" />
      <div className="h-8 w-full animate-pulse rounded-md bg-bg3" />
    </div>
  );
}

function formatParamValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

interface ParametersSectionProps {
  params: ExpertDetail['params'];
}

function ParametersSection({ params }: ParametersSectionProps) {
  const { t } = useTranslation('experts');
  const entries: Array<[string, unknown]> = Array.isArray(params)
    ? params.map((v, i) => [String(i), v])
    : params && typeof params === 'object'
      ? Object.entries(params)
      : [];
  return (
    <DrawerSection
      title={t('drawer.parameters', 'Parameters')}
      count={entries.length}
    >
      {entries.length === 0 ? (
        <EmptyState
          title=""
          description={t('drawer.parameters.empty', 'This expert takes no parameters.')}
          className="border-0 bg-transparent py-3"
        />
      ) : (
        <div
          className="grid text-md"
          style={{ gridTemplateColumns: 'auto 1fr', gap: '8px 12px' }}
        >
          {entries.map(([key, value]) => (
            <React.Fragment key={key}>
              <span
                className="text-textMuted"
                style={{ fontFamily: 'var(--ap-font-mono)' }}
              >
                {key}
              </span>
              <span
                className="break-words"
                style={{
                  fontFamily: 'var(--ap-font-mono)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {formatParamValue(value)}
              </span>
            </React.Fragment>
          ))}
        </div>
      )}
    </DrawerSection>
  );
}

interface CodeSectionProps {
  code: ExpertDetail['code'];
}

function CodeSection({ code }: CodeSectionProps) {
  const { t } = useTranslation('experts');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(id);
  }, [copied]);

  const onCopy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  return (
    <DrawerSection title={t('drawer.code', 'Code')}>
      {!code ? (
        <EmptyState
          title=""
          description={t('drawer.code.empty', 'No source code is attached to this expert.')}
          className="border-0 bg-transparent py-3"
        />
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={onCopy}
              title={copied
                ? t('drawer.code.copied', 'Copied')
                : t('drawer.code.copy', 'Copy')}
            >
              <Icon as={copied ? Check : Copy} size={13} />
              {copied
                ? t('drawer.code.copied', 'Copied')
                : t('drawer.code.copy', 'Copy')}
            </Button>
          </div>
          <pre
            className="rounded-md border border-divider bg-bg3 p-3 text-xs"
            style={{
              margin: 0,
              fontFamily: 'var(--ap-font-mono)',
              lineHeight: 1.55,
              maxHeight: 280,
              overflow: 'auto',
              whiteSpace: 'pre',
              color: 'var(--ap-text)',
            }}
          >
            {code}
          </pre>
        </div>
      )}
    </DrawerSection>
  );
}
