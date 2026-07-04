/**
 * ProfileAgentBadge — two compact badges that show which profile + agent
 * an entity belongs to.
 *
 * Renders nothing when both profile_name and agent_name are null/undefined.
 */

import type { ProfileAgentLabel } from '@/lib/types';

export interface ProfileAgentBadgeProps
  extends Pick<ProfileAgentLabel, 'profile_name' | 'agent_name'> {
  /** When true, stacks badges vertically. Default: inline (row). */
  stacked?: boolean;
}

export function ProfileAgentBadge({
  profile_name,
  agent_name,
  stacked = false,
}: ProfileAgentBadgeProps) {
  if (!profile_name && !agent_name) return null;

  const containerClass = stacked
    ? 'flex flex-col gap-0.5'
    : 'flex flex-row flex-wrap gap-1 items-center';

  return (
    <span className={containerClass}>
      {profile_name ? (
        <span
          className="inline-flex items-center whitespace-nowrap"
          style={{
            padding: '1px 6px',
            fontSize: 10,
            fontWeight: 500,
            background: 'color-mix(in oklab, oklch(0.62 0.14 250) 14%, transparent)',
            color: 'oklch(0.62 0.14 250)',
            borderRadius: 4,
          }}
          title={`Profile: ${profile_name}`}
        >
          {profile_name}
        </span>
      ) : null}
      {agent_name ? (
        <span
          className="inline-flex items-center whitespace-nowrap"
          style={{
            padding: '1px 6px',
            fontSize: 10,
            fontWeight: 500,
            background: 'color-mix(in oklab, oklch(0.62 0.14 145) 14%, transparent)',
            color: 'oklch(0.62 0.14 145)',
            borderRadius: 4,
          }}
          title={`Agent: ${agent_name}`}
        >
          {agent_name}
        </span>
      ) : null}
    </span>
  );
}
