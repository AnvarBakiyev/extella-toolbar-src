/**
 * AgentCategoryBadge — colored badge per agent category.
 *
 * The design doc `agents-data.jsx` uses OKLCH color values per category; we
 * replicate the same palette here so the visual language is consistent with
 * the design doc.
 *
 * Category string is the raw backend value (e.g. "assistant", "coding").
 * Unknown categories fall back to a neutral grey.
 */

export const AGENT_CATEGORY_COLORS: Record<string, string> = {
  assistant: 'oklch(0.6 0.14 240)',
  coding: 'oklch(0.6 0.16 195)',
  research: 'oklch(0.65 0.18 290)',
  analytics: 'oklch(0.62 0.14 145)',
  writing: 'oklch(0.62 0.18 220)',
  ops: 'oklch(0.62 0.14 70)',
  support: 'oklch(0.6 0.18 25)',
  domain: 'oklch(0.58 0.16 165)',
};

export const AGENT_CATEGORY_LABELS: Record<string, string> = {
  assistant: 'Assistant',
  coding: 'Code',
  research: 'Research',
  analytics: 'Analytics',
  writing: 'Writing',
  ops: 'Ops',
  support: 'Support',
  domain: 'Domain',
};

export interface AgentCategoryBadgeProps {
  category: string | null | undefined;
}

/**
 * AgentCategoryBadge — inline colored chip for the agent's category.
 * Background is a 12% tint of the brand color, same pattern as TypeBadge.
 */
export function AgentCategoryBadge({ category }: AgentCategoryBadgeProps) {
  const key = category ?? '';
  const color = AGENT_CATEGORY_COLORS[key] ?? 'oklch(0.58 0.05 250)';
  const label = AGENT_CATEGORY_LABELS[key] ?? (key || 'Unknown');

  return (
    <span
      className="inline-flex h-5 items-center rounded-pill px-1.5 text-xs font-medium leading-none"
      style={{
        background: `color-mix(in oklab, ${color} 12%, transparent)`,
        color,
      }}
      title={`Category: ${label}`}
    >
      {label}
    </span>
  );
}
