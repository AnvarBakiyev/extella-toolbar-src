/**
 * MasterBadge — marks the master agent of a team (LibreChat `master_agent_id`).
 * The master leads the team conversation and delegates to other members.
 *
 * Read-only in this build: there is no backend endpoint to reassign the master,
 * so this is a label, not a control.
 */

import { Crown } from 'lucide-react';
import { Icon } from '@/lib/icon';

export interface MasterBadgeProps {
  /** Show the crown glyph alongside the label. */
  withIcon?: boolean;
  label?: string;
}

export function MasterBadge({ withIcon = true, label = 'MASTER' }: MasterBadgeProps) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-pill px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ background: 'var(--ap-accent-soft)', color: 'var(--ap-accent)' }}
    >
      {withIcon ? <Icon as={Crown} size={10} /> : null}
      {label}
    </span>
  );
}
