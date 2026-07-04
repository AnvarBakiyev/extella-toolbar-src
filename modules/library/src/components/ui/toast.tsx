import { Toaster as SonnerToaster, toast } from 'sonner';

/**
 * Toast surface. Sonner is used directly throughout the app; this wrapper
 * mounts the configured `<Toaster />`. Position top-right and 4s default
 * duration. The standalone build is light-theme-only.
 */
export function Toaster() {
  return (
    <SonnerToaster
      theme="light"
      position="top-right"
      richColors
      closeButton
      duration={4000}
      toastOptions={{
        classNames: {
          toast: 'border border-border bg-bgCard text-text shadow-pop',
          title: 'text-md font-medium',
          description: 'text-sm text-textMuted',
        },
      }}
    />
  );
}

export { toast };
