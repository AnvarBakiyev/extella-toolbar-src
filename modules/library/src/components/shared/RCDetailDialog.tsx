/**
 * Fullscreen detail modal for Rule / Concept items.
 * Ported from docs/design/style/source/rc-shared/rc-detail.jsx::RCDetailModal.
 *
 * Uses Radix Dialog for focus trap, ESC handling, return-focus, and proper
 * aria semantics. Custom size / layout via DialogContent className override.
 *
 * Single user, no admin role and no approval flow: the actions are simply
 * Edit and Delete.
 *
 * @example
 *   <RCDetailDialog
 *     open={open}
 *     item={item}
 *     kind="rule"
 *     role={role}
 *     currentUserId={userId}
 *     onOpenChange={setOpen}
 *     onSave={handleSave}
 *     onDelete={handleDelete}
 *   />
 */

import { useState, useEffect, useRef, type ReactNode } from 'react';
import { X, Edit2, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/cn';
import { Icon } from '@/lib/icon';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { KindPlaque, type ItemKind } from './KindPlaque';
import { RCStatusBadge, type RCStatus } from './RCStatusBadge';
import { ProfileAgentBadge } from './ProfileAgentBadge';
import { RCBodyView } from './RCBodyView';
import { RCBodyEditor } from './RCBodyEditor';
import { TagPill } from './TagPill';
import { canEdit, canDelete } from '@/lib/permissions';
import type { Role } from '@/hooks/usePermissions';

/* ─── types ─────────────────────────────────────────────────────────── */

export interface RCDetailItem {
  id: string;
  text: string;
  status: RCStatus;
  /** Internal ownership key for permission checks — never rendered. */
  author_id: string;
  /** Profile + agent the item belongs to (shown in the metadata sidebar). */
  profile_name?: string | null;
  agent_name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  /** For rules: trigger label */
  trigger?: string | null;
  /** For concepts: tags */
  tags?: string[];
}

export interface RCDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: RCDetailItem;
  kind: ItemKind;
  role: Role | null;
  currentUserId: string;
  /** @deprecated use onOpenChange instead; kept for backward compat */
  onClose?: () => void;
  /** @deprecated approval flow removed; accepted for backward compat, unused */
  onPublish?: () => void;
  /** @deprecated approval flow removed; accepted for backward compat, unused */
  onRecall?: () => void;
  /** @deprecated approval flow removed; accepted for backward compat, unused */
  onResubmit?: () => void;
  onSave?: (text: string) => Promise<void>;
  onDelete?: () => void;
}

/* ─── helpers ───────────────────────────────────────────────────────── */

function FieldLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn('mb-1.5 text-[10px] font-semibold uppercase tracking-wider', className)}
      style={{ color: 'var(--ap-text-faint)', letterSpacing: '0.06em' }}
    >
      {children}
    </div>
  );
}

function SidebarStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span style={{ color: 'var(--ap-text-muted)', fontSize: 12 }}>{label}</span>
      <span
        className="text-right"
        style={{ fontSize: 12, color: 'var(--ap-text)', fontWeight: 500, maxWidth: 160 }}
      >
        {value ?? '—'}
      </span>
    </div>
  );
}

function fmt(dt?: string | null, locale = 'en-US'): string {
  if (!dt) return '—';
  try {
    return new Date(dt).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return dt;
  }
}

/* ─── main component ─────────────────────────────────────────────────── */

export function RCDetailDialog({
  open,
  onOpenChange,
  item,
  kind,
  role,
  currentUserId,
  onClose,
  onSave,
  onDelete,
}: RCDetailDialogProps) {
  const ns = kind === 'rule' ? 'rules' : 'concepts';
  const { t, i18n } = useTranslation(ns);
  const { t: tCommon } = useTranslation('common');
  const intlLocale = i18n.language === 'ru' ? 'ru-RU' : i18n.language === 'kz' ? 'kk-KZ' : 'en-US';

  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [editText, setEditText] = useState(item.text);
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  // reset edit text when item changes
  useEffect(() => {
    setEditText(item.text);
    setMode('view');
  }, [item.id, item.text]);

  // focus editor when switching to edit mode
  useEffect(() => {
    if (mode === 'edit') {
      requestAnimationFrame(() => editorRef.current?.focus());
    }
  }, [mode]);

  const status = item.status ?? 'draft';
  const isEdit = mode === 'edit';

  const _canEdit = canEdit(role, item, currentUserId);
  const _canDelete = canDelete(role);

  async function handleSave() {
    if (!onSave) return;
    setSaving(true);
    try {
      await onSave(editText);
      setMode('view');
    } finally {
      setSaving(false);
    }
  }

  function cancelEdit() {
    setEditText(item.text);
    setMode('view');
  }

  // ESC in edit mode cancels edit (Radix handles ESC for close when not editing)
  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && isEdit) {
      // If Radix is trying to close while editing, cancel the edit instead
      cancelEdit();
      return;
    }
    onOpenChange(nextOpen);
    onClose?.();
  }

  const handleClose = () => {
    if (isEdit) {
      cancelEdit();
    } else {
      onOpenChange(false);
      onClose?.();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          // Override default max-w-lg; use fullscreen proportions matching the original
          'flex flex-col overflow-hidden p-0 gap-0',
          'w-[92vw] max-w-[1040px] h-[92vh] max-h-[820px]',
          // Keep the built-in close button hidden — we render our own in the header
          '[&>button:last-of-type]:hidden',
        )}
        aria-label={`${t('title', kind === 'rule' ? 'Rule' : 'Concept')} ${t('detail.content', 'details')}`}
      >
        {/* DialogTitle is required by Radix for a11y; visually hidden since header shows it */}
        <DialogTitle className="sr-only">
          {t('detail.content', 'Content')} — {item.text.split('\n')[0].slice(0, 60)}
        </DialogTitle>

        {/* ── header ── */}
        <div
          className="flex items-center justify-between gap-3 shrink-0"
          style={{ padding: '12px 18px', borderBottom: '1px solid var(--ap-divider)' }}
        >
          {/* left: plaque + title + badge */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <KindPlaque kind={kind} size={28} />
            <div
              className="font-semibold truncate"
              style={{ fontSize: 18, letterSpacing: '-0.01em', maxWidth: 460 }}
            >
              {item.text.split('\n')[0].slice(0, 80) || 'Untitled'}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <RCStatusBadge status={status} />
              {kind === 'concept' && item.tags && item.tags.length > 0 && (
                <>{item.tags.slice(0, 3).map((t) => <TagPill key={t}>{t}</TagPill>)}</>
              )}
            </div>
          </div>

          {/* right: action bar */}
          <div className="flex items-center gap-1.5 shrink-0">
            {isEdit ? (
              <>
                <Button variant="secondary" size="sm" onClick={cancelEdit} disabled={saving}>
                  {tCommon('actions.cancel')}
                </Button>
                <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
                  <Icon as={Edit2} size={13} />
                  {saving ? t('adminCreate.saving', 'Saving…') : tCommon('actions.save')}
                </Button>
              </>
            ) : (
              /* edit + delete — single user, no approval flow */
              <>
                {_canEdit && (
                  <Button variant="primary" size="sm" onClick={() => setMode('edit')}>
                    <Icon as={Edit2} size={13} />
                    {tCommon('actions.edit')}
                  </Button>
                )}
                {_canDelete && onDelete && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onDelete}
                    className="text-danger hover:bg-dangerSoft hover:text-danger"
                    title={tCommon('actions.delete')}
                  >
                    <Icon as={Trash2} size={13} />
                    {tCommon('actions.delete')}
                  </Button>
                )}
              </>
            )}

            <div style={{ width: 1, height: 20, background: 'var(--ap-divider)', margin: '0 4px' }} />
            <Button variant="ghost" size="icon-sm" onClick={handleClose} aria-label={tCommon('actions.close')}>
              <Icon as={X} size={14} />
            </Button>
          </div>
        </div>

        {/* ── body ── */}
        <div className="flex flex-1 min-h-0">
          {/* main */}
          <div className="flex-1 min-w-0 overflow-auto">
            <div style={{ maxWidth: 760, margin: '0 auto', padding: '20px 24px 28px' }}>
              <FieldLabel>{t('detail.content')}</FieldLabel>
              {isEdit ? (
                <RCBodyEditor
                  ref={editorRef}
                  value={editText}
                  onChange={setEditText}
                  minHeight={300}
                />
              ) : (
                <RCBodyView text={item.text} />
              )}
            </div>
          </div>

          {/* ── sidebar ── */}
          <aside
            className="flex flex-col gap-4 overflow-auto shrink-0"
            style={{
              width: 280,
              borderLeft: '1px solid var(--ap-divider)',
              background: 'var(--ap-bg-inset)',
              padding: '16px 16px 20px',
            }}
          >
            {/* status */}
            <div>
              <FieldLabel>{t('detail.status', 'Status')}</FieldLabel>
              <div className="flex flex-col gap-1.5">
                <RCStatusBadge status={status} />
                {status === 'published_active' && (
                  <p style={{ fontSize: 11, color: 'var(--ap-text-faint)', marginTop: 4, lineHeight: 1.5 }}>
                    {t('detail.status.activeHint', kind === 'rule'
                      ? 'Applied to model per trigger.'
                      : 'Available in RAG search for all experts.')}
                  </p>
                )}
                {status === 'draft' && (
                  <p style={{ fontSize: 11, color: 'var(--ap-text-faint)', marginTop: 4 }}>
                    {t('detail.status.draftHint', 'Not applied until published.')}
                  </p>
                )}
              </div>
            </div>

            {/* metadata */}
            <div>
              <FieldLabel>{t('detail.metadata', 'Metadata')}</FieldLabel>
              <div className="flex flex-col gap-2">
                {item.profile_name || item.agent_name ? (
                  <SidebarStat
                    label={t('detail.profileAgent', 'Profile / Agent')}
                    value={
                      <ProfileAgentBadge
                        profile_name={item.profile_name}
                        agent_name={item.agent_name}
                        stacked
                      />
                    }
                  />
                ) : null}
                <SidebarStat label={t('detail.created', 'Created')} value={fmt(item.created_at, intlLocale)} />
                {item.updated_at && item.updated_at !== item.created_at && (
                  <SidebarStat label={t('detail.updated', 'Updated')} value={fmt(item.updated_at, intlLocale)} />
                )}
                {kind === 'concept' && item.tags && (
                  <SidebarStat label={t('detail.tags', 'Tags')} value={item.tags.length} />
                )}
              </div>
            </div>

            {/* tags */}
            {kind === 'concept' && item.tags && item.tags.length > 0 && (
              <div>
                <FieldLabel>{t('detail.tags', 'Tags')}</FieldLabel>
                <div className="flex flex-wrap gap-1">
                  {item.tags.map((tag) => <TagPill key={tag}>{tag}</TagPill>)}
                </div>
              </div>
            )}

            {/* Edit / Delete live in the header action bar. */}
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
