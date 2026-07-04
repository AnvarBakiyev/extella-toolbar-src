import * as SwitchPrimitive from '@radix-ui/react-switch';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from '@/lib/cn';

/**
 * Switch — port of `.ap-toggle` (30 x 18 pill, 14 thumb, slides 12px).
 */
export const Switch = forwardRef<
  ElementRef<typeof SwitchPrimitive.Root>,
  ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(function Switch({ className, ...props }, ref) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        'relative inline-flex h-[18px] w-[30px] shrink-0 cursor-pointer items-center rounded-pill',
        'border-transparent transition-colors',
        'bg-borderStrong data-[state=checked]:bg-fillBtn',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentSoftStrong',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block h-[14px] w-[14px] translate-x-[2px] rounded-full bg-white shadow',
          'transition-transform data-[state=checked]:translate-x-[14px]',
        )}
      />
    </SwitchPrimitive.Root>
  );
});
