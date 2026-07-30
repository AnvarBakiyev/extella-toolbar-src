/**
 * Tokens table — columns: Name, Token (masked), Created, Actions.
 *
 * The token value is a SECRET — only the last 4 chars are shown in the cell.
 * The full token is only available via the Copy action.
 * Mirrors KvTable in structure and visual language.
 */

import { Copy, Trash2, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { RowActionsMenu } from '@/components/shared/RowActionsMenu';
import { ProfileAgentBadge } from '@/components/shared/ProfileAgentBadge';
import type { AppLocale } from '@/lib/format';
import { formatDate } from '@/lib/format';
import { useTokenStatus } from '../hooks/useTokens';
import type { Token } from '../schemas';

/* ─── helpers ───────────────────────────────────────────────────── */

function fmtDate(dt: string | null | undefined, locale: AppLocale): string {
  if (!dt) return '—';
  try {
    return formatDate(dt, 'dd MMM yyyy', locale);
  } catch {
    return dt;
  }
}

/** Mask a token value — show only the last 4 chars. */
function maskToken(token: string): string {
  if (token.length <= 4) return '••••••••';
  return `••••••••${token.slice(-4)}`;
}

async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  } else {
    // Fallback for environments without clipboard API
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  }
}

/* ─── status cell ───────────────────────────────────────────────── */

/**
 * Per-row token validity. The backend has no status field, so this probes the
 * token (one cheap `/api/token/list` call, cached by `useTokenStatus`) and shows
 * active / revoked. While the probe is in flight it shows a "checking…" spinner;
 * a non-auth (network) failure resolves to a neutral "—".
 */
function TokenStatusCell({ token }: { token: string }) {
  const { t } = useTranslation('tokens');
  const { data, isLoading, isError } = useTokenStatus(token);

  if (isLoading) {
    return (
      <span
        className="inline-flex items-center gap-1.5"
        style={{ fontSize: 12, color: 'var(--ap-text-faint)' }}
      >
        <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
        {t('status.checking', 'checking…')}
      </span>
    );
  }

  if (isError || !data) {
    return (
      <span style={{ fontSize: 12, color: 'var(--ap-text-faint)' }}>
        {t('status.unknown', '—')}
      </span>
    );
  }

  const active = data === 'active';
  const color = active ? 'var(--ap-success, #3fb950)' : 'var(--ap-danger)';
  return (
    <span
      className="inline-flex items-center gap-1.5"
      style={{ fontSize: 12, color, fontWeight: 500 }}
    >
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: color,
          display: 'inline-block',
        }}
      />
      {active ? t('status.active', 'active') : t('status.revoked', 'revoked')}
    </span>
  );
}

/* ─── types ─────────────────────────────────────────────────────── */

export interface TokensTableProps {
  rows: Token[];
  loading?: boolean;
  onRevoke: (token: string) => void;
}

/* ─── component ─────────────────────────────────────────────────── */

export function TokensTable({ rows, loading, onRevoke }: TokensTableProps) {
  const { t: tCommon } = useTranslation('common');
  const { t, i18n } = useTranslation('tokens');
  const locale = (i18n.language ?? 'en') as AppLocale;

  if (loading) {
    return (
      <div className="p-4 flex flex-col gap-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr
          style={{
            background: 'var(--ap-bg-inset)',
            borderBottom: '1px solid var(--ap-divider)',
          }}
        >
          <th
            scope="col"
            className="text-left px-4 py-2 font-medium"
            style={{ color: 'var(--ap-text-muted)', fontSize: 11 }}
          >
            {t('columns.name', 'Name')}
          </th>
          <th
            scope="col"
            className="text-left px-4 py-2 font-medium"
            style={{ color: 'var(--ap-text-muted)', fontSize: 11 }}
          >
            {t('columns.token', 'Token')}
          </th>
          <th
            scope="col"
            className="text-left px-4 py-2 font-medium"
            style={{ width: 120, color: 'var(--ap-text-muted)', fontSize: 11 }}
          >
            {t('columns.status', 'Status')}
          </th>
          <th
            scope="col"
            className="text-left px-4 py-2 font-medium"
            style={{ width: 160, color: 'var(--ap-text-muted)', fontSize: 11 }}
          >{tCommon('columns.profileAgent')}</th>
          <th
            scope="col"
            className="text-left px-4 py-2 font-medium"
            style={{ width: 130, color: 'var(--ap-text-muted)', fontSize: 11 }}
          >
            {t('columns.created', 'Created')}
          </th>
          <th scope="col" style={{ width: 40 }} />
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td
              colSpan={6}
              className="py-12 text-center"
              style={{ color: 'var(--ap-text-faint)', fontSize: 13 }}
            >
              {t('table.empty', 'No tokens found')}
            </td>
          </tr>
        )}
        {rows.map((row) => (
          <tr
            key={row.token}
            className="border-b border-divider transition-colors hover:bg-bg3"
            style={{ borderBottom: '1px solid var(--ap-divider)' }}
          >
            {/* name */}
            <td className="px-4 py-2" style={{ maxWidth: 240 }}>
              <span
                className="truncate block"
                style={{ fontSize: 13 }}
                title={row.name || undefined}
              >
                {row.name || (
                  <span style={{ color: 'var(--ap-text-faint)', fontStyle: 'italic' }}>
                    {t('table.unnamed', 'Unnamed')}
                  </span>
                )}
              </span>
            </td>

            {/* token (masked — secret) */}
            <td className="px-4 py-2">
              <span
                className="font-mono"
                style={{
                  fontSize: 13,
                  color: 'var(--ap-text-muted)',
                  letterSpacing: '0.04em',
                }}
                aria-label={t('table.tokenMasked', 'Token value is masked')}
              >
                {maskToken(row.token)}
              </span>
            </td>

            {/* status (probed — backend has no status field) */}
            <td className="px-4 py-2">
              <TokenStatusCell token={row.token} />
            </td>

            {/* profile + agent */}
            <td className="px-4 py-2">
              <ProfileAgentBadge
                profile_name={row.profile_name ?? undefined}
                agent_name={row.agent_name ?? undefined}
                stacked
              />
            </td>

            {/* created date */}
            <td
              className="px-4 py-2"
              style={{
                fontSize: 12,
                color: 'var(--ap-text-muted)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {fmtDate(row.created_at, locale)}
            </td>

            {/* actions */}
            <td className="px-2 py-2">
              <RowActionsMenu
                ariaLabel={`Actions for ${row.name || 'token'}`}
                actions={[
                  {
                    id: 'copy',
                    label: t('actions.copy', 'Copy token'),
                    icon: <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />,
                    onSelect: () => {
                      copyToClipboard(row.token)
                        .then(() => {
                          toast.success(t('actions.copied', 'Token copied to clipboard'));
                        })
                        .catch(() => {
                          toast.error(t('actions.copyFailed', 'Failed to copy token'));
                        });
                    },
                  },
                  {
                    id: 'revoke',
                    label: t('actions.revoke', 'Revoke'),
                    icon: <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />,
                    danger: true,
                    onSelect: () => onRevoke(row.token),
                  },
                ]}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
