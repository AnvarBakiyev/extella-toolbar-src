import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface DeleteByNameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Exact text the user must type to enable the confirm button. */
  expectedName: string;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
}

/**
 * Destructive confirmation that requires the user to type the object's exact
 * name before the delete button enables (GitHub-style). Use for irreversible
 * deletes where a single click is too easy. For low-risk confirms reuse
 * {@link ConfirmDialog} instead.
 */
export function DeleteByNameDialog({
  open,
  onOpenChange,
  title,
  description,
  expectedName,
  confirmLabel,
  cancelLabel,
  onConfirm,
  loading,
}: DeleteByNameDialogProps) {
  const { t } = useTranslation('common');
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Clear any prior input whenever the dialog (re)opens.
  useEffect(() => {
    if (open) setValue('');
  }, [open]);

  const matches = value.trim() === expectedName.trim() && expectedName.trim().length > 0;

  const handleConfirm = () => {
    if (!matches || loading) return;
    void onConfirm();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm text-textMuted">
            {t('deleteByName.prompt', 'Type the name to confirm:')}{' '}
            <span
              className="select-all font-medium text-text"
              style={{ fontFamily: 'var(--ap-font-mono)' }}
            >
              {expectedName}
            </span>
          </label>
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleConfirm();
              }
            }}
            placeholder={expectedName}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            aria-label={t('deleteByName.inputLabel', 'Confirm by typing the name')}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            {cancelLabel ?? t('actions.cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={handleConfirm}
            disabled={!matches || loading}
          >
            {confirmLabel ?? t('actions.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
