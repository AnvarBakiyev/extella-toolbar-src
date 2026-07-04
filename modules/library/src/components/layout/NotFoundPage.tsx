import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  const { t } = useTranslation('common');
  return (
    <div className="flex h-full flex-1 items-center justify-center p-12">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="text-5xl font-semibold tracking-tight text-textFaint">404</div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('states.notFound')}</h1>
        <p className="text-md text-textMuted">{t('errors.notFound')}</p>
        <Button asChild variant="secondary">
          <Link to="/dashboard">{t('actions.back')}</Link>
        </Button>
      </div>
    </div>
  );
}
