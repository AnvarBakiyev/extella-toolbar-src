/**
 * DefinitionBanner — quiet informational strip explaining what an Agent Team is.
 * Shown atop the Teams list (and reused where the concept needs grounding).
 */

import { Users } from 'lucide-react';
import { Icon } from '@/lib/icon';

export interface DefinitionBannerProps {
  children: React.ReactNode;
}

export function DefinitionBanner({ children }: DefinitionBannerProps) {
  return (
    <div
      className="flex items-start gap-2.5 rounded-lg border border-border px-4 py-3 text-sm text-textMuted"
      style={{ background: 'var(--ap-bg-inset)' }}
    >
      <span
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
        style={{ background: 'var(--ap-bg-3)', color: 'var(--ap-text-muted)' }}
      >
        <Icon as={Users} size={13} />
      </span>
      <p className="leading-relaxed">{children}</p>
    </div>
  );
}
