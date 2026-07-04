import { type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface RowAction {
  /** Stable id for the action (used as React key + onSelect dispatch). */
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  /** Renders the item with destructive styling (red text + red hover bg). */
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export interface RowActionsMenuProps {
  /** Accessible label for the trigger (defaults to `Actions`). */
  ariaLabel?: string;
  actions: RowAction[];
  /** Optional extra class for the trigger button. */
  triggerClassName?: string;
}

/**
 * RowActionsMenu — the ubiquitous `[•••]` button + dropdown used at the right
 * edge of every list row. Centralises focus / a11y / hit-target size so each
 * feature doesn't reinvent it.
 *
 *  - Clicks on the trigger stop propagation, so the surrounding row click
 *    handler (open preview, navigate, etc.) doesn't fire.
 *  - The `danger` flag flips an item to the destructive palette.
 */
export function RowActionsMenu({
  ariaLabel = 'Actions',
  actions,
  triggerClassName,
}: RowActionsMenuProps) {
  if (actions.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-md text-iconMuted hover:bg-bg3 hover:text-text',
            triggerClassName,
          )}
        >
          <MoreHorizontal className="h-[14px] w-[14px]" strokeWidth={1.5} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.id}
            disabled={action.disabled}
            onSelect={(e) => {
              e.preventDefault();
              action.onSelect();
            }}
            className={
              action.danger
                ? 'text-danger focus:text-danger hover:text-danger focus:bg-dangerSoft hover:bg-dangerSoft'
                : undefined
            }
          >
            {action.icon ? <span className="flex h-3.5 w-3.5 items-center">{action.icon}</span> : null}
            <span className="flex-1">{action.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
