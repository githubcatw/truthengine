import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { googleSignInEnabled } from '../../lib/firebase';
import { useI18n } from '../../i18n';
import { Button, ErrorBox, Field, Input } from '../../components/ui';
import { AuthShell, authErrorMessage } from './AuthShell';

export default function Login() {
  const { t } = useI18n();
  const { login, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/dashboard';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      navigate(from, { replace: true });
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title={t('auth.login')}>
      <form
        className="space-y-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void run(() => login(email, password));
        }}
      >
        <Field label={t('auth.email')}>
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={t('auth.password')}>
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <ErrorBox message={error} />}
        <Button type="submit" busy={busy} className="w-full">
          {t('auth.login')}
        </Button>
        {googleSignInEnabled && (
          <Button type="button" variant="secondary" className="w-full" onClick={() => void run(loginWithGoogle)}>
            {t('auth.google')}
          </Button>
        )}
      </form>
      <div className="mt-6 space-y-2 text-sm">
        <Link to="/forgot-password" className="text-navy">
          {t('auth.forgot')}
        </Link>
        <p className="text-muted">
          {t('auth.noAccount')}{' '}
          <Link to="/register" className="text-navy">
            {t('auth.register')}
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
