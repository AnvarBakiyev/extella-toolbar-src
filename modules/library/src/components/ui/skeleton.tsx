import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * Loading skeleton. Uses Tailwind's `animate-pulse` and the design's
 * `--ap-bg-3` for the tint, so the rhythm matches surrounding placeholders.
 * Per CLAUDE.md: every loading state uses skeleton, not a spinner.
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-bg3', className)}
      {...props}
    />
  );
}
