/**
 * AgentAvatar — category-colored initials plaque.
 *
 * Per contract §0: no avatar field — always render category-colored initials.
 * Same visual pattern as the design doc `agents-card.jsx::AgentAvatar`.
 *
 * Avatar initials = first 2 words of the agent name (minus "Studio · " prefix)
 * Color = derived from category string via the AGENT_CATEGORY_COLORS map.
 */

import { AGENT_CATEGORY_COLORS } from './AgentCategoryBadge';

export interface AgentAvatarProps {
  name: string;
  category: string | null | undefined;
  size?: number;
}

/**
 * Strip common org prefixes ("Studio · ", "Org · " etc.) before extracting
 * initials so we get the meaningful part of the name.
 */
function getInitials(name: string): string {
  const stripped = name.replace(/^[\w-]+ · /, '');
  return stripped
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || '?';
}

export function AgentAvatar({ name, category, size = 36 }: AgentAvatarProps) {
  const color = AGENT_CATEGORY_COLORS[category ?? ''] ?? 'oklch(0.58 0.12 240)';
  const initials = getInitials(name);
  const radius = size >= 40 ? 12 : 8;

  return (
    <div
      aria-label={name}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: color,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.38,
        fontWeight: 700,
        letterSpacing: '-0.01em',
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {initials}
    </div>
  );
}
