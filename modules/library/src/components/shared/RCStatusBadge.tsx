/**
 * Status badge for Rules / Concepts items.
 * Ported from docs/design/style/source/rc-shared/rc-role.jsx::StatusBadge.
 *
 * Renders a coloured inline chip with dot/pulse/icon depending on status.
 * Named RCStatusBadge to avoid collision with any future generic StatusBadge
 * in this folder.
 */

import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

export type RCStatus =
  | 'published_active'
  | 'published_inactive'
  | 'draft';

interface StatusConfig {
  /** i18n key in common namespace */
  labelKey: string;
  color: string;
  dot?: boolean;
  pulse?: boolean;
  dashed?: boolean;
}

const STATUS_MAP: Record<RCStatus, StatusConfig> = {
  published_active: { labelKey: 'status.publishedActive', color: 'var(--ap-success)', dot: true },
  published_inactive: { labelKey: 'status.publishedInactive', color: 'var(--ap-text-faint)', dot: true },
  draft: { labelKey: 'status.draft', color: 'var(--ap-text-muted)', dashed: true },
};

export interface RCStatusBadgeProps {
  status: RCStatus | string;
  size?: 'sm' | 'md';
  className?: string;
}

export function RCStatusBadge({ status, size = 'md', className }: RCStatusBadgeProps) {
  const { t } = useTranslation('common');
  const cfg = STATUS_MAP[status as RCStatus] ?? STATUS_MAP.draft;

  return (
    <span
      className={cn('inline-flex items-center gap-1 whitespace-nowrap font-medium', className)}
      style={{
        padding: size === 'sm' ? '1px 6px' : '2px 8px',
        fontSize: size === 'sm' ? 10 : 11,
        background: `color-mix(in oklab, ${cfg.color} 14%, transparent)`,
        color: cfg.color,
        border: cfg.dashed ? `1px dashed ${cfg.color}` : '1px solid transparent',
        borderRadius: 4,
      }}
    >
      {cfg.dot && !cfg.pulse && (
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: cfg.color,
            flexShrink: 0,
          }}
        />
      )}
      {cfg.pulse && (
        <span
          className="rc-pulse-dot"
          style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: cfg.color,
            flexShrink: 0,
          }}
        />
      )}
      {t(cfg.labelKey)}
    </span>
  );
}
