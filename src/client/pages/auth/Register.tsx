import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { googleSignInEnabled } from '../../lib/firebase';
import { useI18n } from '../../i18n';
import { Button, ErrorBox, Field, Input } from '../../components/ui';
import { AuthShell, authErrorMessage } from './AuthShell';

export default function Register() {
  const { t, lang } = useI18n();
  const { register, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title={t('auth.register')}>
      <form
        className="space-y-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void run(() => register(name.trim(), email, password, lang));
        }}
      >
        <Field label={t('auth.name')}>
          <Input autoComplete="name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('auth.email')}>
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={t('auth.password')} hint={t('auth.passwordHint')}>
          <Input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <ErrorBox message={error} />}
        <Button type="submit" busy={busy} className="w-full">
          {t('auth.register')}
        </Button>
        {googleSignInEnabled && (
          <Button type="button" variant="secondary" className="w-full" onClick={() => void run(loginWithGoogle)}>
            {t('auth.google')}
          </Button>
        )}
      </form>
      <p className="mt-6 text-sm text-muted">
        {t('auth.haveAccount')}{' '}
        <Link to="/login" className="text-navy">
          {t('auth.login')}
        </Link>
      </p>
    </AuthShell>
  );
}
