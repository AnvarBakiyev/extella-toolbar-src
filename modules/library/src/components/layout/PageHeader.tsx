import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/**
 * PageHeader — port of `.ap-page-h`. Used at the top of every content surface.
 * The h1 carries the tighter -1% tracking from the design tokens.
 */
export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <header
      className={cn(
        'flex items-start justify-between gap-3 border-b border-divider px-7 pb-4 pt-5',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <h1 className="m-0 truncate text-2xl font-semibold leading-tight tracking-[-0.01em]">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-0.5 text-md text-textMuted">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
