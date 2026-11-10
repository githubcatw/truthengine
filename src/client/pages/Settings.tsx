import { PageTitle, Field } from '../components/ui';
import { LanguageSwitcher } from '../components/Layout';
import { SetupPanel } from '../components/SetupStatus';
import { useI18n } from '../i18n';

export default function Settings() {
  const { t } = useI18n();
  return (
    <div className="max-w-lg space-y-8">
      <PageTitle>{t('settings.title')}</PageTitle>
      <Field label={t('settings.language')}>
        <div>
          <LanguageSwitcher />
        </div>
      </Field>
      <p className="text-sm text-muted">{t('settings.motion')}</p>
      <div className="border-t border-rule pt-6">
        <h2 className="mb-3 text-sm font-medium">{t('setup.title')}</h2>
        <SetupPanel />
      </div>
    </div>
  );
}
