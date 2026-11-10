import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useI18n } from '../i18n';
import type { StringKey } from '../i18n/en';
import { Button, ErrorBox, Field, Input, LinkButton, PageTitle, Section, Skeleton, Textarea, VerdictBadge } from '../components/ui';
import { JobStatusLabel } from '../components/JobStatusLabel';

interface Detail {
  classroom: { classroomId: string; name: string; inviteCode?: string; gradeLevel: number | null };
  isTeacher: boolean;
  assignments: Array<{ assignmentId: string; title: string; instructions: string; dueAtMs: number | null }>;
  members: Array<{ userId: string; displayName: string | null; joinedAtMs: number }> | null;
}
interface Submission {
  jobId: string;
  studentName: string | null;
  assignmentId: string | null;
  status: any;
  startedAtMs: number;
  claimSummaries: Array<{ claimId: string; normalizedText: string; verdict: 'CORRECT' | 'WRONG' | null }>;
}
interface Insights {
  misconceptions: Record<string, Array<{ claimId: string; topicStatement: string; verdictBasis: string }>>;
  progress: Array<{ userId: string; displayName: string | null; submissions: number; exercisesAnswered: number; exercisesCorrect: number }>;
}

export default function ClassroomDetail() {
  const { classroomId } = useParams<{ classroomId: string }>();
  const { t, formatDate } = useI18n();
  const [d, setD] = useState<Detail | null>(null);
  const [subs, setSubs] = useState<Submission[]>([]);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const detail = await api<Detail>('GET', `/classrooms/${classroomId}`);
      setD(detail);
      if (detail.isTeacher) {
        const [s, i] = await Promise.all([api<{ items: Submission[] }>('GET', `/classrooms/${classroomId}/submissions`), api<Insights>('GET', `/classrooms/${classroomId}/insights`)]);
        setSubs(s.items);
        setInsights(i);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [classroomId]);
  useEffect(() => void load(), [load]);

  if (error && !d) return <ErrorBox message={error} />;
  if (!d) return <Skeleton lines={5} />;
  return (
    <div className="max-w-4xl">
      <PageTitle sub={d.classroom.inviteCode ? <span className="font-mono">{t('class.invite', { code: d.classroom.inviteCode })}</span> : undefined}>{d.classroom.name}</PageTitle>
      {error && <ErrorBox message={error} />}

      <Section title={t('class.assignments')}>
        {d.assignments.length === 0 && <p className="text-sm text-muted">{t('student.assignments.empty')}</p>}
        <ul className="space-y-2">
          {d.assignments.map((a) => (
            <li key={a.assignmentId} className="rounded border border-rule bg-white p-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-medium">{a.title}</span>
                {a.dueAtMs && <span className="text-xs text-muted">{formatDate(a.dueAtMs)}</span>}
              </div>
              {a.instructions && <p className="mt-1 text-muted">{a.instructions}</p>}
              {!d.isTeacher && (
                <LinkButton variant="secondary" className="mt-2" to={`/new?assignment=${a.assignmentId}`}>
                  {t('student.submit')}
                </LinkButton>
              )}
            </li>
          ))}
        </ul>
        {d.isTeacher && (
          <form
            className="mt-6 space-y-3"
            onSubmit={async (e: FormEvent) => {
              e.preventDefault();
              setBusy(true);
              try {
                await api('POST', `/classrooms/${classroomId}/assignments`, { title: title.trim(), instructions: instructions.trim(), dueAtMs: due ? new Date(due).getTime() : null });
                setTitle('');
                setInstructions('');
                setDue('');
                await load();
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <h3 className="font-medium">{t('class.assignment.create')}</h3>
            <Field label={t('class.assignment.title')}>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={2} maxLength={120} />
            </Field>
            <Field label={t('class.assignment.instructions')}>
              <Textarea rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={2000} />
            </Field>
            <Field label={t('class.assignment.due')}>
              <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </Field>
            <Button type="submit" busy={busy}>
              {t('class.assignment.create')}
            </Button>
          </form>
        )}
      </Section>

      {d.isTeacher && d.members && (
        <Section title={t('class.members')}>
          {d.members.length === 0 ? (
            <p className="text-sm text-muted">{t('class.members.empty')}</p>
          ) : (
            <ul className="divide-y divide-rule text-sm">
              {d.members.map((m) => (
                <li key={m.userId} className="flex justify-between py-2">
                  <span>{m.displayName}</span>
                  <button
                    className="text-xs text-wrong"
                    onClick={async () => {
                      await api('DELETE', `/classrooms/${classroomId}/members/${m.userId}`).catch((e) => setError(e.message));
                      await load();
                    }}
                  >
                    {t('common.delete')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {d.isTeacher && (
        <Section title={t('class.submissions')}>
          {subs.length === 0 && <p className="text-sm text-muted">{t('class.submissions.empty')}</p>}
          <ul className="divide-y divide-rule text-sm">
            {subs.map((s) => (
              <li key={s.jobId} className="py-3">
                <div className="flex flex-wrap justify-between gap-2 text-xs text-muted">
                  <span>
                    {s.studentName} · {formatDate(s.startedAtMs)} {s.assignmentId && `· ${d.assignments.find((a) => a.assignmentId === s.assignmentId)?.title ?? ''}`}
                  </span>
                  <span className="flex gap-3">
                    <JobStatusLabel status={s.status} />
                    <Link to={`/investigations/${s.jobId}`} className="text-navy">
                      {t('common.open')}
                    </Link>
                  </span>
                </div>
                {s.claimSummaries.map((c) => (
                  <p key={c.claimId} className="mt-1 flex items-start gap-2">
                    <VerdictBadge verdict={c.verdict} />
                    <Link to={`/results/${c.claimId}`}>{c.normalizedText}</Link>
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {d.isTeacher && insights && (
        <>
          <Section title={t('class.progress')}>
            <ul className="space-y-1 text-sm">
              {insights.progress.map((p) => (
                <li key={p.userId}>
                  {t('class.progress.row', { name: p.displayName ?? '—', subs: p.submissions, exercises: p.exercisesAnswered, correct: p.exercisesCorrect })}
                </li>
              ))}
            </ul>
          </Section>
          <Section title={t('class.misconceptions')}>
            <p className="mb-3 text-sm text-muted">{t('class.misconceptions.text')}</p>
            {Object.keys(insights.misconceptions).length === 0 && <p className="text-sm text-muted">{t('class.misconceptions.empty')}</p>}
            {Object.entries(insights.misconceptions).map(([subject, items]) => (
              <div key={subject} className="mb-4">
                <h3 className="text-sm font-medium">{t(`subject.${subject}` as StringKey)}</h3>
                <ul className="mt-1 space-y-1 text-sm">
                  {items.map((i) => (
                    <li key={i.claimId}>
                      <Link to={`/results/${i.claimId}`} className="hover:text-navy">
                        {i.topicStatement}
                      </Link>{' '}
                      <span className="text-xs text-muted">({t(`res.basis.${i.verdictBasis}` as StringKey)})</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </Section>
        </>
      )}
    </div>
  );
}
