/**
 * ScopeSelect — the "context selector" for an agent's team-scoped entities.
 *
 * An agent's Experts / Concepts / Rules are not a single flat list: they are
 * scoped per (profile, agent) pair on the backend. The same agent therefore has
 * one set under the Default profile and a (possibly different) set inside each
 * team it belongs to. This control picks which context the Experts/Concepts/
 * Rules tabs are resolved against.
 *
 * Options = Default profile + every team that lists this agent. Each option
 * carries the `profileId` to query with (DEFAULT_PROFILE_ID for "Default").
 */

import { ChevronDown, Layers } from 'lucide-react';
import { Icon } from '@/lib/icon';
import { teamColor } from '@/features/teams/lib/teamColor';
import { DEFAULT_PROFILE_ID } from '@/lib/runtime';
import type { RawTeam } from '@/features/shared/useTopology';

export interface ScopeOption {
  /** profile_id to scope entity queries with. */
  profileId: string;
  /** Human label (e.g. "Default profile" or the team name). */
  label: string;
  /** True for the synthetic Default profile option. */
  isDefault: boolean;
}

/** Build the scope options for an agent: Default + each team it belongs to. */
export function buildScopeOptions(
  agentId: string,
  teams: RawTeam[],
  defaultLabel: string,
): ScopeOption[] {
  const memberTeams = teams.filter((t) => t.agent_ids.includes(agentId));
  return [
    { profileId: DEFAULT_PROFILE_ID, label: defaultLabel, isDefault: true },
    ...memberTeams.map((t) => ({
      profileId: t.profile_id,
      label: t.profile_name,
      isDefault: false,
    })),
  ];
}

export interface ScopeSelectProps {
  label: string;
  options: ScopeOption[];
  value: string;
  onChange: (profileId: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ScopeSelect({
  label,
  options,
  value,
  onChange,
  open,
  onOpenChange,
}: ScopeSelectProps) {
  const current = options.find((o) => o.profileId === value) ?? options[0];

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-[0.04em] text-textFaint">
        {label}
      </span>
      <div className="relative">
        <button
          type="button"
          className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-bgCard px-2.5 text-sm font-medium text-text transition-colors hover:bg-bg3"
          onClick={() => onOpenChange(!open)}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          {current?.isDefault ? (
            <Icon as={Layers} size={12} className="text-textMuted" />
          ) : (
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 rounded-[3px]"
              style={{ background: teamColor(current?.profileId ?? '') }}
            />
          )}
          <span className="max-w-[200px] truncate">{current?.label}</span>
          <Icon as={ChevronDown} size={12} className="text-textMuted" />
        </button>
        {open ? (
          <div
            role="listbox"
            className="absolute right-0 top-[calc(100%+4px)] z-20 flex min-w-[220px] flex-col gap-0.5 rounded-md border border-border bg-bgCard p-1 shadow-pop"
            onMouseLeave={() => onOpenChange(false)}
          >
            {options.map((o) => {
              const active = o.profileId === value;
              return (
                <button
                  key={o.profileId}
                  role="option"
                  aria-selected={active}
                  className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-md text-text hover:bg-bg3"
                  style={{ background: active ? 'var(--ap-bg-3)' : undefined }}
                  onClick={() => {
                    onChange(o.profileId);
                    onOpenChange(false);
                  }}
                >
                  {o.isDefault ? (
                    <Icon as={Layers} size={12} className="text-textMuted" />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="inline-block h-2.5 w-2.5 rounded-[3px]"
                      style={{ background: teamColor(o.profileId) }}
                    />
                  )}
                  <span className="truncate">{o.label}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
