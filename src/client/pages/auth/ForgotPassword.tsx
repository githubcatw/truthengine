import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../i18n';
import { Button, ErrorBox, Field, Input, Notice } from '../../components/ui';
import { AuthShell, authErrorMessage } from './AuthShell';

export default function ForgotPassword() {
  const { t } = useI18n();
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <AuthShell title={t('auth.reset.title')}>
      {sent ? (
        <Notice>{t('auth.reset.sent')}</Notice>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e: FormEvent) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await resetPassword(email);
              setSent(true);
            } catch (err) {
              // Do not reveal whether the account exists.
              if ((err as { code?: string }).code?.includes('user-not-found')) setSent(true);
              else setError(authErrorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label={t('auth.email')}>
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {error && <ErrorBox message={error} />}
          <Button type="submit" busy={busy} className="w-full">
            {t('auth.reset.send')}
          </Button>
        </form>
      )}
      <Link to="/login" className="mt-6 block text-sm text-navy">
        {t('common.back')}
      </Link>
    </AuthShell>
  );
}
