/**
 * ProfileAgentFilter — profile select + dependent agent select.
 *
 * Driven by useTopology. Emits { profileId?, agentId? } whenever the user
 * changes the selection. Selecting "All profiles" clears both ids; selecting
 * a profile clears agentId until the user picks a specific agent.
 *
 * The component is purely controlled — caller owns the state and passes it
 * back in via `value`.
 */

import { useTranslation } from 'react-i18next';
import { useTopology } from '@/features/shared/useTopology';
import { ChevronDown } from 'lucide-react';
import { Icon } from '@/lib/icon';

export interface ProfileAgentScope {
  profileId?: string;
  agentId?: string;
}

export interface ProfileAgentFilterProps {
  value: ProfileAgentScope;
  onChange: (scope: ProfileAgentScope) => void;
  className?: string;
}

export function ProfileAgentFilter({
  value,
  onChange,
  className = '',
}: ProfileAgentFilterProps) {
  const { t } = useTranslation('common');
  const { data: topology } = useTopology();
  const profiles = topology?.profiles ?? [];

  const selectedProfile = profiles.find((p) => p.profile_id === value.profileId);
  const availableAgents = selectedProfile?.agents ?? [];

  const handleProfileChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const pid = e.target.value;
    if (!pid) {
      onChange({ profileId: undefined, agentId: undefined });
    } else {
      onChange({ profileId: pid, agentId: undefined });
    }
  };

  const handleAgentChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const aid = e.target.value;
    onChange({ profileId: value.profileId, agentId: aid || undefined });
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* Profile select */}
      <div className="relative flex items-center">
        <select
          value={value.profileId ?? ''}
          onChange={handleProfileChange}
          className="h-8 rounded-md border border-border bg-bgCard pl-2.5 pr-7 text-sm text-text appearance-none focus:outline-none focus:ring-2 focus:ring-accentSoftStrong"
          style={{ minWidth: 120 }}
          aria-label="Filter by profile"
        >
          <option value="">{t('list.allProfiles')}</option>
          {profiles.map((p) => (
            <option key={p.profile_id} value={p.profile_id}>
              {/* «Default» приходит ИМЕНЕМ ПРОФИЛЯ с платформы, это данные, а не наша
                  подпись. Но человеку в русском окне английское слово читается как наш
                  недосмотр (замечание Эллы). Переводим ТОЛЬКО системный профиль —
                  остальные названия придумал сам человек, их трогать нельзя. */}
              {p.profile_id === 'default' || p.profile_name === 'Default'
                ? t('filter.defaultProfile')
                : p.profile_name || p.profile_id}
            </option>
          ))}
        </select>
        <Icon
          as={ChevronDown}
          size={12}
          className="pointer-events-none absolute right-2 text-textMuted"
        />
      </div>

      {/* Agent select — only rendered when a profile is selected */}
      {value.profileId && availableAgents.length > 0 ? (
        <div className="relative flex items-center">
          <select
            value={value.agentId ?? ''}
            onChange={handleAgentChange}
            className="h-8 rounded-md border border-border bg-bgCard pl-2.5 pr-7 text-sm text-text appearance-none focus:outline-none focus:ring-2 focus:ring-accentSoftStrong"
            style={{ minWidth: 140 }}
            aria-label="Filter by agent"
          >
            <option value="">{t('list.allAgents')}</option>
            {availableAgents.map((a) => (
              <option key={a.agent_id} value={a.agent_id}>
                {a.agent_name || a.agent_id}
              </option>
            ))}
          </select>
          <Icon
            as={ChevronDown}
            size={12}
            className="pointer-events-none absolute right-2 text-textMuted"
          />
        </div>
      ) : null}
    </div>
  );
}
