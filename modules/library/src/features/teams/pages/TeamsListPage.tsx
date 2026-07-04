/**
 * TeamsListPage — the Agent Teams landing at /teams.
 *
 * Lists every backend "team" (profile) as a card grid. Read-only: there are no
 * create / edit / delete flows because no backend endpoints exist. A team groups
 * agents that collaborate in one conversation, led by a master agent.
 */

import { Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/lib/icon';
import { PageHeader } from '@/components/layout/PageHeader';
import { ErrorBanner } from '@/components/layout/ErrorBanner';
import { EmptyState } from '@/components/layout/EmptyState';
import { Loader } from '@/components/ui/loader';
import { useTeams } from '../hooks/useTeams';
import { DefinitionBanner } from '../components/DefinitionBanner';
import { TeamCard } from '../components/TeamCard';

export function TeamsListPage() {
  const { t } = useTranslation('teams');
  const { teams, agentMap, isLoading, isError, refetch } = useTeams();

  return (
    <div className="relative flex flex-1 min-h-0 flex-col">
      <PageHeader
        title={t('list.title', 'Agent Teams')}
        subtitle={t('list.subtitle', {
          count: teams.length,
          defaultValue: '{{count}} teams for agents working together',
        })}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="px-7 pt-5">
          <DefinitionBanner>{t('list.definition')}</DefinitionBanner>
        </div>

        {isLoading ? (
          <Loader label={t('list.loading', 'Loading…')} />
        ) : isError ? (
          <div className="px-7 py-6">
            <ErrorBanner
              title={t('list.errorTitle', 'Failed to load teams')}
              onRetry={() => refetch()}
            />
          </div>
        ) : teams.length === 0 ? (
          <div className="px-7 py-8">
            <EmptyState
              icon={<Icon as={Users} size={24} />}
              title={t('list.empty.title', 'No agent teams yet')}
              description={t('list.empty.description')}
            />
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3 px-7 py-5">
            {teams.map((team) => (
              <TeamCard
                key={team.profile_id}
                team={team}
                agentMap={agentMap}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default TeamsListPage;
