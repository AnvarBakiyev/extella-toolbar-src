import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Input — `.ap-input` port. Wrapper renders the border + focus state; the
 * inner <input> is transparent and inherits font/color. Optional leading or
 * trailing slots accept icons / inline buttons.
 */
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  leading?: ReactNode;
  trailing?: ReactNode;
  wrapperClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, wrapperClassName, leading, trailing, ...props },
  ref,
) {
  return (
    <div
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-md border border-border bg-bgCard px-2.5',
        'text-md text-text transition-colors',
        'focus-within:border-borderStrong',
        wrapperClassName,
      )}
    >
      {leading ? <span className="text-iconMuted">{leading}</span> : null}
      <input
        ref={ref}
        className={cn(
          'min-w-0 flex-1 bg-transparent text-md text-text outline-none',
          'placeholder:text-textFaint',
          className,
        )}
        {...props}
      />
      {trailing ? <span className="text-iconMuted">{trailing}</span> : null}
    </div>
  );
});
