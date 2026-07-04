import { type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * Badge — port of `.ap-badge` family. Use semantic variants (success/warning/
 * danger/info/accent) over raw colors so the badge stays consistent across
 * light/dark themes and with accent overrides.
 */
const badgeVariants = cva(
  [
    'inline-flex items-center gap-1 h-5 px-1.5 rounded-pill',
    'text-xs font-medium leading-none',
  ],
  {
    variants: {
      variant: {
        default: 'bg-bg3 text-textMuted',
        success: 'bg-successSoft text-success',
        warning: 'bg-warningSoft text-warning',
        danger: 'bg-dangerSoft text-danger',
        info: 'bg-infoSoft text-info',
        accent: 'bg-accentSoft text-accent',
        outline: 'border border-border text-textMuted bg-transparent',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
