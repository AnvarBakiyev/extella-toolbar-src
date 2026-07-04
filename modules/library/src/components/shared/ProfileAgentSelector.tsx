/**
 * ProfileAgentSelector — two selects for choosing a (profile, agent) pair
 * in create/edit dialogs.
 *
 * Pre-selects DEFAULT_PROFILE_ID / DEFAULT_AGENT_ID unless the parent
 * passes `value` with specific ids. Dependent: the agent select updates its
 * options when the profile changes.
 */

import { useTopology } from '@/features/shared/useTopology';
import { ChevronDown } from 'lucide-react';
import { Icon } from '@/lib/icon';
import type { ProfileAgentScope } from './ProfileAgentFilter';

export type { ProfileAgentScope };

export interface ProfileAgentSelectorProps {
  value: ProfileAgentScope;
  onChange: (scope: ProfileAgentScope) => void;
  /** Labels shown above the selects */
  profileLabel?: string;
  agentLabel?: string;
  disabled?: boolean;
}

export function ProfileAgentSelector({
  value,
  onChange,
  profileLabel = 'Profile',
  agentLabel = 'Agent',
  disabled = false,
}: ProfileAgentSelectorProps) {
  const { data: topology } = useTopology();
  const profiles = topology?.profiles ?? [];
  const selectedProfile = profiles.find((p) => p.profile_id === value.profileId);
  const availableAgents = selectedProfile?.agents ?? [];

  const handleProfileChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const pid = e.target.value;
    // When the profile changes, reset agentId to the first available agent in
    // the new profile (or clear it if no agents).
    const firstAgent = profiles.find((p) => p.profile_id === pid)?.agents[0];
    onChange({ profileId: pid || undefined, agentId: firstAgent?.agent_id });
  };

  const handleAgentChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange({ profileId: value.profileId, agentId: e.target.value || undefined });
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Profile */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-textMuted uppercase tracking-[0.04em]">
          {profileLabel}
        </label>
        <div className="relative">
          <select
            value={value.profileId ?? ''}
            onChange={handleProfileChange}
            disabled={disabled}
            className="h-8 w-full rounded-md border border-border bg-bgCard pl-2.5 pr-7 text-sm text-text appearance-none focus:outline-none focus:ring-2 focus:ring-accentSoftStrong disabled:opacity-50"
          >
            <option value="">— select —</option>
            {profiles.map((p) => (
              <option key={p.profile_id} value={p.profile_id}>
                {p.profile_name || p.profile_id}
              </option>
            ))}
          </select>
          <Icon
            as={ChevronDown}
            size={12}
            className="pointer-events-none absolute right-2 top-2.5 text-textMuted"
          />
        </div>
      </div>

      {/* Agent */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-textMuted uppercase tracking-[0.04em]">
          {agentLabel}
        </label>
        <div className="relative">
          <select
            value={value.agentId ?? ''}
            onChange={handleAgentChange}
            disabled={disabled || !value.profileId}
            className="h-8 w-full rounded-md border border-border bg-bgCard pl-2.5 pr-7 text-sm text-text appearance-none focus:outline-none focus:ring-2 focus:ring-accentSoftStrong disabled:opacity-50"
          >
            <option value="">— select —</option>
            {availableAgents.map((a) => (
              <option key={a.agent_id} value={a.agent_id}>
                {a.agent_name || a.agent_id}
              </option>
            ))}
          </select>
          <Icon
            as={ChevronDown}
            size={12}
            className="pointer-events-none absolute right-2 top-2.5 text-textMuted"
          />
        </div>
      </div>
    </div>
  );
}
