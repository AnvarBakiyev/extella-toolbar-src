import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/**
 * EmptyState — every list/grid surface that supports empty results uses this.
 * Per CLAUDE.md the rule is illustration + heading + CTA, never a bare "—".
 */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-bgInset px-6 py-12 text-center',
        className,
      )}
    >
      {icon ? <div className="text-iconMuted">{icon}</div> : null}
      <h3 className="text-lg font-medium text-text">{title}</h3>
      {description ? (
        <p className="max-w-sm text-md text-textMuted">{description}</p>
      ) : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
