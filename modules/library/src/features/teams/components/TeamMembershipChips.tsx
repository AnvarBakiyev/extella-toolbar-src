/**
 * TeamMembershipChips — read-only chips showing which teams an agent belongs to.
 *
 * Membership is many-to-many and read-only here (it is configured in the backend
 * profile, not edited from the UI). Each chip links to that team's detail page.
 * Renders nothing when the agent is in no team unless `showEmpty` is set.
 */

import { Link } from 'react-router-dom';
import { teamColor } from '../lib/teamColor';
import type { RawTeam } from '@/features/shared/useTopology';

export interface TeamMembershipChipsProps {
  teams: RawTeam[];
  /** When the master is this agent, mark the chip for the team it leads. */
  masterOfTeamIds?: Set<string>;
  /** Show a muted "No team" pill when there are no memberships. */
  showEmpty?: boolean;
  max?: number;
  /** Stop click events from bubbling (e.g. when nested in a card button). */
  stopPropagation?: boolean;
  emptyLabel?: string;
}

export function TeamMembershipChips({
  teams,
  masterOfTeamIds,
  showEmpty = false,
  max = 4,
  stopPropagation = false,
  emptyLabel = 'No team',
}: TeamMembershipChipsProps) {
  if (teams.length === 0) {
    if (!showEmpty) return null;
    return (
      <span className="inline-flex h-5 items-center rounded-pill border border-border px-1.5 text-xs text-textFaint">
        {emptyLabel}
      </span>
    );
  }

  const shown = teams.slice(0, max);
  const extra = teams.length - shown.length;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((team) => {
        const color = teamColor(team.profile_id);
        return (
          <Link
            key={team.profile_id}
            to={`/teams/${encodeURIComponent(team.profile_id)}`}
            onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
            className="inline-flex h-6 max-w-[220px] items-center gap-1.5 rounded-pill border px-2 text-xs font-medium transition-colors hover:bg-bg3"
            style={{ borderColor: 'var(--ap-border)', color: 'var(--ap-text-muted)' }}
            title={
              masterOfTeamIds?.has(team.profile_id)
                ? `${team.profile_name} (master)`
                : team.profile_name
            }
          >
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 shrink-0 rounded-[3px]"
              style={{ background: color }}
            />
            <span className="truncate">{team.profile_name}</span>
          </Link>
        );
      })}
      {extra > 0 ? (
        <span className="inline-flex h-5 items-center rounded-pill border border-border px-1.5 text-xs text-textFaint">
          +{extra}
        </span>
      ) : null}
    </div>
  );
}
