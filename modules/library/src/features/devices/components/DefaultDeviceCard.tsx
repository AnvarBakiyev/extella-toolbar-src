/**
 * DefaultDeviceCard — top-of-page card showing the current default device.
 *
 * Sources:
 *   - Default target string: `useDefaultDevice` → `/api/defaults/get_target`
 *   - Enrichment: if the default target matches a registered device, show its description.
 *
 * States: Loading (skeleton), Empty (null target), Error (inline banner), Loaded.
 * Action: "Change default" → ChangeDefaultDialog.
 */

import { useState } from 'react';
import { MonitorSmartphone, Star, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/lib/icon';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ChangeDefaultDialog } from './ChangeDefaultDialog';
import type { Device } from '@/lib/types';

export interface DefaultDeviceCardProps {
  /** Is the default currently loading? */
  isLoading: boolean;
  /** Did the default fetch error out? */
  isError: boolean;
  /** Current default target string (null = none set). */
  defaultTarget: string | null | undefined;
  /** Registered devices for the Change Default picker. */
  registeredDevices: Device[];
  /** Retry callback for error state. */
  onRetry: () => void;
  /** Callback that fires the set-default mutation; returns promise. */
  onSetDefault: (target: string) => Promise<unknown>;
  /** Whether the set-default mutation is in flight. */
  isSettingDefault: boolean;
}

export function DefaultDeviceCard({
  isLoading,
  isError,
  defaultTarget,
  registeredDevices,
  onRetry,
  onSetDefault,
  isSettingDefault,
}: DefaultDeviceCardProps) {
  const { t } = useTranslation('devices');
  const [changeOpen, setChangeOpen] = useState(false);

  // Find enrichment from registered devices
  const matchedDevice = defaultTarget
    ? registeredDevices.find((d) => d.target === defaultTarget)
    : undefined;

  return (
    <section
      aria-label={t('defaultCard.ariaLabel', 'Default device')}
      className="mx-7 mb-1 mt-5 rounded-xl border border-border bg-bgCard"
    >
      {/* Section header */}
      <div className="flex items-center justify-between border-b border-divider px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Icon as={Star} size={14} className="text-accent" />
          <span className="text-sm font-semibold text-text">
            {t('defaultCard.heading', 'Default device')}
          </span>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setChangeOpen(true)}
          disabled={isLoading || isSettingDefault}
        >
          {t('defaultCard.changeButton', 'Change default')}
        </Button>
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        {isLoading ? (
          /* Loading skeleton */
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-80" />
          </div>
        ) : isError ? (
          /* Error state */
          <div className="flex items-center gap-3">
            <span className="text-sm text-danger">
              {t('defaultCard.error', 'Failed to load default device.')}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="text-danger hover:bg-dangerSoft hover:text-danger"
              onClick={onRetry}
            >
              <Icon as={RefreshCw} size={12} />
              {t('defaultCard.retry', 'Retry')}
            </Button>
          </div>
        ) : !defaultTarget ? (
          /* Empty: no default set */
          <div className="flex items-center gap-2 text-sm text-textMuted">
            <Icon as={MonitorSmartphone} size={14} className="text-iconMuted" />
            <span className="italic">
              {t('defaultCard.empty', 'No default device set')}
            </span>
          </div>
        ) : (
          /* Loaded: show the default target */
          <div className="flex min-w-0 items-center gap-3">
            <Icon as={MonitorSmartphone} size={20} className="shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-base font-semibold text-text truncate">
                  {defaultTarget}
                </span>
                <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-pill bg-accentSoft px-1.5 text-xs font-medium text-accent">
                  <Icon as={Star} size={9} />
                  {t('badge.default', 'Default')}
                </span>
              </div>
              {matchedDevice?.description ? (
                <p className="mt-0.5 text-sm text-textMuted leading-snug truncate">
                  {matchedDevice.description}
                </p>
              ) : !matchedDevice ? (
                <p className="mt-0.5 text-xs text-textFaint italic">
                  {t('defaultCard.notRegistered', 'Not in registered devices list')}
                </p>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {/* Change default dialog */}
      <ChangeDefaultDialog
        open={changeOpen}
        onOpenChange={setChangeOpen}
        currentDefault={defaultTarget ?? null}
        registeredDevices={registeredDevices}
        onConfirm={onSetDefault}
        loading={isSettingDefault}
      />
    </section>
  );
}
