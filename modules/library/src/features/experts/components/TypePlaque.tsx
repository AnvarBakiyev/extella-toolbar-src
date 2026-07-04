import { useTranslation } from 'react-i18next';
import { EXPERT_TYPE_COLORS, type ExpertType } from '../schemas';

export interface TypePlaqueProps {
  type: ExpertType;
  size?: number;
}

/**
 * TypePlaque — colored square with the first letter of the type label.
 * Port of TypePlaque from experts-card.jsx.
 */
export function TypePlaque({ type, size = 40 }: TypePlaqueProps) {
  const { t } = useTranslation('experts');
  const label = t(`types.${type}`, type);
  const ch = (label[0] ?? '?').toUpperCase();
  const color = EXPERT_TYPE_COLORS[type] ?? EXPERT_TYPE_COLORS.general;

  return (
    <div
      aria-label={label}
      style={{
        width: size,
        height: size,
        borderRadius: 10,
        background: color,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.4,
        fontWeight: 700,
        letterSpacing: '-0.01em',
        flexShrink: 0,
      }}
    >
      {ch}
    </div>
  );
}
