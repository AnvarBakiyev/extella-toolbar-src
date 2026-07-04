import { ShieldOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export function ForbiddenPage() {
  const { t } = useTranslation('common');
  return (
    <div className="flex h-full flex-1 items-center justify-center p-12">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="rounded-full bg-dangerSoft p-3 text-danger">
          <ShieldOff className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('states.forbidden')}</h1>
        <p className="text-md text-textMuted">{t('errors.forbidden')}</p>
        <Button asChild variant="secondary">
          <Link to="/dashboard">{t('actions.back')}</Link>
        </Button>
      </div>
    </div>
  );
}
