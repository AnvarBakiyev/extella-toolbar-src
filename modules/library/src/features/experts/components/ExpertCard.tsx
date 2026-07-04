import { Pin } from 'lucide-react';
import { Icon } from '@/lib/icon';
import { EXPERT_TYPE_COLORS, type ExpertType, type RunPhase } from '../schemas';
import { TypeBadge } from './TypeBadge';
import { DepsBadge } from './DepsBadge';
import { ProfileAgentBadge } from '@/components/shared/ProfileAgentBadge';
import { RunButtonWide } from '../runs/RunControls';

export interface ExpertCardData {
  /** Stable, unique row id. With no dedup the same `name` can recur across
   *  (profile, agent) pairs, so React keys must use this composite id
   *  (profile|agent|name), not `name`. Falls back to `name` when absent. */
  id?: string;
  name: string;
  description: string;
  type: ExpertType;
  depsCount: number;
  /** Profile + agent the expert belongs to (replaces the old author field). */
  profileName?: string | null;
  agentName?: string | null;
  /** Owning (profile, agent) ids — needed to scope run/delete to the pair the
   *  expert actually lives under. Display uses the *Name fields above. */
  profileId?: string | null;
  agentId?: string | null;
  /** True for built-in/global experts — shows a "Global" badge instead. */
  isGlobal?: boolean;
  date?: string;
  /** Raw upstream ISO timestamp, kept alongside the locale-formatted `date`
   *  so the page can sort by recency without parsing display strings. */
  createdAtISO?: string;
  pinned?: boolean;
}

export interface ExpertCardProps {
  expert: ExpertCardData;
  dense?: boolean;
  /** Run lifecycle phase for this expert (from the run manager). When provided
   *  (and `onRun` is set), the card shows a Run button + status badge. */
  runPhase?: RunPhase;
  /** Raw upstream status string, surfaced as the status badge tooltip. */
  runStatus?: string | null;
  /** Launch this expert. Omit to hide the run control (e.g. trash, agent page). */
  onRun?: () => void;
  /** Clear/stop this expert's run. */
  onStop?: () => void;
}

/**
 * ExpertCard — grid card with colored left rail per type.
 * Port of ExpertCard from experts-card.jsx.
 * dense=true reduces padding and description min-height.
 */
export function ExpertCard({
  expert,
  dense = false,
  runPhase,
  runStatus,
  onRun,
  onStop,
}: ExpertCardProps) {
  const typeColor = EXPERT_TYPE_COLORS[expert.type] ?? EXPERT_TYPE_COLORS.general;
  const phase: RunPhase = runPhase ?? 'idle';
  // Run/launch button temporarily hidden. Restore: const showRun = Boolean(onRun);
  const showRun = false;

  return (
    <div
      className="ap-expert-card group relative flex min-w-0 flex-col gap-2.5 overflow-hidden rounded-xl border border-border bg-bgCard transition-colors duration-100"
      style={{ padding: dense ? 12 : 14 }}
    >
      {/* Left type-color rail */}
      <span
        aria-hidden="true"
        className="absolute bottom-0 left-0 top-0 w-[3px] rounded-bl-xl rounded-tl-xl"
        style={{ background: typeColor }}
      />

      {/* Title row */}
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div
          className="line-clamp-1 flex-1 min-w-0 text-base font-semibold leading-snug"
          title={expert.name}
        >
          {expert.name}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {expert.pinned ? (
            <span
              className="flex h-[22px] w-[22px] items-center justify-center rounded-[6px] bg-accentSoft text-accent"
              title="Pinned"
            >
              <Icon as={Pin} size={11} />
            </span>
          ) : null}
        </div>
      </div>

      {/* Description */}
      <div
        className="line-clamp-2 text-sm leading-[1.4] text-textMuted"
        style={{ minHeight: dense ? 0 : 36 }}
      >
        {expert.description}
      </div>

      {/* Badges row — the type tag is swapped for a wide Run button on hover
          (or keyboard focus), and whenever this expert has a live run phase. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {showRun ? (
          <>
            {/* Type tag: visible at rest; hidden on hover/focus or while running */}
            <div
              className={
                phase !== 'idle'
                  ? 'hidden'
                  : 'flex group-hover:hidden group-focus-within:hidden'
              }
            >
              <TypeBadge type={expert.type} />
            </div>
            {/* Wide run button: revealed on hover/focus, or pinned when active */}
            <div
              className={[
                'min-w-0 flex-1',
                phase !== 'idle' ? 'flex' : 'hidden group-hover:flex group-focus-within:flex',
              ].join(' ')}
            >
              <RunButtonWide
                phase={phase}
                status={runStatus}
                onRun={() => onRun?.()}
                onStop={() => onStop?.()}
              />
            </div>
          </>
        ) : (
          <TypeBadge type={expert.type} />
        )}
        {expert.depsCount > 0 ? <DepsBadge count={expert.depsCount} mode="compact" /> : null}
      </div>

      {/* Footer = profile + agent + added date */}
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-divider pt-2">
        <ProfileAgentBadge
          profile_name={expert.profileName}
          agent_name={expert.agentName}
        />
        {expert.date ? (
          <span className="whitespace-nowrap text-xs text-textFaint">{expert.date}</span>
        ) : null}
      </div>
    </div>
  );
}
