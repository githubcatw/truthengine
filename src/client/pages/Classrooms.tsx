import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../i18n';
import { Button, ErrorBox, Field, Input, Notice, PageTitle, Section, Select, Skeleton } from '../components/ui';

interface Classroom {
  classroomId: string;
  name: string;
  gradeLevel: number | null;
  inviteCode?: string;
  teacherName: string | null;
}

export default function Classrooms() {
  const { t } = useI18n();
  const { profile } = useAuth();
  const [data, setData] = useState<{ teaching: Classroom[]; joined: Classroom[] } | null>(null);
  const [name, setName] = useState('');
  const [grade, setGrade] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isTeacher = profile?.role === 'teacher' || profile?.role === 'admin';
  const load = () => api<{ teaching: Classroom[]; joined: Classroom[] }>('GET', '/classrooms').then(setData).catch((e) => setError(e.message));
  useEffect(() => void load(), []);
  const list = (items: Classroom[]) =>
    items.length === 0 ? (
      <p className="text-sm text-muted">{t('class.empty')}</p>
    ) : (
      <ul className="divide-y divide-rule">
        {items.map((c) => (
          <li key={c.classroomId} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <Link to={`/classrooms/${c.classroomId}`} className="font-medium hover:text-navy">
              {c.name}
              {c.gradeLevel ? ` · ${t('class.grade')} ${c.gradeLevel}` : ''}
            </Link>
            {c.inviteCode ? <span className="font-mono text-sm">{t('class.invite', { code: c.inviteCode })}</span> : <span className="text-sm text-muted">{c.teacherName}</span>}
          </li>
        ))}
      </ul>
    );
  return (
    <div className="max-w-3xl">
      <PageTitle>{t('class.title')}</PageTitle>
      {error && <ErrorBox message={error} />}
      {!data && !error && <Skeleton lines={3} />}
      {data && isTeacher && (
        <Section title={t('class.create')}>
          <form
            className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end"
            onSubmit={async (e: FormEvent) => {
              e.preventDefault();
              setBusy(true);
              try {
                await api('POST', '/classrooms', { name: name.trim(), gradeLevel: grade ? Number(grade) : null });
                setName('');
                await load();
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label={t('class.name')}>
              <Input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} />
            </Field>
            <Field label={t('class.grade')}>
              <Select value={grade} onChange={(e) => setGrade(e.target.value)}>
                <option value="">—</option>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" busy={busy}>
              {t('class.create')}
            </Button>
          </form>
        </Section>
      )}
      {data && !isTeacher && <Notice>{t('class.teacherOnly')}</Notice>}
      {data && isTeacher && <Section title={t('nav.teacher')}>{list(data.teaching)}</Section>}
      {data && <Section title={t('student.classrooms')}>{list(data.joined)}</Section>}
    </div>
  );
}
