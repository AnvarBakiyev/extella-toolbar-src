/**
 * CounterTile — a small labelled metric tile (e.g. "Agents · 4").
 * Used in team cards and the team detail hero to surface container counts.
 */

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Icon } from '@/lib/icon';

export interface CounterTileProps {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  /** Dim the tile while the value is still loading. */
  loading?: boolean;
}

export function CounterTile({ label, value, icon, loading = false }: CounterTileProps) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-bgCard px-3 py-2.5">
      <span className="flex items-center gap-1 text-xs font-medium uppercase tracking-[0.04em] text-textFaint">
        {icon ? <Icon as={icon} size={11} /> : null}
        {label}
      </span>
      <span className="text-xl font-semibold tabular-nums text-text">
        {loading ? <span className="text-textFaint">—</span> : value}
      </span>
    </div>
  );
}
