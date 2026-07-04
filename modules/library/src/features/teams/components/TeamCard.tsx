/**
 * TeamCard — one card in the Agent Teams grid.
 *
 * A "team" is a backend profile (read-only). The card surfaces the team's
 * identity (colored plaque + name), its member count, the master agent, and an
 * overlapping stack of member avatars. The whole card is a link to the team
 * detail page. No per-card entity counts (avoids N fan-out queries) — those
 * live on the detail page.
 */

import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/lib/icon';
import type { RawTeam } from '@/features/shared/useTopology';
import { teamColor, agentInitials } from '../lib/teamColor';
import { TeamPlaque } from './TeamPlaque';
import { MasterBadge } from './MasterBadge';
import { MemberStack } from './MemberStack';

export interface TeamCardProps {
  team: RawTeam;
  agentMap: Map<string, string>;
}

export function TeamCard({ team, agentMap }: TeamCardProps) {
  const { t } = useTranslation('teams');
  const navigate = useNavigate();
  const color = teamColor(team.profile_id);

  const members = team.agent_ids
    .filter((id) => agentMap.has(id))
    .map((id) => ({
      id,
      name: agentMap.get(id) ?? id,
      isMaster: id === team.master_agent_id,
    }));

  const masterName =
    team.master_agent_id && agentMap.has(team.master_agent_id)
      ? agentMap.get(team.master_agent_id) ?? team.master_agent_id
      : null;

  return (
    <button
      type="button"
      onClick={() => navigate(`/teams/${encodeURIComponent(team.profile_id)}`)}
      className="group relative flex flex-col gap-3.5 overflow-hidden rounded-xl border border-border bg-bgCard p-[18px] text-left transition-[border-color,box-shadow] hover:border-borderStrong hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentSoftStrong"
    >
      {/* colored left rail */}
      <span
        aria-hidden="true"
        className="absolute bottom-0 left-0 top-0 w-[4px] rounded-bl-xl rounded-tl-xl"
        style={{ background: color }}
      />

      {/* Head: plaque + name + member count */}
      <div className="flex items-center gap-3">
        <TeamPlaque profileId={team.profile_id} name={team.profile_name} size={40} />
        <div className="min-w-0 flex-1">
          <div
            className="truncate text-base font-semibold leading-snug"
            title={team.profile_name}
          >
            {team.profile_name}
          </div>
          <div className="mt-0.5 text-xs text-textFaint tabular-nums">
            {t('card.members', { count: members.length })}
          </div>
        </div>
      </div>

      {/* Master line */}
      <div className="flex min-h-[24px] items-center gap-2">
        {masterName ? (
          <>
            <span
              aria-hidden="true"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[9px] font-bold text-white"
              style={{ background: 'oklch(0.58 0.12 240)' }}
            >
              {agentInitials(masterName)}
            </span>
            <span
              className="min-w-0 flex-1 truncate text-sm text-textMuted"
              title={masterName}
            >
              {masterName}
            </span>
            <MasterBadge />
          </>
        ) : (
          <span className="text-sm italic text-textFaint">
            {t('card.noMaster', 'No master')}
          </span>
        )}
      </div>

      {/* Member stack + open affordance */}
      <div className="flex items-center gap-3 border-t border-divider pt-3">
        {members.length > 0 ? (
          <MemberStack members={members} max={5} />
        ) : (
          <span className="text-xs italic text-textFaint">
            {t('roster.empty', 'No agents in this team')}
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-textMuted transition-colors group-hover:text-text">
          {t('card.open', 'Open')}
          <Icon as={ArrowRight} size={13} />
        </span>
      </div>
    </button>
  );
}
