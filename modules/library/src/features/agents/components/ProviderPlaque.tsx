import { AGENT_PROVIDER_COLORS, normalizeProvider } from '../schemas';

export interface ProviderPlaqueProps {
  provider: string | null | undefined;
  size?: number;
}

/**
 * ProviderPlaque — colored square with the first letter of the provider name.
 * Direct port of TypePlaque but coloured by agent provider rather than expert
 * type.
 */
export function ProviderPlaque({ provider, size = 40 }: ProviderPlaqueProps) {
  const key = normalizeProvider(provider);
  const label = (provider ?? key).trim();
  const ch = (label[0] ?? '?').toUpperCase();
  const color = AGENT_PROVIDER_COLORS[key];

  return (
    <div
      aria-label={label || key}
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
