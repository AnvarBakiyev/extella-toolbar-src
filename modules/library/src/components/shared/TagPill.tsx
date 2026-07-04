/**
 * Tag chip used in concepts / publish requests.
 * Ported from docs/design/style/source/rc-shared/rc2-shared.jsx::TagPill.
 */

import { type ReactNode } from 'react';

export interface TagPillProps {
  children: ReactNode;
  color?: string;
}

export function TagPill({ children, color }: TagPillProps) {
  return (
    <span
      className="inline-flex items-center whitespace-nowrap"
      style={{
        padding: '1px 7px',
        fontSize: 10,
        fontWeight: 500,
        background: color
          ? `color-mix(in oklab, ${color} 16%, transparent)`
          : 'var(--ap-bg-3)',
        color: color ?? 'var(--ap-text-muted)',
        borderRadius: 4,
      }}
    >
      {children}
    </span>
  );
}
