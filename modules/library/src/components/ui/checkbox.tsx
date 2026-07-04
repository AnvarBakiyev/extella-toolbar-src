import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from '@/lib/cn';

export const Checkbox = forwardRef<
  ElementRef<typeof CheckboxPrimitive.Root>,
  ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(function Checkbox({ className, ...props }, ref) {
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        'inline-flex h-4 w-4 shrink-0 items-center justify-center',
        'rounded-xs border-[1.5px] border-borderStrong bg-bg',
        'transition-colors',
        'data-[state=checked]:bg-fillBtn data-[state=checked]:border-fillBtn',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentSoftStrong',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="text-fillBtnFg">
        <Check className="h-3 w-3" strokeWidth={2.5} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});
