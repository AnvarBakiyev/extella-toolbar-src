/**
 * TeamPlaque — colored, rounded initials plaque for a team (profile).
 * Color derived from the profile_id; initials from the team name.
 */

import { teamColor, teamInitials } from '../lib/teamColor';

export interface TeamPlaqueProps {
  profileId: string;
  name: string;
  /** Square side length in px. */
  size?: number;
}

export function TeamPlaque({ profileId, name, size = 40 }: TeamPlaqueProps) {
  const color = teamColor(profileId);
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-lg"
      style={{
        width: size,
        height: size,
        background: color,
        color: '#fff',
        fontSize: Math.round(size * 0.35),
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      {teamInitials(name)}
    </span>
  );
}
