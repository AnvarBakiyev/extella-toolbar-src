import { useTranslation } from 'react-i18next';
import { EXPERT_TYPE_COLORS, type ExpertType } from '../schemas';

export interface TypeBadgeProps {
  type: ExpertType;
}

/**
 * TypeBadge — colored badge showing the expert type label.
 * Port of TypeBadge from experts-card.jsx.
 * Uses color-mix for the background tint matching design's 12% opacity blend.
 */
export function TypeBadge({ type }: TypeBadgeProps) {
  const { t } = useTranslation('experts');
  const label = t(`types.${type}`, type);
  const color = EXPERT_TYPE_COLORS[type] ?? EXPERT_TYPE_COLORS.general;

  return (
    <span
      className="inline-flex h-5 items-center gap-1 rounded-pill px-1.5 text-xs font-medium leading-none"
      style={{
        background: `color-mix(in oklab, ${color} 12%, transparent)`,
        color,
      }}
    >
      {label}
    </span>
  );
}
