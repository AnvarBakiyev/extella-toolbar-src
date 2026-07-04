import { type LucideIcon, type LucideProps } from 'lucide-react';
import { forwardRef } from 'react';
import { cn } from './cn';

/**
 * Thin wrapper around Lucide icons. Defaults match the design's stroke-1.5,
 * currentColor convention so call sites only need to pass the icon component:
 *
 *   import { Search } from 'lucide-react'
 *   <Icon as={Search} />
 */
export interface IconProps extends Omit<LucideProps, 'ref'> {
  as: LucideIcon;
}

export const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon(
  { as: Component, size = 16, strokeWidth = 1.5, className, ...rest },
  ref,
) {
  return (
    <Component
      ref={ref}
      size={size}
      strokeWidth={strokeWidth}
      className={cn('shrink-0', className)}
      aria-hidden="true"
      {...rest}
    />
  );
});
