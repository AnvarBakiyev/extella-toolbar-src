/**
 * AgentDetailPage — full agent detail at /agents/:id/page
 *
 * Two-belt layout (v3 design):
 *   - Belt 1 "Agent settings" (permanent): tabs Overview / Tools, with the
 *     active tab's content rendered immediately below the belt.
 *   - Belt 2 "Experts, concepts & rules" (context-scoped): a prominent context
 *     band with the team/profile selector, then tabs Experts / Concepts /
 *     Pinned rules whose content (paginated, openable detail) is rendered
 *     immediately below — scoped to the selected (profile, agent).
 *
 * The scoped tabs reuse the shared <ExpertsPanel>/<ConceptsPanel>/<RulesPanel>
 * (same building blocks as each entity's top-level section: ExpertCard +
 * ExpertPreviewDrawer, ConceptsTable/RulesTable + RCDetailDialog, Pagination).
 *
 * URL: /agents/:id/page?tab=overview|tools&etab=experts|concepts|rules
 */

import { useState, useCallback, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Layers,
  Sliders,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/lib/icon';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { DeleteByNameDialog } from '@/components/layout/DeleteByNameDialog';
import { useAgent } from '../hooks/useAgent';
import { useDeleteAgent } from '../hooks/useDeleteAgent';
import { useTeams } from '@/features/teams/hooks/useTeams';
import { TeamMembershipChips } from '@/features/teams/components/TeamMembershipChips';
import { ScopeSelect, buildScopeOptions } from '../components/ScopeSelect';
import { AgentAvatar } from '../components/AgentAvatar';
import { ProviderBadge } from '../components/ProviderBadge';
import { useExpertsList } from '@/features/experts/hooks/useExpertsList';
import { useConcepts } from '@/features/concepts/hooks/useConcepts';
import { useRules } from '@/features/rules/hooks/useRules';
import { ExpertsPanel, ConceptsPanel, RulesPanel } from '@/features/shared/ScopedEntityPanels';
import type { AgentDetail } from '../schemas';

/* ─── helpers ────────────────────────────────────────────────────── */

type SettingsTab = 'overview' | 'tools';
type EntitiesTab = 'experts' | 'concepts' | 'rules';

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

/* ─── MetaCol ────────────────────────────────────────────────────── */

interface MetaColProps {
  label: string;
  children: ReactNode;
}

function MetaCol({ label, children }: MetaColProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-[0.04em] text-textFaint">
        {label}
      </span>
      <span className="overflow-hidden text-ellipsis whitespace-nowrap text-md text-text">
        {children}
      </span>
    </div>
  );
}

/* ─── SidebarBlock ───────────────────────────────────────────────── */

interface SidebarBlockProps {
  title: string;
  children: ReactNode;
}

function SidebarBlock({ title, children }: SidebarBlockProps) {
  return (
    <div className="rounded-lg border border-border bg-bgCard p-3.5">
      <div className="mb-3 text-xs font-medium uppercase tracking-[0.04em] text-textFaint">
        {title}
      </div>
      {children}
    </div>
  );
}

/* ─── EmptySlot ──────────────────────────────────────────────────── */

interface EmptySlotProps {
  label: string;
  subtitle?: string;
}

function EmptySlot({ label, subtitle }: EmptySlotProps) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-bgInset px-6 py-8 text-center">
      <div
        className="flex h-9 w-9 items-center justify-center rounded-[10px]"
        style={{ background: 'var(--ap-bg-3)', color: 'var(--ap-text-muted)' }}
      >
        <Sliders className="h-4 w-4" strokeWidth={1.5} />
      </div>
      <p className="text-md font-medium text-text">{label}</p>
      {subtitle ? (
        <p className="max-w-sm text-sm text-textMuted">{subtitle}</p>
      ) : null}
    </div>
  );
}

/* ─── OverviewTab ────────────────────────────────────────────────── */

function OverviewTab({ agent }: { agent: AgentDetail }) {
  const { t: tCommon } = useTranslation('common');
  const temperature =
    agent.model_parameters &&
    typeof agent.model_parameters === 'object' &&
    'temperature' in agent.model_parameters
      ? (agent.model_parameters as Record<string, unknown>)['temperature']
      : null;

  return (
    <div className="p-7 pb-8">
      <div
        className="grid gap-6"
        style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' }}
      >
        {/* 2/3 — Instructions */}
        <div>
          <h2 className="mb-3 text-xl font-semibold">System instructions</h2>
          {agent.instructions ? (
            <pre
              className="rounded-lg border border-border bg-bgInset p-4 text-sm"
              style={{
                margin: 0,
                fontFamily: 'var(--ap-font-mono)',
                lineHeight: 1.55,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: 'var(--ap-text)',
              }}
            >
              {agent.instructions}
            </pre>
          ) : (
            <EmptySlot label="No instructions" subtitle="This agent has no system instructions configured." />
          )}
        </div>

        {/* 1/3 — Starters + Behavior + Provenance */}
        <div className="flex flex-col gap-4">
          {/* Conversation starters */}
          {agent.conversation_starters && agent.conversation_starters.length > 0 ? (
            <SidebarBlock title="Conversation starters">
              <ul className="flex flex-col gap-1.5">
                {agent.conversation_starters.map((s, i) => (
                  <li
                    key={`${i}-${s}`}
                    className="flex items-start gap-2 rounded-md border border-border bg-bgCard px-2.5 py-1.5 text-sm"
                  >
                    <Icon as={Sparkles} size={12} className="mt-0.5 shrink-0 text-textMuted" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </SidebarBlock>
          ) : null}

          {/* Behavior */}
          <SidebarBlock title="Behavior">
            <div
              className="grid text-sm"
              style={{ gridTemplateColumns: 'auto 1fr', gap: '8px 12px' }}
            >
              {agent.recursion_limit != null ? (
                <>
                  <span className="text-textMuted">recursion_limit</span>
                  <span className="tabular-nums">{agent.recursion_limit}</span>
                </>
              ) : null}
              {agent.hide_sequential_outputs != null ? (
                <>
                  <span className="text-textMuted">hide_sequential_outputs</span>
                  <span>{agent.hide_sequential_outputs ? 'yes' : 'no'}</span>
                </>
              ) : null}
              {agent.end_after_tools != null ? (
                <>
                  <span className="text-textMuted">end_after_tools</span>
                  <span>{agent.end_after_tools ? 'yes' : 'no'}</span>
                </>
              ) : null}
              {temperature != null ? (
                <>
                  <span className="text-textMuted">temperature</span>
                  <span className="tabular-nums">
                    {typeof temperature === 'number' ? temperature.toFixed(2) : String(temperature)}
                  </span>
                </>
              ) : null}
              {agent.recursion_limit == null && agent.hide_sequential_outputs == null &&
               agent.end_after_tools == null && temperature == null ? (
                <span className="col-span-2 text-textFaint text-xs">No behavior flags set</span>
              ) : null}
            </div>
          </SidebarBlock>

          {/* Provenance */}
          <SidebarBlock title="Provenance">
            <div
              className="grid text-sm"
              style={{ gridTemplateColumns: 'auto 1fr', gap: '8px 12px' }}
            >
              <span className="text-textMuted">{tCommon('meta.created')}</span>
              <span>{formatDate(agent.created_at)}</span>
              <span className="text-textMuted">{tCommon('meta.updated')}</span>
              <span>{formatDate(agent.updated_at)}</span>
              {agent.version != null ? (
                <>
                  <span className="text-textMuted">{tCommon('columns.version')}</span>
                  <span className="tabular-nums">v{agent.version}</span>
                </>
              ) : null}
              {agent.profile_name ? (
                <>
                  <span className="text-textMuted">{tCommon('meta.profile')}</span>
                  <span>{agent.profile_name}</span>
                </>
              ) : null}
            </div>
          </SidebarBlock>
        </div>
      </div>
    </div>
  );
}

/* ─── ToolsTab ───────────────────────────────────────────────────── */

const BUILTIN_TOOLS = [
  'file_search', 'execute_code', 'web_browser', 'image_gen', 'calculator',
  'calendar', 'email', 'wolfram',
];

interface ToolTileProps {
  id: string;
  on: boolean;
}

function ToolTile({ id, on }: ToolTileProps) {
  return (
    <div
      className="flex items-center gap-2.5 rounded-md border border-border px-3 py-2.5"
      style={{
        background: on ? 'var(--ap-bg-card)' : 'var(--ap-bg-inset)',
        opacity: on ? 1 : 0.5,
      }}
    >
      <span
        className="flex h-6 w-6 items-center justify-center rounded-md"
        style={{
          background: on ? 'var(--ap-bg-3)' : 'transparent',
          color: on ? 'var(--ap-text)' : 'var(--ap-text-faint)',
        }}
      >
        <Sliders className="h-3.5 w-3.5" strokeWidth={1.5} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span
          className="text-sm font-medium"
          style={{ fontFamily: 'var(--ap-font-mono)' }}
        >
          {id}
        </span>
        <span className="text-xs text-textFaint">{on ? 'enabled' : 'disabled'}</span>
      </div>
    </div>
  );
}

function ToolsTab({ agent }: { agent: AgentDetail }) {
  const active = new Set(agent.tools ?? []);

  return (
    <div className="p-7 pb-8">
      <h2 className="mb-4 text-xl font-semibold">
        Built-in tools
        <span className="ml-2 text-base font-normal text-textFaint">
          · {agent.tools?.length ?? 0} enabled
        </span>
      </h2>
      <div
        className="grid gap-2.5"
        style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}
      >
        {BUILTIN_TOOLS.map((tool) => (
          <ToolTile key={tool} id={tool} on={active.has(tool)} />
        ))}
      </div>

      {/* tool_options raw block if present */}
      {agent.tool_options && Object.keys(agent.tool_options).length > 0 ? (
        <div className="mt-6">
          <h2 className="mb-3 text-xl font-semibold">Tool options</h2>
          <pre
            className="rounded-lg border border-border bg-bgInset p-4 text-sm"
            style={{
              margin: 0,
              fontFamily: 'var(--ap-font-mono)',
              lineHeight: 1.55,
              color: 'var(--ap-text-muted)',
            }}
          >
            {JSON.stringify(agent.tool_options, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

/* ─── TabButton ──────────────────────────────────────────────────── */

interface TabButtonProps {
  label: string;
  count?: number | null;
  active: boolean;
  onClick: () => void;
}

function TabButton({ label, count, active, onClick }: TabButtonProps) {
  return (
    <button
      className="relative flex items-center gap-2 px-1 pb-2.5 pt-0 text-sm font-medium transition-colors"
      style={{
        color: active ? 'var(--ap-text)' : 'var(--ap-text-muted)',
        borderBottom: active ? '2px solid var(--ap-accent)' : '2px solid transparent',
        marginBottom: -1,
        marginRight: 20,
      }}
      onClick={onClick}
      aria-selected={active}
    >
      {label}
      {count != null ? (
        <span
          className="tabular-nums rounded-pill border px-1.5 py-0 text-xs"
          style={{
            fontSize: 10,
            background: active ? 'var(--ap-bg-3)' : 'transparent',
            borderColor: 'var(--ap-border)',
            color: 'var(--ap-text-muted)',
          }}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

/* ─── ZoneHeader ─────────────────────────────────────────────────── */

function ZoneHeader({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-7 pb-1 pt-4">
      <span className="text-xs font-semibold uppercase tracking-[0.06em] text-textFaint">
        {children}
      </span>
    </div>
  );
}

/* ─── detail skeleton ────────────────────────────────────────────── */

function DetailPageSkeleton() {
  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {/* back bar */}
      <div className="flex items-center gap-3 border-b border-divider px-7 py-2.5">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-4 w-48" />
        <div className="ml-auto">
          <Skeleton className="h-7 w-16" />
        </div>
      </div>
      {/* hero */}
      <div className="flex items-start gap-4 px-7 py-5">
        <Skeleton className="h-18 w-18 rounded-xl" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-7 w-1/2" />
          <Skeleton className="h-4 w-5/6" />
          <div className="flex gap-1.5">
            <Skeleton className="h-5 w-16 rounded-pill" />
            <Skeleton className="h-5 w-20 rounded-pill" />
          </div>
        </div>
      </div>
      {/* meta strip */}
      <Skeleton className="mx-7 mb-4 h-14 rounded-lg" />
      {/* tabs */}
      <div className="flex gap-1 border-b border-divider px-7">
        {[100, 80].map((w, i) => (
          <Skeleton key={i} className="mb-2 h-8" style={{ width: w }} />
        ))}
      </div>
    </div>
  );
}

/* ─── main page ──────────────────────────────────────────────────── */

export function AgentDetailPage() {
  const { t } = useTranslation('agents');
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const agentId = id ?? '';

  const { data: agent, isLoading, isError } = useAgent(agentId);

  // Belt 2 context selector — the agent's Experts / Concepts / Rules are scoped
  // per (profile, agent), so it carries one set under the Default profile and a
  // (possibly different) set inside each team it belongs to. `scope` is the
  // selected profile_id; changing it re-queries (react-query keys include it).
  const { teams, teamsOfAgent } = useTeams();
  const options = buildScopeOptions(
    agentId,
    teams,
    t('detail.context.default', 'Default profile'),
  );
  const [scope, setScope] = useState<string>('default');
  const [scopeOpen, setScopeOpen] = useState(false);

  // Cheap count queries to fill the scoped tab badges.
  const { data: expertsData } = useExpertsList({ profileId: scope, agentId, page_size: 1 });
  const { data: conceptsData } = useConcepts({ profileId: scope, agentId, page_size: 1 });
  const { data: rulesData } = useRules({ profileId: scope, agentId, page_size: 1 });
  const expertsCount = expertsData?.total ?? null;
  const conceptsCount = conceptsData?.total ?? null;
  const rulesCount = rulesData?.total ?? null;

  // Two independent tab selections, both synced to the URL.
  const settingsTab: SettingsTab = searchParams.get('tab') === 'tools' ? 'tools' : 'overview';
  const etabParam = searchParams.get('etab');
  const entitiesTab: EntitiesTab =
    etabParam === 'concepts' ? 'concepts' : etabParam === 'rules' ? 'rules' : 'experts';

  const setSettingsTab = (tab: SettingsTab) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };
  const setEntitiesTab = (tab: EntitiesTab) => {
    const next = new URLSearchParams(searchParams);
    next.set('etab', tab);
    setSearchParams(next, { replace: true });
  };

  // ── Delete ──
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const deleteMutation = useDeleteAgent();

  const confirmDelete = useCallback(async () => {
    if (!agent) return;
    try {
      await deleteMutation.mutateAsync({
        agentId: agent.id,
        profileId: agent.profile_id ?? undefined,
        agentScopeId: agent.agent_id ?? undefined,
      });
      navigate('/agents', { replace: true });
    } catch {
      /* toast already fired */
    }
  }, [agent, deleteMutation, navigate]);

  if (isLoading) return <DetailPageSkeleton />;

  if (isError || !agent) {
    return (
      <div className="flex flex-1 min-h-0 flex-col">
        <div className="flex items-center gap-3 border-b border-divider px-7 py-2.5">
          <Button variant="ghost" size="sm" onClick={() => navigate('/agents')}>
            <Icon as={ArrowLeft} size={13} />
            {t('detail.backToList', 'To list')}
          </Button>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-10">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: 'var(--ap-bg-2)' }}
          >
            <Sliders className="h-6 w-6 text-textMuted" strokeWidth={1.5} />
          </div>
          <p className="text-lg font-medium text-text">
            {t('detail.notFound', 'Agent not found')}
          </p>
          <p className="text-md text-textMuted">
            {t('detail.notFoundSub', 'The agent with id "{{id}}" does not exist or was deleted.', { id: agentId })}
          </p>
          <Button variant="secondary" size="sm" onClick={() => navigate('/agents')}>
            <Icon as={ArrowLeft} size={13} />
            {t('detail.backToList', 'To list')}
          </Button>
        </div>
      </div>
    );
  }

  const temperature =
    agent.model_parameters &&
    typeof agent.model_parameters === 'object' &&
    'temperature' in agent.model_parameters
      ? (agent.model_parameters as Record<string, unknown>)['temperature']
      : null;

  return (
    <div className="relative flex flex-1 min-h-0 flex-col">
      {/* Back bar */}
      <div className="flex items-center gap-2 border-b border-divider px-7 py-2.5">
        <Button variant="ghost" size="sm" onClick={() => navigate('/agents')}>
          <Icon as={ArrowLeft} size={13} />
          {t('detail.backToList', 'To list')}
        </Button>
        <nav className="ml-2 flex items-center gap-1.5 text-sm text-textMuted" aria-label="Breadcrumb">
          <button className="hover:text-text" onClick={() => navigate('/agents')}>
            {t('list.title', 'Agents')}
          </button>
          <span aria-hidden>/</span>
          <span className="text-text">{agent.name}</span>
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="text-danger hover:bg-dangerSoft hover:text-danger"
            onClick={() => setShowDeleteDialog(true)}
          >
            <Icon as={Trash2} size={13} />
            {t('actions.delete', 'Delete')}
          </Button>
        </div>
      </div>

      {/* Hero */}
      <div className="flex items-start gap-4 px-7 py-5 pb-4">
        <AgentAvatar name={agent.name} category={agent.category} size={72} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-[-0.01em] leading-tight">
            {agent.name}
          </h1>
          <p className="max-w-[720px] leading-relaxed text-textMuted text-base">
            {agent.description || (
              <span className="italic text-textFaint">
                {t('card.noDescription', 'No description')}
              </span>
            )}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {agent.profile_name ? (
              <span className="inline-flex h-5 items-center rounded-pill border border-border px-1.5 text-xs font-medium text-textMuted">
                {agent.profile_name}
              </span>
            ) : null}
            <span className="text-xs font-medium uppercase tracking-[0.04em] text-textFaint">
              {t('membership.label', 'Teams')}
            </span>
            <TeamMembershipChips
              teams={teamsOfAgent(agent.id)}
              showEmpty
              emptyLabel={t('membership.none', 'No team')}
            />
          </div>
        </div>
      </div>

      {/* Meta strip */}
      <div
        className="mx-7 mb-2 grid gap-4 rounded-lg border border-border bg-bgCard px-4 py-3"
        style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' }}
      >
        <MetaCol label="Provider">
          <ProviderBadge provider={agent.provider} />
        </MetaCol>
        <MetaCol label="Model">
          <span style={{ fontFamily: 'var(--ap-font-mono)' }}>
            {agent.model ?? '—'}
          </span>
        </MetaCol>
        <MetaCol label="Temp">
          <span className="tabular-nums">
            {temperature != null
              ? (typeof temperature === 'number' ? temperature.toFixed(2) : String(temperature))
              : '—'}
          </span>
        </MetaCol>
        <MetaCol label="Recursion">
          <span className="tabular-nums">{agent.recursion_limit ?? '—'}</span>
        </MetaCol>
        <MetaCol label="Version">
          {agent.version != null ? `v${agent.version}` : '—'}
        </MetaCol>
        <MetaCol label="Updated">
          {formatDate(agent.updated_at)}
        </MetaCol>
      </div>

      {/* Scrollable belts */}
      <div className="flex-1 overflow-y-auto">
        {/* ── Belt 1 — Agent settings (permanent) ── */}
        <ZoneHeader>{t('detail.belt.settings', 'Agent settings')}</ZoneHeader>
        <div className="flex border-b border-divider px-7">
          <TabButton
            label={t('detail.tab.overview', 'Overview')}
            active={settingsTab === 'overview'}
            onClick={() => setSettingsTab('overview')}
          />
          <TabButton
            label={t('detail.tab.tools', 'Tools')}
            count={agent.tools?.length ?? 0}
            active={settingsTab === 'tools'}
            onClick={() => setSettingsTab('tools')}
          />
        </div>
        {settingsTab === 'overview' ? <OverviewTab agent={agent} /> : <ToolsTab agent={agent} />}

        {/* ── Belt 2 — Experts, concepts & rules (context-scoped) ── */}
        {/* Prominent context band */}
        <div
          className="mx-7 mt-2 mb-3 flex items-center justify-between gap-3 rounded-lg border px-4 py-3"
          style={{ background: 'var(--ap-accent-soft)', borderColor: 'var(--ap-accent-border)' }}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
              style={{ background: 'var(--ap-accent-bg)', color: 'var(--ap-accent)' }}
            >
              <Icon as={Layers} size={15} />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-text">
                {t('detail.belt.scoped', 'Experts, concepts & rules')}
              </div>
              <div className="truncate text-xs text-textMuted">
                {t(
                  'detail.context.hint',
                  'These entities are scoped to the selected context — switch context to see a different set.',
                )}
              </div>
            </div>
          </div>
          <ScopeSelect
            label={t('detail.context.label', 'Team')}
            options={options}
            value={scope}
            onChange={setScope}
            open={scopeOpen}
            onOpenChange={setScopeOpen}
          />
        </div>

        <div className="flex border-b border-divider px-7">
          <TabButton
            label={t('detail.tab.experts', 'Experts')}
            count={expertsCount}
            active={entitiesTab === 'experts'}
            onClick={() => setEntitiesTab('experts')}
          />
          <TabButton
            label={t('detail.tab.concepts', 'Concepts')}
            count={conceptsCount}
            active={entitiesTab === 'concepts'}
            onClick={() => setEntitiesTab('concepts')}
          />
          <TabButton
            label={t('detail.tab.rules', 'Pinned rules')}
            count={rulesCount}
            active={entitiesTab === 'rules'}
            onClick={() => setEntitiesTab('rules')}
          />
        </div>

        {/* key={scope} remounts on context switch → resets page + closes dialogs */}
        {entitiesTab === 'experts' && (
          <ExpertsPanel
            key={`experts-${scope}`}
            profileId={scope}
            agentId={agentId}
            emptyTitle={t('detail.experts.empty', 'This agent uses no experts')}
            emptyDescription={t('detail.experts.emptySub', 'Experts linked to this agent will appear here.')}
          />
        )}
        {entitiesTab === 'concepts' && (
          <ConceptsPanel
            key={`concepts-${scope}`}
            profileId={scope}
            agentId={agentId}
            emptyTitle={t('detail.concepts.empty', 'This agent has no concepts')}
            emptyDescription={t('detail.concepts.emptySub', 'Concepts linked to this agent will appear here.')}
          />
        )}
        {entitiesTab === 'rules' && (
          <RulesPanel
            key={`rules-${scope}`}
            profileId={scope}
            agentId={agentId}
            emptyTitle={t('detail.rules.empty', 'No pinned rules for this agent')}
            emptyDescription={t('detail.rules.emptySub', 'Rules pinned to this agent will appear here.')}
          />
        )}
      </div>

      {/* Delete confirmation — requires typing the agent name */}
      <DeleteByNameDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        expectedName={agent.name}
        title={t('delete.title', 'Delete agent?')}
        description={t('delete.description', {
          name: agent.name,
          defaultValue: 'Agent "{{name}}" will be permanently deleted. This cannot be undone.',
        })}
        confirmLabel={
          deleteMutation.isPending
            ? t('delete.deleting', 'Deleting…')
            : t('delete.confirm', 'Delete')
        }
        cancelLabel={t('delete.cancel', 'Cancel')}
        loading={deleteMutation.isPending}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

export default AgentDetailPage;
