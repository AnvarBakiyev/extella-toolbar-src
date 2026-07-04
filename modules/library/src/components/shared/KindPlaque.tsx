/**
 * Coloured icon plaque for rule/concept kind indicator.
 * Used in detail modals, approval queue, and admin-create modal headers.
 */

import { BookOpen, Zap } from 'lucide-react';
import { Icon } from '@/lib/icon';

export type ItemKind = 'rule' | 'concept';

export interface KindPlaqueProps {
  kind: ItemKind;
  size?: number;
}

export function KindPlaque({ kind, size = 28 }: KindPlaqueProps) {
  const isRule = kind === 'rule';
  return (
    <span
      className="inline-flex items-center justify-center flex-shrink-0"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.32),
        background: isRule ? 'var(--ap-accent-soft)' : 'var(--ap-info-soft)',
        color: isRule ? 'var(--ap-accent)' : 'var(--ap-info)',
      }}
    >
      <Icon as={isRule ? Zap : BookOpen} size={Math.round(size * 0.5)} />
    </span>
  );
}
