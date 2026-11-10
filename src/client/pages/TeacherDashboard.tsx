import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useI18n } from '../i18n';
import { ErrorBox, LinkButton, PageTitle, Section, Skeleton, VerdictBadge } from '../components/ui';

interface Classroom {
  classroomId: string;
  name: string;
  inviteCode?: string;
}
interface Sub {
  jobId: string;
  studentName: string | null;
  startedAtMs: number;
  claimSummaries: Array<{ claimId: string; normalizedText: string; verdict: 'CORRECT' | 'WRONG' | null }>;
}

export default function TeacherDashboard() {
  const { t, formatDate } = useI18n();
  const [classes, setClasses] = useState<Classroom[] | null>(null);
  const [recent, setRecent] = useState<Array<Sub & { classroom: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ teaching: Classroom[] }>('GET', '/classrooms')
      .then(async (r) => {
        setClasses(r.teaching);
        const all = await Promise.all(
          r.teaching.map(async (c) => (await api<{ items: Sub[] }>('GET', `/classrooms/${c.classroomId}/submissions`)).items.slice(0, 10).map((s) => ({ ...s, classroom: c.name }))),
        );
        setRecent(all.flat().sort((a, b) => b.startedAtMs - a.startedAtMs).slice(0, 15));
      })
      .catch((e) => setError(e.message));
  }, []);
  return (
    <div className="max-w-4xl">
      <PageTitle>{t('nav.teacher')}</PageTitle>
      {error && <ErrorBox message={error} />}
      {!classes && !error && <Skeleton lines={4} />}
      {classes && (
        <>
          <Section title={t('class.title')} aside={<LinkButton variant="secondary" to="/classrooms">{t('class.create')}</LinkButton>}>
            {classes.length === 0 && <p className="text-sm text-muted">{t('class.empty')}</p>}
            <ul className="divide-y divide-rule">
              {classes.map((c) => (
                <li key={c.classroomId} className="flex justify-between py-2">
                  <Link to={`/classrooms/${c.classroomId}`} className="font-medium hover:text-navy">
                    {c.name}
                  </Link>
                  <span className="font-mono text-sm">{c.inviteCode}</span>
                </li>
              ))}
            </ul>
          </Section>
          <Section title={t('class.submissions')}>
            {recent.length === 0 && <p className="text-sm text-muted">{t('class.submissions.empty')}</p>}
            <ul className="divide-y divide-rule text-sm">
              {recent.map((s) => (
                <li key={s.jobId} className="py-2">
                  <p className="text-xs text-muted">
                    {s.classroom} · {s.studentName} · {formatDate(s.startedAtMs)}
                  </p>
                  {s.claimSummaries.map((c) => (
                    <p key={c.claimId} className="mt-1 flex gap-2">
                      <VerdictBadge verdict={c.verdict} />
                      <Link to={`/results/${c.claimId}`}>{c.normalizedText}</Link>
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}
    </div>
  );
}
