import { MonitorSmartphone, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/lib/icon';
import type { Device } from '@/lib/types';

export interface DeviceCardProps {
  device: Device;
  dense?: boolean;
}

/**
 * DeviceCard — grid card for a single device target.
 * Shows: target (title), description preview, Default badge, created date.
 * Mirrors ExpertCard proportions: left rail, title row, description, footer.
 */
export function DeviceCard({ device, dense = false }: DeviceCardProps) {
  const { t } = useTranslation('devices');

  const formattedDate = device.created_at
    ? new Date(device.created_at).toLocaleDateString()
    : undefined;

  return (
    <div
      className="ap-device-card relative flex min-w-0 flex-col gap-2.5 overflow-hidden rounded-xl border border-border bg-bgCard transition-colors duration-100 hover:border-borderStrong hover:bg-bg2"
      style={{ padding: dense ? 12 : 14 }}
    >
      {/* Left color rail */}
      <span
        aria-hidden="true"
        className="absolute bottom-0 left-0 top-0 w-[3px] rounded-bl-xl rounded-tl-xl"
        style={{ background: 'var(--ap-accent)' }}
      />

      {/* Title row */}
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div
          className="line-clamp-1 flex-1 min-w-0 text-base font-semibold leading-snug"
          title={device.target}
        >
          {device.target}
        </div>
        {device.is_default ? (
          <span
            className="flex shrink-0 items-center gap-0.5 rounded-pill bg-accentSoft px-1.5 py-0.5 text-xs font-medium text-accent"
            title={t('badge.default', 'Default')}
          >
            <Icon as={Star} size={10} />
            {t('badge.default', 'Default')}
          </span>
        ) : null}
      </div>

      {/* Description */}
      <div
        className="line-clamp-2 text-sm leading-[1.4] text-textMuted"
        style={{ minHeight: dense ? 0 : 36 }}
      >
        {device.description || (
          <span className="italic text-textFaint">
            {t('card.noDescription', 'No description')}
          </span>
        )}
      </div>

      {/* Footer */}
      <div className="mt-auto flex items-center justify-between border-t border-divider pt-2">
        <div className="flex items-center gap-1.5 text-xs text-textFaint">
          <Icon as={MonitorSmartphone} size={11} className="text-iconMuted" />
          {formattedDate ?? t('card.noDate', '—')}
        </div>
      </div>
    </div>
  );
}
