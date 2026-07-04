import { Link } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/lib/icon';

export interface DepsBadgeProps {
  count: number;
  /** "full" shows "N dependencies" or "no dependencies"; "compact" shows just N */
  mode?: 'full' | 'compact';
}

/**
 * DepsBadge — warning-tone badge indicating dependency count.
 * Port of DepsBadge from experts-card.jsx.
 */
export function DepsBadge({ count, mode = 'full' }: DepsBadgeProps) {
  const { t } = useTranslation('experts');

  if (!count) {
    if (mode === 'full') {
      return (
        <span className="inline-flex h-5 items-center gap-1 rounded-pill border border-border px-1.5 text-xs font-medium leading-none text-textFaint">
          {t('deps.none', 'no dependencies')}
        </span>
      );
    }
    return null;
  }

  const label =
    mode === 'full'
      ? t('deps.count', { count, defaultValue: `${count} dependencies` })
      : String(count);

  return (
    <span
      className="inline-flex h-5 items-center gap-1 rounded-pill px-1.5 text-xs font-medium leading-none"
      style={{
        background: 'var(--ap-warning-soft)',
        color: 'var(--ap-warning)',
      }}
    >
      <Icon as={Link} size={10} />
      {label}
    </span>
  );
}
