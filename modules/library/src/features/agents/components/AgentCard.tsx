/**
 * AgentCard — grid card with category-colored left rail.
 *
 * Per contract §2 (standalone adaptation):
 * - Left rail = category color
 * - Avatar = category-colored initials (no avatar field)
 * - Title, provider chip + model (mono), description (2-line clamp)
 * - Badge row = category badge + tools-count badge only (no MCP / skills / subagents)
 * - Footer = profile_name + updated_at
 * - No star (is_promoted hidden)
 * - Hover CTA = "Open page" only (navigate to detail)
 */

import { ExternalLink, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/lib/icon';
import { AgentAvatar } from './AgentAvatar';
import { AGENT_CATEGORY_COLORS } from './AgentCategoryBadge';
import { ProviderBadge } from './ProviderBadge';

export interface AgentCardData {
  id: string;
  name: string;
  description: string;
  provider: string | null | undefined;
  model: string | null | undefined;
  toolsCount: number;
  isPublic?: boolean | null;
  date?: string;
  /** category used for avatar color and category badge */
  category?: string | null;
  /** profile_name shown in footer (standalone replaces "Mine/Org") */
  profileName?: string | null;
}

export interface AgentCardProps {
  agent: AgentCardData;
  dense?: boolean;
  /** When provided, clicking "Open page" calls this instead of rendering a link */
  onOpenPage?: () => void;
}

/**
 * AgentCard — grid card. Port of agents-card.jsx::AgentCardGrid, adapted to
 * standalone conventions (Tailwind + shadcn, no is_promoted, profile_name in footer).
 */
export function AgentCard({ agent, dense = false, onOpenPage }: AgentCardProps) {
  const { t } = useTranslation('agents');
  const categoryColor = AGENT_CATEGORY_COLORS[agent.category ?? ''] ?? 'oklch(0.58 0.05 250)';

  return (
    <div
      className="ap-agent-card group relative flex min-w-0 flex-col gap-2.5 overflow-hidden rounded-xl border border-border bg-bgCard transition-[border-color,box-shadow] duration-100 hover:border-borderStrong hover:shadow-card"
      style={{ padding: dense ? 12 : 14 }}
    >
      {/* Left category-color rail */}
      <span
        aria-hidden="true"
        className="absolute bottom-0 left-0 top-0 w-[3px] rounded-bl-xl rounded-tl-xl"
        style={{ background: categoryColor }}
      />

      {/* Head: avatar + name/model row */}
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <AgentAvatar name={agent.name} category={agent.category} size={32} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div
              className="line-clamp-1 text-base font-semibold leading-snug"
              title={agent.name}
            >
              {agent.name}
            </div>
            <div className="flex min-w-0 items-center gap-1.5">
              <ProviderBadge provider={agent.provider} />
              {agent.model ? (
                <span
                  className="truncate text-xs text-textMuted"
                  style={{ fontFamily: 'var(--ap-font-mono)', maxWidth: 160 }}
                  title={agent.model}
                >
                  {agent.model}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Description */}
      <div
        className="line-clamp-2 text-sm leading-[1.4] text-textMuted"
        style={{ minHeight: dense ? 0 : 36 }}
      >
        {agent.description || (
          <span className="italic text-textFaint">
            {t('card.noDescription', 'No description')}
          </span>
        )}
      </div>

      {/* Badges: tools count */}
      <div className="flex flex-wrap items-center gap-1.5">
        {agent.toolsCount > 0 ? (
          <span
            className="inline-flex h-5 items-center gap-1 rounded-pill px-1.5 text-xs font-medium"
            style={{
              background: 'var(--ap-bg-3)',
              color: 'var(--ap-text-muted)',
            }}
            title={t('badges.tools', 'Tools')}
          >
            <Icon as={Wrench} size={10} />
            {agent.toolsCount}
          </span>
        ) : null}
      </div>

      {/* Footer: profile name + date */}
      <div className="mt-auto flex items-center justify-between border-t border-divider pt-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {agent.profileName ? (
            <span
              className="truncate text-xs text-textFaint"
              style={{ maxWidth: 140 }}
              title={agent.profileName}
            >
              {agent.profileName}
            </span>
          ) : null}
        </div>
        {agent.date ? (
          <span className="shrink-0 text-xs text-textFaint tabular-nums">
            {agent.date}
          </span>
        ) : null}
      </div>

      {/* Hover quick-action overlay: "Open page" only */}
      {onOpenPage ? (
        <div
          className="absolute inset-x-3 bottom-3 hidden flex-col group-hover:flex"
          style={{
            background: 'linear-gradient(to top, var(--ap-bg-card) 72%, color-mix(in oklab, var(--ap-bg-card) 0%, transparent))',
            paddingTop: 24,
          }}
        >
          <button
            type="button"
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-bgCard px-3 py-1.5 text-xs font-medium text-text shadow-sm transition-colors hover:bg-bg3 active:scale-[0.98]"
            onClick={(e) => {
              e.stopPropagation();
              onOpenPage();
            }}
          >
            <Icon as={ExternalLink} size={12} />
            {t('actions.openPage', 'Open page')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
