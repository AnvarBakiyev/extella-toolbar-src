/**
 * DeviceFormDialog — create + edit dialog for devices.
 *
 * - Create: `device` prop is undefined; title = "New device".
 * - Edit:   `device` prop is supplied; title = "Edit device"; fields pre-filled.
 * - Uses React Hook Form + Zod (CreateDeviceBodySchema) for validation.
 * - Validate on blur + submit (not on every keystroke).
 * - Red border + helper text on error; label above input; `*` for required.
 */

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Icon } from '@/lib/icon';
import { cn } from '@/lib/cn';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CreateDeviceBodySchema, type CreateDeviceBody } from '../schemas';
import type { Device } from '@/lib/types';

export interface DeviceFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** If provided, the dialog is in edit mode (pre-filled). */
  device?: Device;
  /** Called with validated form values. Should return a promise; dialog awaits it. */
  onSave: (values: CreateDeviceBody) => Promise<void>;
  loading?: boolean;
}

/**
 * DeviceFormDialog — modal dialog for creating or editing a device.
 */
export function DeviceFormDialog({
  open,
  onOpenChange,
  device,
  onSave,
  loading,
}: DeviceFormDialogProps) {
  const { t } = useTranslation('devices');
  const isEdit = Boolean(device);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateDeviceBody>({
    resolver: zodResolver(CreateDeviceBodySchema),
    mode: 'onBlur',
    defaultValues: {
      target: device?.target ?? '',
      description: device?.description ?? '',
    },
  });

  // Reset form when dialog opens or device changes
  useEffect(() => {
    if (open) {
      reset({
        target: device?.target ?? '',
        description: device?.description ?? '',
      });
    }
  }, [open, device, reset]);

  const isBusy = isSubmitting || loading;

  async function onSubmit(values: CreateDeviceBody) {
    await onSave(values);
    // Don't reset here — parent will close the dialog on success
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? t('form.editTitle', 'Edit device')
              : t('form.createTitle', 'New device')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate>
          <div className="flex flex-col gap-4 py-2">
            {/* target field */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="device-target"
                className="text-sm font-medium text-text"
              >
                {t('form.targetLabel', 'Device name / identifier')}
                <span className="ml-1 text-danger" aria-hidden>*</span>
              </label>
              <input
                id="device-target"
                type="text"
                autoComplete="off"
                placeholder={t('form.targetPlaceholder', 'e.g. device-001')}
                aria-required
                aria-describedby={errors.target ? 'device-target-error' : undefined}
                {...register('target')}
                className={cn(
                  'h-8 w-full rounded-md border bg-bgCard px-2.5 text-md text-text outline-none transition-colors placeholder:text-textFaint',
                  'focus:border-borderStrong',
                  errors.target
                    ? 'border-danger focus:border-danger'
                    : 'border-border',
                )}
              />
              {errors.target ? (
                <p id="device-target-error" className="text-xs text-danger" role="alert">
                  {errors.target.message}
                </p>
              ) : null}
            </div>

            {/* description field */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="device-description"
                className="text-sm font-medium text-text"
              >
                {t('form.descriptionLabel', 'Description')}
                <span className="ml-1 text-textFaint text-xs font-normal">
                  {t('form.optional', '(optional)')}
                </span>
              </label>
              <textarea
                id="device-description"
                rows={3}
                placeholder={t('form.descriptionPlaceholder', 'Brief description of the device...')}
                aria-describedby={errors.description ? 'device-description-error' : undefined}
                {...register('description')}
                className={cn(
                  'w-full resize-y rounded-md border bg-bgCard px-2.5 py-1.5 text-md text-text outline-none transition-colors placeholder:text-textFaint',
                  'focus:border-borderStrong',
                  errors.description
                    ? 'border-danger focus:border-danger'
                    : 'border-border',
                )}
              />
              {errors.description ? (
                <p id="device-description-error" className="text-xs text-danger" role="alert">
                  {errors.description.message}
                </p>
              ) : null}
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isBusy}
            >
              {t('form.cancel', 'Cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={isBusy}>
              {isBusy ? <Icon as={Loader2} size={13} className="animate-spin" /> : null}
              {isEdit
                ? isBusy
                  ? t('form.saving', 'Saving…')
                  : t('form.save', 'Save changes')
                : isBusy
                  ? t('form.creating', 'Creating…')
                  : t('form.create', 'Create device')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
