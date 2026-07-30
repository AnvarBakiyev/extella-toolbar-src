/**
 * AgentPreviewDrawer — right-edge slide-out quick-view panel (Radix Dialog
 * styled as a drawer).
 *
 * Standalone adaptations (§6 standalone):
 * - No auth/RBAC — instructions always EDIT (always shown as <pre>).
 * - Ownership badge → profile_name (no Mine/Org).
 * - Experts/Concepts/Rules mini-lists scoped to agent's (profileId, agentId) pair.
 * - No star (is_promoted), no duplicate, no chat, no MCP section.
 * - No delete action — deletion lives only on the full agent page.
 * - Top chrome: "Agent · <id>" + [Open page] + [✕].
 */

import { type ReactNode } from 'react';
import { ExternalLink, Sparkles, Wrench, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/lib/icon';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerClose, DrawerContent } from '@/components/ui/Drawer';
import { Skeleton } from '@/components/ui/skeleton';
import { useAgent } from '../hooks/useAgent';
import { useAgentTopology } from '@/features/shared/useTopology';
import { useExpertsList } from '@/features/experts/hooks/useExpertsList';
import { useConcepts } from '@/features/concepts/hooks/useConcepts';
import { useRules } from '@/features/rules/hooks/useRules';
import { AgentAvatar } from './AgentAvatar';
import { ProviderBadge } from './ProviderBadge';
import { TeamMembershipChips } from '@/features/teams/components/TeamMembershipChips';
import { useTeams } from '@/features/teams/hooks/useTeams';
import type { AgentDetail } from '../schemas';

export interface AgentPreviewDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  /** Called when the [Open page] button is clicked. */
  onOpenPage?: (agentId: string) => void;
}

/* ─── section ────────────────────────────────────────────────────── */

interface DrawerSectionProps {
  title: string;
  count?: number;
  children: ReactNode;
}

function DrawerSection({ title, count, children }: DrawerSectionProps) {
  return (
    <section className="border-t border-divider px-5 py-4">
      <div className="mb-2.5 text-xs font-medium uppercase tracking-[0.04em] text-textFaint">
        {title}
        {count != null ? <span className="ml-1.5">· {count}</span> : null}
      </div>
      {children}
    </section>
  );
}

/* ─── skeleton ───────────────────────────────────────────────────── */

function DrawerSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-5 pt-5">
      <div className="flex items-start gap-3">
        <Skeleton className="h-13 w-13 rounded-xl" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
      <Skeleton className="mt-2 h-12 w-full" />
      <div className="mt-1 flex flex-col gap-2">
        {[80, 60, 40, 70, 50].map((w, i) => (
          <Skeleton key={i} className="h-3" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}

/* ─── experts mini-list ──────────────────────────────────────────── */

interface ExpertsMiniListProps {
  profileId: string;
  agentId: string;
}

function ExpertsMiniList({ profileId, agentId }: ExpertsMiniListProps) {
  const { t } = useTranslation('agents');
  const { data, isLoading } = useExpertsList({ profileId, agentId, page_size: 5 });
  const items = data?.items ?? [];

  if (isLoading) return <Skeleton className="h-8 w-full" />;
  if (items.length === 0) {
    return (
      <p className="text-sm text-textFaint">
        {t('drawer.experts.empty', 'No experts for this agent.')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {items.slice(0, 5).map((e) => (
        <div
          key={e.id}
          className="flex items-center gap-2 rounded-md border border-border bg-bgCard px-2.5 py-1.5 text-sm"
        >
          <span className="flex-1 truncate font-medium">{e.name}</span>
          {e.type ? (
            <span className="text-xs text-textFaint">{e.type}</span>
          ) : null}
        </div>
      ))}
      {(data?.total ?? 0) > 5 ? (
        <p className="text-xs text-textFaint">
          {t('drawer.experts.more', '+{{count}} more', { count: (data?.total ?? 0) - 5 })}
        </p>
      ) : null}
    </div>
  );
}

/* ─── concepts mini-list ─────────────────────────────────────────── */

interface ConceptsMiniListProps {
  profileId: string;
  agentId: string;
}

function ConceptsMiniList({ profileId, agentId }: ConceptsMiniListProps) {
  const { t } = useTranslation('agents');
  const { data, isLoading } = useConcepts({ profileId, agentId, page_size: 4 });
  const items = data?.items ?? [];

  if (isLoading) return <Skeleton className="h-8 w-full" />;
  if (items.length === 0) {
    return (
      <p className="text-sm text-textFaint">
        {t('drawer.concepts.empty', 'No concepts for this agent.')}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {items.slice(0, 4).map((c) => (
        <span
          key={c.id}
          className="inline-flex h-5 max-w-[160px] items-center truncate rounded-pill px-2 text-xs font-medium"
          style={{ background: 'var(--ap-bg-3)', color: 'var(--ap-text)' }}
          title={c.text.slice(0, 60)}
        >
          {c.text.split('\n')[0].slice(0, 40) || 'Untitled'}
        </span>
      ))}
      {(data?.total ?? 0) > 4 ? (
        <span className="text-xs text-textFaint">
          +{(data?.total ?? 0) - 4}
        </span>
      ) : null}
    </div>
  );
}

/* ─── rules mini-list ────────────────────────────────────────────── */

interface RulesMiniListProps {
  profileId: string;
  agentId: string;
}

function RulesMiniList({ profileId, agentId }: RulesMiniListProps) {
  const { t } = useTranslation('agents');
  const { data, isLoading } = useRules({ profileId, agentId, page_size: 4 });
  const items = data?.items ?? [];

  if (isLoading) return <Skeleton className="h-8 w-full" />;
  if (items.length === 0) {
    return (
      <p className="text-sm text-textFaint">
        {t('drawer.rules.empty', 'No pinned rules for this agent.')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {items.slice(0, 4).map((r) => (
        <div
          key={r.id}
          className="flex items-center gap-2 rounded-md border border-border bg-bgCard px-2.5 py-1.5 text-sm"
        >
          <span className="flex-1 truncate">
            {r.text.split('\n')[0].slice(0, 60) || 'Untitled'}
          </span>
        </div>
      ))}
      {(data?.total ?? 0) > 4 ? (
        <p className="text-xs text-textFaint">
          +{(data?.total ?? 0) - 4} more
        </p>
      ) : null}
    </div>
  );
}

/* ─── main component ─────────────────────────────────────────────── */

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

function formatParam(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

interface FullDrawerContentProps {
  agent: AgentDetail;
}

function FullDrawerContent({ agent }: FullDrawerContentProps) {
  const { t: tCommon } = useTranslation('common');
  const { t } = useTranslation('agents');

  // Resolve (profileId, agentId) for scoped entity queries.
  // POST /api/agent/get does NOT return the agent's membership profile_id,
  // so agent.profile_id is almost always null. Resolve via topology teams
  // instead, falling back to 'default' when the agent is in no team.
  const agentId = agent.id;
  const { data: topoData } = useAgentTopology();
  const { teamsOfAgent } = useTeams();
  const memberTeams = teamsOfAgent(agentId);
  const profileId: string = (() => {
    if (!topoData) return 'default';
    for (const team of topoData.teams) {
      if (team.agent_ids.includes(agentId)) return team.profile_id;
    }
    return 'default';
  })();

  const temperature = agent.model_parameters &&
    typeof agent.model_parameters === 'object' &&
    'temperature' in agent.model_parameters
    ? (agent.model_parameters as Record<string, unknown>)['temperature']
    : null;

  return (
    <>
      {/* HERO */}
      <div className="px-5 pb-4 pt-[18px]">
        {/* avatar + name */}
        <div className="mb-3.5 flex min-w-0 items-start gap-3.5">
          <AgentAvatar name={agent.name} category={agent.category} size={52} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 className="flex-1 min-w-0 truncate text-xl font-semibold tracking-[-0.01em]">
              {agent.name}
            </h2>
            {/* profile + team memberships */}
            {agent.profile_name || memberTeams.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {agent.profile_name ? (
                  <span
                    className="inline-flex h-5 items-center rounded-pill border border-border px-1.5 text-xs font-medium text-textMuted"
                    title={tCommon('meta.profile')}
                  >
                    {agent.profile_name}
                  </span>
                ) : null}
                <TeamMembershipChips teams={memberTeams} />
              </div>
            ) : null}
          </div>
        </div>

        {/* description */}
        <p className="mb-3.5 text-base leading-relaxed text-text">
          {agent.description || (
            <span className="italic text-textFaint">
              {t('card.noDescription', 'No description')}
            </span>
          )}
        </p>
      </div>

      {/* MODEL STRIP */}
      <DrawerSection title={t('drawer.model', 'Model')}>
        <div className="flex flex-wrap items-center gap-2">
          <ProviderBadge provider={agent.provider} />
          {agent.model ? (
            <span
              className="text-sm font-medium"
              style={{ fontFamily: 'var(--ap-font-mono)' }}
            >
              {agent.model}
            </span>
          ) : null}
        </div>
        {(temperature != null || agent.recursion_limit != null) ? (
          <div className="mt-2 flex flex-wrap gap-3 text-sm">
            {temperature != null ? (
              <span className="text-textMuted">
                temperature{' '}
                <span className="tabular-nums text-text">
                  {typeof temperature === 'number' ? temperature.toFixed(2) : String(temperature)}
                </span>
              </span>
            ) : null}
            {agent.recursion_limit != null ? (
              <span className="text-textMuted">
                recursion{' '}
                <span className="tabular-nums text-text">{agent.recursion_limit}</span>
              </span>
            ) : null}
          </div>
        ) : null}
      </DrawerSection>

      {/* CONVERSATION STARTERS */}
      {agent.conversation_starters && agent.conversation_starters.length > 0 ? (
        <DrawerSection
          title={t('drawer.conversationStarters', 'Conversation starters')}
          count={agent.conversation_starters.length}
        >
          <ul className="flex flex-col gap-1.5">
            {agent.conversation_starters.map((starter, idx) => (
              <li
                key={`${idx}-${starter}`}
                className="flex items-start gap-2 rounded-md border border-border bg-bgCard px-2.5 py-1.5 text-sm"
              >
                <Icon as={Sparkles} size={12} className="mt-0.5 shrink-0 text-textMuted" />
                <span className="min-w-0 flex-1 truncate">{starter}</span>
              </li>
            ))}
          </ul>
        </DrawerSection>
      ) : null}

      {/* INSTRUCTIONS — always shown in standalone (always EDIT per §6) */}
      {agent.instructions ? (
        <DrawerSection title={t('drawer.instructions', 'Instructions')}>
          <pre
            className="rounded-md border border-divider bg-bg3 p-3 text-xs"
            style={{
              margin: 0,
              fontFamily: 'var(--ap-font-mono)',
              lineHeight: 1.55,
              maxHeight: 220,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: 'var(--ap-text)',
            }}
          >
            {agent.instructions}
          </pre>
        </DrawerSection>
      ) : null}

      {/* TOOLS */}
      <DrawerSection title={t('drawer.tools', 'Tools')} count={agent.tools?.length ?? 0}>
        {!agent.tools || agent.tools.length === 0 ? (
          <p className="text-sm text-textFaint">
            {t('drawer.tools.empty', 'No tools enabled.')}
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {agent.tools.map((tool) => (
              <span
                key={tool}
                className="inline-flex h-6 items-center gap-1.5 rounded-pill border border-border bg-bgCard px-2 text-xs text-text"
                style={{ fontFamily: 'var(--ap-font-mono)' }}
                title={tool}
              >
                <Icon as={Wrench} size={11} className="text-iconMuted" />
                {tool}
              </span>
            ))}
          </div>
        )}
      </DrawerSection>

      {/* EXPERTS */}
      <DrawerSection title={t('drawer.experts', 'Experts')}>
        <ExpertsMiniList profileId={profileId} agentId={agentId} />
      </DrawerSection>

      {/* CONCEPTS */}
      <DrawerSection title={t('drawer.concepts', 'Concepts')}>
        <ConceptsMiniList profileId={profileId} agentId={agentId} />
      </DrawerSection>

      {/* PINNED RULES */}
      <DrawerSection title={t('drawer.rules', 'Pinned rules')}>
        <RulesMiniList profileId={profileId} agentId={agentId} />
      </DrawerSection>

      {/* METADATA */}
      <DrawerSection title={t('drawer.metadata', 'Metadata')}>
        <div
          className="grid text-sm"
          style={{ gridTemplateColumns: 'auto 1fr', gap: '8px 12px' }}
        >
          <span className="text-textMuted">{tCommon('meta.created')}</span>
          <span>{formatDate(agent.created_at)}</span>
          <span className="text-textMuted">{tCommon('meta.updated')}</span>
          <span>
            {formatDate(agent.updated_at)}
            {agent.version != null ? ` · v${agent.version}` : ''}
          </span>
          {agent.profile_name ? (
            <>
              <span className="text-textMuted">{tCommon('meta.profile')}</span>
              <span>{agent.profile_name}</span>
            </>
          ) : null}
        </div>
      </DrawerSection>
    </>
  );
}

/* ─── exported component ─────────────────────────────────────────── */

export function AgentPreviewDrawer({
  open,
  onOpenChange,
  agentId,
  onOpenPage,
}: AgentPreviewDrawerProps) {
  const { t } = useTranslation('agents');
  const { data: agent, isLoading, isError } = useAgent(agentId);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent width={480}>
        {/* Top chrome */}
        <div className="flex min-h-11 items-center gap-2 border-b border-divider px-3.5 py-2.5">
          <span className="text-xs text-textFaint" style={{ fontFamily: 'var(--ap-font-mono)' }}>
            Agent{agentId ? ` · ${agentId}` : ''}
          </span>
          <div className="flex-1" />
          {onOpenPage && agent ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                // Navigate to the full agent page. Do NOT also call
                // onOpenChange(false) — that fires closePreview() →
                // navigate('/agents', { replace: true }), which would clobber
                // this navigation and strand the user on the list. The drawer
                // unmounts on its own once the route changes to /agents/:id/page.
                onOpenPage(agent.id);
              }}
              title={t('actions.openPage', 'Open page')}
            >
              <Icon as={ExternalLink} size={13} />
              {t('actions.openPage', 'Open page')}
            </Button>
          ) : null}
          <DrawerClose asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t('actions.close', 'Close')}>
              <Icon as={X} size={14} />
            </Button>
          </DrawerClose>
        </div>

        {/* Scroll body */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <DrawerSkeleton />
          ) : isError ? (
            <div className="p-5">
              <p className="text-sm text-danger">
                {t('drawer.loadFailed', 'Failed to load agent. Try again.')}
              </p>
            </div>
          ) : agent ? (
            <FullDrawerContent agent={agent} />
          ) : null}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
