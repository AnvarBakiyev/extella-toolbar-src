import { AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

export interface ErrorBannerProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorBanner({ title, message, onRetry, className }: ErrorBannerProps) {
  const { t } = useTranslation('common');
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-3 rounded-lg border border-danger/40 bg-dangerSoft px-4 py-3 text-md text-danger',
        className,
      )}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1">
        <div className="font-medium">{title ?? t('states.error')}</div>
        {message ? <div className="mt-0.5 text-sm opacity-90">{message}</div> : null}
      </div>
      {onRetry ? (
        <Button size="sm" variant="ghost" onClick={onRetry} className="text-danger hover:bg-danger/10">
          {t('actions.retry')}
        </Button>
      ) : null}
    </div>
  );
}
