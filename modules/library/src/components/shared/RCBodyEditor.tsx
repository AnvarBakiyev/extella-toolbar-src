/**
 * Plain textarea editor for rule/concept body.
 * No RTE — plain text only, monospace font.
 *
 * Tab key behavior: standard browser behavior (Tab → next focusable element)
 * for proper keyboard navigation. Indentation can be done via spaces.
 */

import { type ChangeEvent, forwardRef } from 'react';
import { cn } from '@/lib/cn';

export interface RCBodyEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: number;
  disabled?: boolean;
  className?: string;
  id?: string;
  'aria-describedby'?: string;
}

export const RCBodyEditor = forwardRef<HTMLTextAreaElement, RCBodyEditorProps>(
  function RCBodyEditor(
    {
      value,
      onChange,
      placeholder,
      minHeight = 200,
      disabled,
      className,
      id,
      'aria-describedby': ariaDescribedBy,
    },
    ref,
  ) {
    function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
      onChange(e.target.value);
    }

    return (
      <textarea
        ref={ref}
        id={id}
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        aria-describedby={ariaDescribedBy}
        className={cn(
          'w-full resize-y rounded-md border border-border bg-bgCard',
          'px-3 py-2.5 text-sm text-text outline-none transition-colors',
          'placeholder:text-textFaint',
          'focus:border-accent focus:ring-1 focus:ring-accent/30',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        style={{
          minHeight,
          fontFamily: 'var(--ap-font-mono)',
          fontSize: 13,
          lineHeight: 1.6,
        }}
      />
    );
  },
);
