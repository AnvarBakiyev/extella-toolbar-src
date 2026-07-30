import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * Button — visual surface ports the design's `.ap-btn` family
 * (default / primary / ghost / accent) into Tailwind utilities reading the
 * same CSS variables. Sizes: sm (26px), md (32px), icon variants square.
 *
 *  <Button variant="primary">{tCommon('actions.save')}</Button>
 *  <Button variant="ghost" size="icon"><Icon as={X} /></Button>
 *  <Button asChild><Link to="/x">Go</Link></Button>
 */
const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-1.5 whitespace-nowrap',
    'rounded-md border font-medium',
    'transition-colors duration-100',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentSoftStrong',
    'disabled:opacity-50 disabled:pointer-events-none',
  ],
  {
    variants: {
      variant: {
        // Default: bordered "secondary" — neutral surface, used for most actions.
        secondary: 'border-border bg-bgCard text-text hover:bg-bg2',
        // Primary (filled, accent): main CTA. Matches .ap-btn--primary.
        primary: 'border-accent bg-accent text-accentFg hover:brightness-95',
        // Accent — aliased to primary for compatibility with the design.
        accent: 'border-accent bg-accent text-accentFg hover:brightness-95',
        // Ghost: no border / no fill until hover.
        ghost: 'border-transparent bg-transparent text-text hover:bg-bg3',
        // Danger (destructive actions): used in delete confirmations.
        danger: 'border-danger bg-danger text-white hover:brightness-95',
        // Fill (black/white solid neutral): mirrors --ap-fill-btn.
        fill: 'border-fillBtn bg-fillBtn text-fillBtnFg hover:brightness-95',
      },
      size: {
        sm: 'h-[26px] px-2.5 text-sm',
        md: 'h-8 px-3 text-md',
        lg: 'h-10 px-4 text-base',
        icon: 'h-8 w-8 p-0',
        'icon-sm': 'h-[26px] w-[26px] p-0',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
});

export { buttonVariants };
