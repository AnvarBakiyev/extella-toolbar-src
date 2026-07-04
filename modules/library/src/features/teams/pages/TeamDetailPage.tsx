/**
 * TeamDetailPage — team detail at /teams/:id (id = profile_id).
 *
 * A "team" is a backend profile (read-only). This page resolves the team from
 * the cached topology and shows:
 *   - back bar + breadcrumb "Agent Teams / <name>"
 *   - hero: team plaque, name, and a row of CounterTiles
 *   - tabs: Members / Experts(n) / Concepts(n) / Rules(n) — ?tab= in URL
 *
 * The Experts / Concepts / Rules tabs scope to the team's profile across ALL
 * member agents (profileId only, no agentId → fan-out over every agent in the
 * profile). No run / delete / edit — read-only section.
 */

import type { ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Bot,
  Pin,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/lib/icon';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/layout/EmptyState';
import { useExpertsList } from '@/features/experts/hooks/useExpertsList';
import { useConcepts } from '@/features/concepts/hooks/useConcepts';
import { useRules } from '@/features/rules/hooks/useRules';
import { ExpertsPanel, ConceptsPanel, RulesPanel } from '@/features/shared/ScopedEntityPanels';
import { useAgentsList } from '@/features/agents/hooks/useAgentsList';
import { AgentCard, type AgentCardData } from '@/features/agents/components/AgentCard';
import type { RawTeam } from '@/features/shared/useTopology';
import type { AgentRow } from '@/lib/types';
import { DEFAULT_PROFILE_ID } from '@/lib/runtime';
import { useTeams } from '../hooks/useTeams';
import { TeamPlaque } from '../components/TeamPlaque';
import { MasterBadge } from '../components/MasterBadge';
import { CounterTile } from '../components/CounterTile';

type DetailTab = 'members' | 'experts' | 'concepts' | 'rules';

const TABS: DetailTab[] = ['members', 'experts', 'concepts', 'rules'];

/* ─── MembersTab ─────────────────────────────────────────────────── */

/** Map a full agent row to the card view-model used by the Agents page. */
function toMemberCard(item: AgentRow): AgentCardData {
  return {
    id: item.id,
    name: item.name,
    description: item.description ?? '',
    provider: item.provider ?? null,
    model: item.model ?? null,
    toolsCount: item.tools?.length ?? 0,
    isPublic: item.is_public ?? null,
    date: item.updated_at
      ? new Date(item.updated_at).toLocaleDateString()
      : item.created_at
        ? new Date(item.created_at).toLocaleDateString()
        : undefined,
    category: item.category ?? null,
    profileName: item.profile_name ?? null,
  };
}

function MembersTab({ team }: { team: RawTeam }) {
  const { t } = useTranslation('teams');
  const navigate = useNavigate();

  // Member cards reuse the Agents page card design, so we need full agent rows.
  const { data, isLoading } = useAgentsList({ page_size: 200 });
  const memberIds = new Set(team.agent_ids);
  const members = (data?.items ?? []).filter((a) => memberIds.has(a.id));
  // Master first, then by name.
  members.sort((a, b) => {
    const am = a.id === team.master_agent_id;
    const bm = b.id === team.master_agent_id;
    if (am !== bm) return am ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const openAgent = (id: string) => navigate(`/agents/${encodeURIComponent(id)}/page`);

  if (isLoading) {
    return (
      <div className="grid grid-cols-4 gap-2.5 px-7 py-5">
        {Array.from({ length: team.agent_ids.length || 4 }).map((_, i) => (
          <Skeleton key={i} className="h-36 rounded-xl" />
        ))}
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <div className="p-7">
        <EmptyState
          icon={<Icon as={Users} size={24} />}
          title={t('roster.empty', 'No agents in this team')}
          description={t('roster.emptyDesc')}
        />
      </div>
    );
  }

  return (
    <div className="px-7 py-5 pb-8">
      <div className="grid grid-cols-4 gap-2.5">
        {members.map((agent) => {
          const isMaster = agent.id === team.master_agent_id;
          return (
            <div key={agent.id} className="relative">
              {isMaster ? (
                <div className="absolute right-2 top-2 z-10">
                  <MasterBadge />
                </div>
              ) : null}
              <button
                type="button"
                className="block w-full cursor-pointer text-left"
                onClick={() => openAgent(agent.id)}
                aria-label={agent.name}
              >
                <AgentCard
                  agent={toMemberCard(agent)}
                  dense
                  onOpenPage={() => openAgent(agent.id)}
                />
              </button>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-sm text-textMuted">{t('roster.masterHint')}</p>
    </div>
  );
}

/* ─── detail skeleton ────────────────────────────────────────────── */

function DetailPageSkeleton() {
  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-divider px-7 py-2.5">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="flex items-start gap-4 px-7 py-5">
        <Skeleton className="h-16 w-16 rounded-xl" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-7 w-1/2" />
          <div className="flex gap-2">
            {[80, 80, 80, 80].map((w, i) => (
              <Skeleton key={i} className="h-14 rounded-lg" style={{ width: w }} />
            ))}
          </div>
        </div>
      </div>
      <div className="flex gap-1 border-b border-divider px-7">
        {[100, 100, 100, 100].map((w, i) => (
          <Skeleton key={i} className="mb-2 h-8" style={{ width: w }} />
        ))}
      </div>
    </div>
  );
}

/* ─── main page ──────────────────────────────────────────────────── */

export function TeamDetailPage() {
  const { t } = useTranslation('teams');
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const profileId = id ?? '';

  const { getTeam, agentName, isLoading } = useTeams();
  const team = getTeam(profileId);

  // Entity counts for hero + tab badges — same hooks the tabs use (page_size:50
  // returns data.total, so no extra page_size:1 queries needed).
  const { data: expertsData } = useExpertsList({ profileId, page_size: 50 });
  const { data: conceptsData } = useConcepts({ profileId, page_size: 50 });
  const { data: rulesData } = useRules({ profileId, page_size: 50 });

  const expertsCount = expertsData?.total ?? null;
  const conceptsCount = conceptsData?.total ?? null;
  const rulesCount = rulesData?.total ?? null;
  const expertsLoading = expertsData == null;
  const conceptsLoading = conceptsData == null;
  const rulesLoading = rulesData == null;

  const tabParam = (searchParams.get('tab') as DetailTab | null) ?? 'members';
  const activeTab: DetailTab = TABS.includes(tabParam) ? tabParam : 'members';

  const setTab = (tab: DetailTab) => {
    setSearchParams({ tab }, { replace: true });
  };

  if (isLoading) return <DetailPageSkeleton />;

  if (!team) {
    return (
      <div className="flex flex-1 min-h-0 flex-col">
        <div className="flex items-center gap-3 border-b border-divider px-7 py-2.5">
          <Button variant="ghost" size="sm" onClick={() => navigate('/teams')}>
            <Icon as={ArrowLeft} size={13} />
            {t('detail.back', 'Agent Teams')}
          </Button>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-10">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: 'var(--ap-bg-2)' }}
          >
            <Icon as={Users} size={24} className="text-textMuted" />
          </div>
          <p className="text-lg font-medium text-text">
            {t('detail.notFound', 'Team not found')}
          </p>
          <p className="text-md text-textMuted">
            {t('detail.notFoundSub', { id: profileId })}
          </p>
          <Button variant="secondary" size="sm" onClick={() => navigate('/teams')}>
            <Icon as={ArrowLeft} size={13} />
            {t('detail.back', 'Agent Teams')}
          </Button>
        </div>
      </div>
    );
  }

  const memberCount = team.agent_ids.length;

  // Create scope for new concepts/rules: constrained to THIS team's profile,
  // owned by the master agent (or the first member when there is no master).
  // Undefined when the team has no members → no "New" button.
  const createAgentId = team.master_agent_id ?? team.agent_ids[0] ?? null;
  const createScope = createAgentId
    ? { profileId: team.profile_id, agentId: createAgentId }
    : undefined;
  const createScopeLabel = createAgentId
    ? `${team.profile_name} · ${agentName(createAgentId)}`
    : undefined;

  type CounterDef = {
    label: string;
    value: ReactNode;
    icon: LucideIcon;
    loading?: boolean;
  };
  const counters: CounterDef[] = [
    { label: t('counts.agents', 'Agents'), value: memberCount, icon: Users },
    {
      label: t('counts.experts', 'Experts'),
      value: expertsCount ?? '—',
      icon: Bot,
      loading: expertsLoading,
    },
    {
      label: t('counts.concepts', 'Concepts'),
      value: conceptsCount ?? '—',
      icon: Sparkles,
      loading: conceptsLoading,
    },
    {
      label: t('counts.rules', 'Rules'),
      value: rulesCount ?? '—',
      icon: Pin,
      loading: rulesLoading,
    },
  ];

  type TabDef = { id: DetailTab; label: string; count?: number | null };
  const tabs: TabDef[] = [
    { id: 'members', label: t('detail.tab.members', 'Members'), count: memberCount },
    { id: 'experts', label: t('detail.tab.experts', 'Experts'), count: expertsCount },
    { id: 'concepts', label: t('detail.tab.concepts', 'Concepts'), count: conceptsCount },
    { id: 'rules', label: t('detail.tab.rules', 'Rules'), count: rulesCount },
  ];

  return (
    <div className="relative flex flex-1 min-h-0 flex-col">
      {/* Back bar */}
      <div className="flex items-center gap-2 border-b border-divider px-7 py-2.5">
        <Button variant="ghost" size="sm" onClick={() => navigate('/teams')}>
          <Icon as={ArrowLeft} size={13} />
          {t('detail.back', 'Agent Teams')}
        </Button>
        <nav
          className="ml-2 flex items-center gap-1.5 text-sm text-textMuted"
          aria-label="Breadcrumb"
        >
          <button className="hover:text-text" onClick={() => navigate('/teams')}>
            {t('detail.back', 'Agent Teams')}
          </button>
          <span aria-hidden>/</span>
          <span className="text-text">{team.profile_name}</span>
        </nav>
      </div>

      {/* Hero */}
      <div className="flex items-start gap-4 px-7 py-5 pb-4">
        <TeamPlaque profileId={team.profile_id} name={team.profile_name} size={64} />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <h1 className="text-2xl font-semibold tracking-[-0.01em] leading-tight">
            {team.profile_name}
          </h1>
          <div
            className="grid gap-2.5"
            style={{ gridTemplateColumns: 'repeat(4, minmax(0, 160px))' }}
          >
            {counters.map((c) => (
              <CounterTile
                key={c.label}
                label={c.label}
                value={c.value}
                icon={c.icon}
                loading={c.loading}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-divider px-7">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className="relative flex items-center gap-2 px-1 pb-2.5 pt-0 text-sm font-medium transition-colors"
            style={{
              color: activeTab === tab.id ? 'var(--ap-text)' : 'var(--ap-text-muted)',
              borderBottom:
                activeTab === tab.id
                  ? '2px solid var(--ap-accent)'
                  : '2px solid transparent',
              marginBottom: -1,
              marginRight: 20,
            }}
            onClick={() => setTab(tab.id)}
            aria-selected={activeTab === tab.id}
          >
            {tab.label}
            {tab.count != null ? (
              <span
                className="tabular-nums rounded-pill border px-1.5 py-0 text-xs"
                style={{
                  fontSize: 10,
                  background: activeTab === tab.id ? 'var(--ap-bg-3)' : 'transparent',
                  borderColor: 'var(--ap-border)',
                  color: 'var(--ap-text-muted)',
                }}
              >
                {tab.count}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'members' && <MembersTab team={team} />}
        {activeTab === 'experts' && (
          <ExpertsPanel
            key={`experts-${team.profile_id}`}
            profileId={team.profile_id}
            comparisonProfileId={DEFAULT_PROFILE_ID}
            emptyTitle={t('entities.experts.empty', 'This team has no experts')}
            emptyDescription={t('entities.experts.emptyDesc')}
          />
        )}
        {activeTab === 'concepts' && (
          <ConceptsPanel
            key={`concepts-${team.profile_id}`}
            profileId={team.profile_id}
            comparisonProfileId={DEFAULT_PROFILE_ID}
            createScope={createScope}
            createScopeLabel={createScopeLabel}
            emptyTitle={t('entities.concepts.empty', 'This team has no concepts')}
            emptyDescription={t('entities.concepts.emptyDesc')}
          />
        )}
        {activeTab === 'rules' && (
          <RulesPanel
            key={`rules-${team.profile_id}`}
            profileId={team.profile_id}
            comparisonProfileId={DEFAULT_PROFILE_ID}
            createScope={createScope}
            createScopeLabel={createScopeLabel}
            emptyTitle={t('entities.rules.empty', 'This team has no rules')}
            emptyDescription={t('entities.rules.emptyDesc')}
          />
        )}
      </div>
    </div>
  );
}

export default TeamDetailPage;
