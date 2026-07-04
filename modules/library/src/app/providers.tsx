import { useEffect, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toast';
import { queryClient } from '@/lib/queryClient';
import i18n from '@/i18n';

type ApTheme = 'light' | 'dark';

// Resolve the theme the SPA should boot with. When embedded in the Extella
// toolbar, build.js' <head> shim lifts `#theme=…` from the iframe URL into
// window.__MB_THEME__ before React boots. Standalone (vite dev / preview) there
// is no host, so we fall back to 'dark' — matching the toolbar's own last-resort
// default in core/theme.js.
function resolveTheme(): ApTheme {
  const injected = (window as unknown as { __MB_THEME__?: string }).__MB_THEME__;
  return injected === 'light' || injected === 'dark' ? injected : 'dark';
}

function applyTheme(theme: ApTheme) {
  document.documentElement.setAttribute('data-theme', theme);
}

function ThemeRoot({ children }: { children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('ap-theme');
    root.setAttribute('data-accent-mode', 'brand');
    root.style.setProperty('--ap-accent', '#a55720');
    root.lang = 'en';
    applyTheme(resolveTheme());

    // Live theme sync with the host toolbar. core/theme.js posts
    // { __etbTheme: 'light' | 'dark' } into this iframe whenever the Extella
    // theme changes (manual toggle or page theme change), so the embedded
    // Library restyles in place — no remount, which would drop React state.
    function onMessage(e: MessageEvent) {
      const t = (e.data as { __etbTheme?: string } | null)?.__etbTheme;
      if (t === 'light' || t === 'dark') applyTheme(t);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  return <>{children}</>;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <ThemeRoot>
          <TooltipProvider delayDuration={300}>
            {children}
            <Toaster />
          </TooltipProvider>
        </ThemeRoot>
      </QueryClientProvider>
    </I18nextProvider>
  );
}
