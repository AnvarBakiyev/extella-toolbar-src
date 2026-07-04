import { useTranslation } from 'react-i18next';
import { AGENT_PROVIDER_COLORS, normalizeProvider } from '../schemas';

export interface ProviderBadgeProps {
  /** Raw upstream provider string, e.g. `openAI`, `anthropic`. */
  provider: string | null | undefined;
}

/**
 * ProviderBadge — colored badge showing the agent provider (Anthropic, OpenAI,
 * Google, …). Tinted with `color-mix` so the chip background is a 12 % blend
 * of the brand color — same visual pattern as TypeBadge for experts.
 */
export function ProviderBadge({ provider }: ProviderBadgeProps) {
  const { t } = useTranslation('agents');
  const key = normalizeProvider(provider);
  const color = AGENT_PROVIDER_COLORS[key];
  const label = provider ? t(`providers.${key}`, provider) : t('providers.other', 'Other');

  return (
    <span
      className="inline-flex h-5 items-center gap-1 rounded-pill px-1.5 text-xs font-medium leading-none"
      style={{
        background: `color-mix(in oklab, ${color} 12%, transparent)`,
        color,
      }}
      title={provider ?? undefined}
    >
      {label}
    </span>
  );
}
