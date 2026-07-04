/**
 * Shared color + initials helpers for the Agent Teams section.
 *
 * A "team" is a backend profile (`/api/profile/list`). Profiles have no color
 * field, so we derive a stable color from the profile_id hash — the same id
 * always maps to the same swatch across cards, plaques, rails and chips.
 */

/** Stable team palette (OKLCH), indexed by a hash of the profile_id. */
export const TEAM_COLORS = [
  'oklch(0.6 0.14 250)', // blue
  'oklch(0.62 0.14 145)', // green
  'oklch(0.6 0.16 28)', // orange
  'oklch(0.62 0.18 290)', // purple
  'oklch(0.62 0.18 220)', // azure
  'oklch(0.6 0.14 65)', // amber
] as const;

/** Deterministic team color from a profile_id. */
export function teamColor(profileId: string): string {
  let hash = 0;
  for (const c of profileId) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return TEAM_COLORS[Math.abs(hash) % TEAM_COLORS.length];
}

/** Up-to-two-letter initials from a team / profile name. */
export function teamInitials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase() || '?'
  );
}

/**
 * Up-to-two-letter initials from an agent name.
 * Strips a leading "namespace · " prefix (e.g. "Studio · Incident Commander").
 */
export function agentInitials(name: string): string {
  const stripped = name.replace(/^[\w-]+ · /, '');
  return (
    stripped
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase() || '?'
  );
}
