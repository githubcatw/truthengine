import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useI18n } from '../i18n';
import { Button, ErrorBox, Field, Input, LinkButton, PageTitle, Section, Skeleton, VerdictBadge } from '../components/ui';

interface Classroom {
  classroomId: string;
  name: string;
  teacherName: string | null;
}
interface Assignment {
  assignmentId: string;
  title: string;
  instructions: string;
  dueAtMs: number | null;
}

function ClassroomAssignments({ c }: { c: Classroom }) {
  const { t, formatDate } = useI18n();
  const [data, setData] = useState<{ assignments: Assignment[] } | null>(null);
  const [subs, setSubs] = useState<Record<string, Array<{ jobId: string; claimSummaries: Array<{ claimId: string; verdict: 'CORRECT' | 'WRONG' | null }> }>>>({});
  useEffect(() => {
    api<{ assignments: Assignment[] }>('GET', `/classrooms/${c.classroomId}`).then(async (d) => {
      setData(d);
      const entries = await Promise.all(d.assignments.map(async (a) => [a.assignmentId, (await api<{ mySubmissions: any[] }>('GET', `/assignments/${a.assignmentId}`)).mySubmissions] as const));
      setSubs(Object.fromEntries(entries));
    }).catch(() => setData({ assignments: [] }));
  }, [c.classroomId]);
  if (!data) return <Skeleton lines={2} />;
  if (!data.assignments.length) return <p className="text-sm text-muted">{t('student.assignments.empty')}</p>;
  return (
    <ul className="space-y-3">
      {data.assignments.map((a) => (
        <li key={a.assignmentId} className="rounded border border-rule bg-white p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{a.title}</span>
            {a.dueAtMs && <span className="text-xs text-muted">{t('class.assignment.due')}: {formatDate(a.dueAtMs)}</span>}
          </div>
          {a.instructions && <p className="mt-1 text-muted">{a.instructions}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {(subs[a.assignmentId] ?? []).map((s) => (
              <Link key={s.jobId} to={`/investigations/${s.jobId}`} className="flex items-center gap-1 text-xs text-navy">
                {t('student.submitted')} {s.claimSummaries.map((x) => <VerdictBadge key={x.claimId} verdict={x.verdict} />)}
              </Link>
            ))}
            <LinkButton variant="secondary" to={`/new?assignment=${a.assignmentId}`}>
              {t('student.submit')}
            </LinkButton>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function StudentDashboard() {
  const { t } = useI18n();
  const [classes, setClasses] = useState<Classroom[] | null>(null);
  const [progress, setProgress] = useState<{ exercisesAnswered: number; exercisesCorrect: number } | null>(null);
  const [verdicts, setVerdicts] = useState<{ CORRECT: number; WRONG: number }>({ CORRECT: 0, WRONG: 0 });
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api<{ joined: Classroom[] }>('GET', '/classrooms').then((r) => setClasses(r.joined)).catch((e) => setError(e.message));
  useEffect(() => {
    void load();
    api<{ exercisesAnswered: number; exercisesCorrect: number }>('GET', '/learning/progress').then(setProgress).catch(() => undefined);
    api<{ items: Array<{ claimSummaries: Array<{ verdict: 'CORRECT' | 'WRONG' | null }> }> }>('GET', '/verifications?limit=50')
      .then((r) => {
        const v = r.items.flatMap((i) => i.claimSummaries.map((c) => c.verdict));
        setVerdicts({ CORRECT: v.filter((x) => x === 'CORRECT').length, WRONG: v.filter((x) => x === 'WRONG').length });
      })
      .catch(() => undefined);
  }, []);
  return (
    <div className="max-w-3xl">
      <PageTitle>{t('student.title')}</PageTitle>
      {progress && <p className="text-sm">{t('learn.progress', { done: progress.exercisesAnswered, correct: progress.exercisesCorrect })}</p>}
      <p className="mt-2 flex items-center gap-2 text-sm">
        {t('student.verdicts')}: <VerdictBadge verdict="CORRECT" /> {verdicts.CORRECT} <VerdictBadge verdict="WRONG" /> {verdicts.WRONG}
      </p>
      <Section title={t('student.join')}>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (e: FormEvent) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await api('POST', '/classrooms/join', { inviteCode: code.trim() });
              setCode('');
              await load();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label={t('student.inviteCode')}>
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={12} required className="font-mono uppercase" />
          </Field>
          <Button type="submit" busy={busy}>
            {t('student.joinButton')}
          </Button>
        </form>
        {error && (
          <div className="mt-3">
            <ErrorBox message={error} />
          </div>
        )}
      </Section>
      <Section title={t('student.classrooms')}>
        {!classes && <Skeleton lines={2} />}
        {classes?.length === 0 && <p className="text-sm text-muted">{t('class.empty')}</p>}
        <div className="space-y-6">
          {classes?.map((c) => (
            <div key={c.classroomId}>
              <h3 className="mb-2 font-medium">
                {c.name} {c.teacherName && <span className="text-sm text-muted">· {c.teacherName}</span>}
              </h3>
              <ClassroomAssignments c={c} />
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
