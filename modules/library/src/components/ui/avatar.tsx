import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from '@/lib/cn';

export const Avatar = forwardRef<
  ElementRef<typeof AvatarPrimitive.Root>,
  ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(function Avatar({ className, ...props }, ref) {
  return (
    <AvatarPrimitive.Root
      ref={ref}
      className={cn(
        'relative inline-flex h-7 w-7 shrink-0 select-none items-center justify-center overflow-hidden rounded-full',
        className,
      )}
      {...props}
    />
  );
});

export const AvatarImage = forwardRef<
  ElementRef<typeof AvatarPrimitive.Image>,
  ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(function AvatarImage({ className, ...props }, ref) {
  return (
    <AvatarPrimitive.Image
      ref={ref}
      className={cn('aspect-square h-full w-full', className)}
      {...props}
    />
  );
});

export interface AvatarFallbackProps
  extends ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback> {
  /**
   * Background color in any CSS color form. The fallback in the design uses
   * `oklch(...)` per-avatar; pass it here so initials get a stable hue.
   */
  color?: string;
}

export const AvatarFallback = forwardRef<
  ElementRef<typeof AvatarPrimitive.Fallback>,
  AvatarFallbackProps
>(function AvatarFallback({ className, style, color, ...props }, ref) {
  return (
    <AvatarPrimitive.Fallback
      ref={ref}
      style={{ background: color ?? 'oklch(0.58 0.22 350)', ...style }}
      className={cn(
        'flex h-full w-full items-center justify-center text-xs font-semibold text-white',
        className,
      )}
      {...props}
    />
  );
});
