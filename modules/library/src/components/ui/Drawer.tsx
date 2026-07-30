import { useTranslation } from 'react-i18next';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type HTMLAttributes,
} from 'react';
import { cn } from '@/lib/cn';

/**
 * Drawer — right-edge slide-in panel built on Radix Dialog. Default width
 * matches the design (460px); the spec calls for 480 in some surfaces, so we
 * expose `width` via prop.
 *
 * Use the design convention: drawer is for "see / inspect" detail; primary
 * creation actions live inline (CLAUDE.md userMemory).
 */
export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;
export const DrawerPortal = DialogPrimitive.Portal;

export const DrawerOverlay = forwardRef<
  ElementRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(function DrawerOverlay({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn(
        'fixed inset-0 z-50 bg-black/30',
        'data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out',
        className,
      )}
      {...props}
    />
  );
});

export interface DrawerContentProps
  extends ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  width?: number;
}

export const DrawerContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  DrawerContentProps
>(function DrawerContent({ className, children, width = 460, style, ...props }, ref) {
  const { t: tCommon } = useTranslation('common');
  return (
    <DrawerPortal>
      <DrawerOverlay />
      <DialogPrimitive.Content
        ref={ref}
        style={{ width, ...style }}
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex flex-col bg-bgCard shadow-pop',
          'border-l border-border',
          'data-[state=open]:animate-slide-in-right data-[state=closed]:animate-slide-out-right',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className={cn(
            'absolute right-3 top-3 rounded-md p-1 text-iconMuted',
            'hover:bg-bg3 hover:text-text',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentSoftStrong',
          )}
          aria-label={tCommon('actions.closeDrawer')}
        >
          <X className="h-4 w-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DrawerPortal>
  );
});

export function DrawerHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 border-b border-divider px-s6 py-s4',
        className,
      )}
      {...props}
    />
  );
}

export function DrawerBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex-1 overflow-y-auto px-s6 py-s4', className)}
      {...props}
    />
  );
}

export function DrawerFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-center justify-end gap-2 border-t border-divider px-s6 py-s3',
        className,
      )}
      {...props}
    />
  );
}

export const DrawerTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function DrawerTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn('text-lg font-semibold leading-tight tracking-tight', className)}
      {...props}
    />
  );
});

export const DrawerDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function DrawerDescription({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn('text-md text-textMuted', className)}
      {...props}
    />
  );
});
