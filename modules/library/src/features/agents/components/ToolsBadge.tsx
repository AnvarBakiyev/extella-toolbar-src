import { Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/lib/icon';

export interface ToolsBadgeProps {
  count: number;
  mode?: 'full' | 'compact';
}

/**
 * ToolsBadge — neutral chip indicating how many tools the agent has enabled.
 * Compact = just `N`; full = "N tools". Mirrors DepsBadge for experts.
 */
export function ToolsBadge({ count, mode = 'full' }: ToolsBadgeProps) {
  const { t } = useTranslation('agents');

  if (!count) {
    if (mode === 'full') {
      return (
        <span className="inline-flex h-5 items-center gap-1 rounded-pill border border-border px-1.5 text-xs font-medium leading-none text-textFaint">
          {t('tools.none', 'no tools')}
        </span>
      );
    }
    return null;
  }

  const label =
    mode === 'full'
      ? t('tools.count', { count, defaultValue: `${count} tools` })
      : String(count);

  return (
    <span
      className="inline-flex h-5 items-center gap-1 rounded-pill px-1.5 text-xs font-medium leading-none"
      style={{
        background: 'var(--ap-accent-soft)',
        color: 'var(--ap-accent)',
      }}
    >
      <Icon as={Wrench} size={10} />
      {label}
    </span>
  );
}
