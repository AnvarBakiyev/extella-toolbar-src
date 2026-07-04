/**
 * Direct-create modal for Rule / Concept (single user, no approval flow).
 * Ported from docs/design/style/source/rc-shared/rc-publish.jsx::AdminCreateModal.
 *
 * Uses Radix Dialog for focus trap, ESC handling, return-focus, and proper aria.
 * Creates via POST /intelligence/rules or /intelligence/concepts.
 *
 * @example
 *   <AdminCreateModal
 *     open={showCreate}
 *     onOpenChange={setShowCreate}
 *     kind="rule"
 *     onSave={handleSave}
 *   />
 */

import { useState, useEffect, useRef, type ReactNode } from 'react';
import { X, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/lib/icon';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { KindPlaque, type ItemKind } from './KindPlaque';
import { RCBodyEditor } from './RCBodyEditor';

export interface AdminCreateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: ItemKind;
  /** @deprecated use onOpenChange instead; kept for backward compat */
  onClose?: () => void;
  /** Called with { text }; should return the created item or throw */
  onSave: (text: string) => Promise<void>;
  /**
   * Extra fields rendered below the content editor (e.g. Profile + Agent selectors).
   * Rendered inside the scrollable body before the text area's error message.
   */
  extraFields?: ReactNode;
}

export function AdminCreateModal({
  open,
  onOpenChange,
  kind,
  onClose,
  onSave,
  extraFields,
}: AdminCreateModalProps) {
  const ns = kind === 'rule' ? 'rules' : 'concepts';
  const { t } = useTranslation(ns);
  const { t: tCommon } = useTranslation('common');

  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const kindLabel = t('adminCreate.title');
  const placeholder = t('adminCreate.content.placeholder');

  // Reset state when opened
  useEffect(() => {
    if (open) {
      setText('');
      setError(null);
      setSaving(false);
      // Focus editor after Radix finishes mounting
      requestAnimationFrame(() => editorRef.current?.focus());
    }
  }, [open]);

  function handleOpenChange(nextOpen: boolean) {
    if (saving) return; // prevent close during save
    onOpenChange(nextOpen);
    if (!nextOpen) onClose?.();
  }

  async function handleSave() {
    if (!text.trim()) {
      setError('Content is required');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave(text.trim());
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={[
          'flex flex-col overflow-hidden p-0 gap-0',
          'w-[92vw] max-w-[760px] max-h-[92vh]',
          // Hide default built-in close button — we render our own
          '[&>button:last-of-type]:hidden',
        ].join(' ')}
      >
        <DialogTitle className="sr-only">{kindLabel}</DialogTitle>

        {/* header */}
        <div
          className="flex items-center justify-between shrink-0"
          style={{ padding: '14px 20px', borderBottom: '1px solid var(--ap-divider)' }}
        >
          <div className="flex items-center gap-2.5">
            <KindPlaque kind={kind} size={26} />
            <span className="font-semibold" style={{ fontSize: 16 }}>{kindLabel}</span>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => handleOpenChange(false)}
            aria-label="Close"
            disabled={saving}
          >
            <Icon as={X} size={14} />
          </Button>
        </div>

        {/* body */}
        <div className="overflow-auto flex-1 min-h-0">
          <div style={{ padding: '16px 20px' }}>
            {/* Extra fields (e.g. Profile + Agent selectors) */}
            {extraFields ? (
              <div className="mb-4">{extraFields}</div>
            ) : null}
            <label
              htmlFor="admin-create-content"
              className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--ap-text-faint)' }}
            >
              {t('adminCreate.content.label')} <span style={{ color: 'var(--ap-danger)' }}>*</span>
            </label>
            <RCBodyEditor
              ref={editorRef}
              id="admin-create-content"
              value={text}
              onChange={(v) => { setText(v); setError(null); }}
              placeholder={placeholder}
              minHeight={200}
            />
            {error && (
              <p className="mt-1 text-sm" style={{ color: 'var(--ap-danger)', fontSize: 12 }}>
                {error}
              </p>
            )}
          </div>
        </div>

        {/* footer */}
        <div
          className="flex items-center justify-end shrink-0"
          style={{ padding: '12px 20px', borderTop: '1px solid var(--ap-divider)', background: 'var(--ap-bg-inset)' }}
        >
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleOpenChange(false)}
              disabled={saving}
            >
              {tCommon('actions.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSave}
              disabled={saving || !text.trim()}
            >
              <Icon as={Check} size={13} />
              {saving ? t('adminCreate.saving', 'Saving…') : t('adminCreate.save')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
