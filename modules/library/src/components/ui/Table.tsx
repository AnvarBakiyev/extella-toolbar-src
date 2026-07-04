import { forwardRef, type HTMLAttributes, type TdHTMLAttributes, type ThHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * Table — port of `.ap-table` from tokens.css. Sticky header on `<thead>`,
 * row hover via `--ap-overlay`, selected row tint via `--ap-accent-soft`.
 *
 *   <Table>
 *     <TableHeader><TableRow><TableHead>Name</TableHead></TableRow></TableHeader>
 *     <TableBody><TableRow><TableCell>...</TableCell></TableRow></TableBody>
 *   </Table>
 */
export const Table = forwardRef<HTMLTableElement, HTMLAttributes<HTMLTableElement>>(
  function Table({ className, ...props }, ref) {
    return (
      <div className="w-full overflow-auto">
        <table
          ref={ref}
          className={cn(
            'w-full border-separate border-spacing-0 text-md text-text',
            className,
          )}
          {...props}
        />
      </div>
    );
  },
);

export const TableHeader = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  function TableHeader({ className, ...props }, ref) {
    return <thead ref={ref} className={className} {...props} />;
  },
);

export const TableBody = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  function TableBody({ className, ...props }, ref) {
    return <tbody ref={ref} className={className} {...props} />;
  },
);

export const TableRow = forwardRef<HTMLTableRowElement, HTMLAttributes<HTMLTableRowElement>>(
  function TableRow({ className, ...props }, ref) {
    return (
      <tr
        ref={ref}
        className={cn(
          'transition-colors hover:[&>td]:bg-overlay data-[state=selected]:[&>td]:bg-accentSoft',
          className,
        )}
        {...props}
      />
    );
  },
);

export const TableHead = forwardRef<HTMLTableCellElement, ThHTMLAttributes<HTMLTableCellElement>>(
  function TableHead({ className, ...props }, ref) {
    return (
      <th
        ref={ref}
        scope="col"
        className={cn(
          'sticky top-0 z-[1] border-b border-border bg-bgInset px-3 py-2.5 text-left text-sm font-medium text-textMuted',
          'first:pl-s4 last:pr-s4',
          className,
        )}
        {...props}
      />
    );
  },
);

export const TableCell = forwardRef<HTMLTableCellElement, TdHTMLAttributes<HTMLTableCellElement>>(
  function TableCell({ className, ...props }, ref) {
    return (
      <td
        ref={ref}
        className={cn(
          'border-b border-divider px-3 py-3 align-middle text-md text-text',
          'first:pl-s4 last:pr-s4',
          className,
        )}
        {...props}
      />
    );
  },
);

export const TableCaption = forwardRef<HTMLTableCaptionElement, HTMLAttributes<HTMLTableCaptionElement>>(
  function TableCaption({ className, ...props }, ref) {
    return (
      <caption
        ref={ref}
        className={cn('mt-2 text-sm text-textMuted', className)}
        {...props}
      />
    );
  },
);
