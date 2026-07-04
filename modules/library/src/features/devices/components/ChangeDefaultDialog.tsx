/**
 * ChangeDefaultDialog — small dialog for setting the default device.
 *
 * Offers:
 * 1. A Select to pick from registered devices (if any), with their target strings.
 * 2. A free-text input to type any target not in the registered list.
 *
 * The two modes are mutually exclusive: picking from the list clears the
 * free-text field and vice versa.
 */

import { useState, useEffect, useId } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/lib/icon';
import { cn } from '@/lib/cn';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import type { Device } from '@/lib/types';

export interface ChangeDefaultDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Current default target string (to pre-select). */
  currentDefault: string | null;
  /** Registered devices available as quick-pick options. */
  registeredDevices: Device[];
  /** Called with the chosen target string; should return a promise. */
  onConfirm: (target: string) => Promise<unknown>;
  loading?: boolean;
}

const FREE_TEXT_SENTINEL = '__free_text__';

export function ChangeDefaultDialog({
  open,
  onOpenChange,
  currentDefault,
  registeredDevices,
  onConfirm,
  loading,
}: ChangeDefaultDialogProps) {
  const { t } = useTranslation('devices');
  const freeTextId = useId();
  const selectId = useId();

  // Which registered device target is selected in the dropdown (empty = none)
  const [selectedTarget, setSelectedTarget] = useState<string>('');
  // Free-text value
  const [freeText, setFreeText] = useState('');
  // Validation error message
  const [error, setError] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  // Reset when dialog opens
  useEffect(() => {
    if (open) {
      // Pre-populate: if currentDefault matches a registered device, pick it in select
      const matchInList = registeredDevices.find((d) => d.target === currentDefault);
      if (matchInList) {
        setSelectedTarget(matchInList.target);
        setFreeText('');
      } else if (currentDefault) {
        setSelectedTarget('');
        setFreeText(currentDefault);
      } else {
        setSelectedTarget('');
        setFreeText('');
      }
      setError('');
    }
  }, [open, currentDefault, registeredDevices]);

  const handleSelectChange = (value: string) => {
    setSelectedTarget(value === FREE_TEXT_SENTINEL ? '' : value);
    setFreeText('');
    setError('');
  };

  const handleFreeTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFreeText(e.target.value);
    if (e.target.value.trim()) {
      // Clear the dropdown selection when user types freely
      setSelectedTarget('');
    }
    setError('');
  };

  const resolvedTarget = selectedTarget || freeText.trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolvedTarget) {
      setError(t('changeDefault.errorRequired', 'Please enter or select a target'));
      return;
    }
    setIsBusy(true);
    try {
      await onConfirm(resolvedTarget);
      onOpenChange(false);
    } finally {
      setIsBusy(false);
    }
  };

  const busy = isBusy || loading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t('changeDefault.title', 'Change default device')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(e)} noValidate>
          <div className="flex flex-col gap-4 py-2">
            {/* Registered device picker */}
            {registeredDevices.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor={selectId}
                  className="text-sm font-medium text-text"
                >
                  {t('changeDefault.pickLabel', 'Pick a registered device')}
                </label>
                <Select
                  value={selectedTarget || FREE_TEXT_SENTINEL}
                  onValueChange={handleSelectChange}
                >
                  <SelectTrigger id={selectId}>
                    <SelectValue
                      placeholder={t('changeDefault.pickPlaceholder', 'Select a device…')}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={FREE_TEXT_SENTINEL}>
                      <span className="text-textFaint italic">
                        {t('changeDefault.pickNone', 'Enter manually below')}
                      </span>
                    </SelectItem>
                    {registeredDevices.map((d) => (
                      <SelectItem key={d.id} value={d.target}>
                        <span className="font-medium">{d.target}</span>
                        {d.description ? (
                          <span className="ml-1.5 text-textMuted text-xs">
                            {d.description}
                          </span>
                        ) : null}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {/* Free-text input */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={freeTextId}
                className="text-sm font-medium text-text"
              >
                {registeredDevices.length > 0
                  ? t('changeDefault.orFreeText', 'Or enter a target manually')
                  : t('changeDefault.freeTextLabel', 'Device target')}
                {registeredDevices.length === 0 ? (
                  <span className="ml-1 text-danger" aria-hidden>*</span>
                ) : null}
              </label>
              <input
                id={freeTextId}
                type="text"
                autoComplete="off"
                placeholder={t('changeDefault.freeTextPlaceholder', 'e.g. WORKSTATION-PRIMARY')}
                value={freeText}
                onChange={handleFreeTextChange}
                aria-describedby={error ? `${freeTextId}-error` : undefined}
                disabled={Boolean(selectedTarget) || busy}
                className={cn(
                  'h-8 w-full rounded-md border bg-bgCard px-2.5 text-md text-text outline-none transition-colors placeholder:text-textFaint',
                  'focus:border-borderStrong disabled:opacity-50 disabled:cursor-not-allowed',
                  error ? 'border-danger focus:border-danger' : 'border-border',
                )}
              />
              {error ? (
                <p id={`${freeTextId}-error`} className="text-xs text-danger" role="alert">
                  {error}
                </p>
              ) : null}
            </div>

            {/* Summary of what will be set */}
            {resolvedTarget ? (
              <div className="rounded-md bg-bgInset px-3 py-2 text-sm text-textMuted">
                {t('changeDefault.willSetTo', 'Will set default to:')}{' '}
                <span className="font-semibold text-text">{resolvedTarget}</span>
              </div>
            ) : null}
          </div>

          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              {t('changeDefault.cancel', 'Cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={busy || !resolvedTarget}
            >
              {busy ? <Icon as={Loader2} size={13} className="animate-spin" /> : null}
              {busy
                ? t('changeDefault.saving', 'Saving…')
                : t('changeDefault.confirm', 'Set as default')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
