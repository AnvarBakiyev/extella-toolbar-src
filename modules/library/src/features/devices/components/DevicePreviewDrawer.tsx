/**
 * DevicePreviewDrawer — 460px right-side panel with device detail.
 * Built on ui/Drawer (Radix Dialog) for focus trap, ESC, return-focus.
 *
 * Shows: target, description, Default badge, created/updated dates.
 * Actions: Edit, Set as default, Delete.
 */

import { Edit2, Loader2, MonitorSmartphone, Star, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/lib/icon';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerClose,
} from '@/components/ui/Drawer';
import { useDevice } from '../hooks/useDevices';
import type { Device } from '@/lib/types';

export interface DevicePreviewDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deviceId: string;
  /** Called when user clicks Edit in the drawer. Page shows the form dialog. */
  onEdit?: (device: Device) => void;
  /** Called when user clicks Delete in the drawer. Page shows the confirm dialog. */
  onDelete?: (device: Device) => void;
  /** Called when user clicks Set as default. Page fires the mutation. */
  onSetDefault?: (device: Device) => void;
  /** Whether set-default mutation is in progress. */
  isSettingDefault?: boolean;
}

interface DrawerSectionProps {
  title: string;
  children: React.ReactNode;
}

function DrawerSection({ title, children }: DrawerSectionProps) {
  return (
    <section className="border-t border-divider px-5 py-4">
      <div className="mb-2.5 text-xs font-medium uppercase tracking-[0.04em] text-textFaint">
        {title}
      </div>
      {children}
    </section>
  );
}

function DrawerSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-5 pt-5">
      <div className="h-6 w-2/3 animate-pulse rounded-md bg-bg3" />
      <div className="h-4 w-1/3 animate-pulse rounded-md bg-bg3" />
      <div className="mt-2 h-16 w-full animate-pulse rounded-md bg-bg3" />
      <div className="h-8 w-full animate-pulse rounded-md bg-bg3" />
    </div>
  );
}

export function DevicePreviewDrawer({
  open,
  onOpenChange,
  deviceId,
  onEdit,
  onDelete,
  onSetDefault,
  isSettingDefault,
}: DevicePreviewDrawerProps) {
  const { t } = useTranslation('devices');

  const { data: device, isLoading, isError } = useDevice(deviceId);

  const formattedCreated = device?.created_at
    ? new Date(device.created_at).toLocaleDateString()
    : '—';
  const formattedUpdated = device?.updated_at
    ? new Date(device.updated_at).toLocaleDateString()
    : null;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent width={460}>
        {/* Top chrome */}
        <div className="flex min-h-11 items-center gap-2 border-b border-divider px-3.5 py-2.5">
          <div className="flex-1" />

          {/* Set as default */}
          {device && !device.is_default && onSetDefault ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSetDefault(device)}
              disabled={isSettingDefault}
              title={t('actions.setDefault', 'Set as default')}
            >
              {isSettingDefault ? (
                <Icon as={Loader2} size={13} className="animate-spin" />
              ) : (
                <Icon as={Star} size={13} />
              )}
              {t('actions.setDefault', 'Set as default')}
            </Button>
          ) : null}

          {/* Edit */}
          {device && onEdit ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onEdit(device)}
              title={t('actions.edit', 'Edit')}
            >
              <Icon as={Edit2} size={13} />
              {t('actions.edit', 'Edit')}
            </Button>
          ) : null}

          {/* Delete */}
          {device && onDelete ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(device)}
              className="text-danger hover:bg-dangerSoft hover:text-danger"
              title={t('actions.delete', 'Delete')}
            >
              <Icon as={Trash2} size={13} />
              {t('actions.delete', 'Delete')}
            </Button>
          ) : null}

          {/* Close */}
          <DrawerClose asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Close">
              <Icon as={X} size={14} />
            </Button>
          </DrawerClose>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <DrawerSkeleton />
          ) : isError || !device ? (
            <div className="p-5">
              <p className="text-sm text-danger">
                {t('drawer.error', 'Failed to load device. Try again.')}
              </p>
            </div>
          ) : (
            <>
              {/* Hero */}
              <div className="px-5 pb-4 pt-[18px]">
                <div className="mb-3.5 flex min-w-0 flex-col gap-2">
                  <div className="flex min-w-0 items-baseline gap-1.5">
                    <h2 className="flex-1 min-w-0 truncate text-xl font-semibold tracking-[-0.01em]">
                      {device.target}
                    </h2>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {/* Device type plaque */}
                    <span className="inline-flex h-5 items-center gap-1 rounded-pill bg-bg3 px-1.5 text-xs font-medium text-textMuted">
                      <Icon as={MonitorSmartphone} size={10} />
                      {t('badge.device', 'Device')}
                    </span>
                    {device.is_default ? (
                      <span className="inline-flex h-5 items-center gap-1 rounded-pill bg-accentSoft px-1.5 text-xs font-medium text-accent">
                        <Icon as={Star} size={10} />
                        {t('badge.default', 'Default')}
                      </span>
                    ) : null}
                  </div>
                </div>

                {device.description ? (
                  <p className="mb-3.5 text-base leading-relaxed text-text">
                    {device.description}
                  </p>
                ) : (
                  <p className="mb-3.5 text-base leading-relaxed text-textFaint italic">
                    {t('drawer.noDescription', 'No description provided.')}
                  </p>
                )}
              </div>

              {/* Metadata */}
              <DrawerSection title={t('drawer.metadata', 'Metadata')}>
                <div
                  className="grid text-md"
                  style={{ gridTemplateColumns: 'auto 1fr', gap: '10px 12px' }}
                >
                  <span className="text-textMuted">{t('drawer.id', 'ID')}</span>
                  <span
                    className="break-all text-sm"
                    style={{ fontFamily: 'var(--ap-font-mono)' }}
                  >
                    {device.id}
                  </span>
                  <span className="text-textMuted">{t('drawer.added', 'Added')}</span>
                  <span>{formattedCreated}</span>
                  {formattedUpdated && formattedUpdated !== formattedCreated ? (
                    <>
                      <span className="text-textMuted">{t('drawer.updated', 'Updated')}</span>
                      <span>{formattedUpdated}</span>
                    </>
                  ) : null}
                  <span className="text-textMuted">{t('drawer.status', 'Status')}</span>
                  <span>
                    {device.is_default ? (
                      <span className="inline-flex items-center gap-1 text-accent">
                        <Icon as={Star} size={11} />
                        {t('badge.default', 'Default')}
                      </span>
                    ) : (
                      <span className="text-textMuted">
                        {t('drawer.notDefault', 'Not default')}
                      </span>
                    )}
                  </span>
                </div>
              </DrawerSection>
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
