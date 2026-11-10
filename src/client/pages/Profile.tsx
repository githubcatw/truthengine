import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../i18n';
import { Button, ErrorBox, Field, Input, PageTitle, Select } from '../components/ui';

export default function Profile() {
  const { t } = useI18n();
  const { profile, refreshProfile } = useAuth();
  const [name, setName] = useState('');
  const [grade, setGrade] = useState<string>('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setName(profile?.displayName ?? '');
    setGrade(profile?.gradeLevel ? String(profile.gradeLevel) : '');
  }, [profile]);
  if (!profile) return null;
  return (
    <form
      className="max-w-lg space-y-5"
      onSubmit={async (e: FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api('PATCH', '/me', { displayName: name.trim(), gradeLevel: grade ? Number(grade) : null });
          await refreshProfile();
          setMsg(t('common.saved'));
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <PageTitle>{t('profile.title')}</PageTitle>
      <Field label={t('profile.email')}>
        <Input value={profile.email ?? ''} disabled />
      </Field>
      <Field label={t('profile.role')}>
        <Input value={t(`role.${profile.role}`)} disabled />
      </Field>
      <Field label={t('profile.name')}>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
      </Field>
      <Field label={t('profile.grade')}>
        <Select value={grade} onChange={(e) => setGrade(e.target.value)}>
          <option value="">{t('profile.grade.none')}</option>
          {Array.from({ length: 12 }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {i + 1}
            </option>
          ))}
        </Select>
      </Field>
      {error && <ErrorBox message={error} />}
      {msg && <p className="text-sm text-correct">{msg}</p>}
      <Button type="submit" busy={busy}>
        {t('common.save')}
      </Button>
    </form>
  );
}
