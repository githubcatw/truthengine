import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { TERMINAL_JOB_STATUSES } from '../../shared/schemas';
import { api } from '../lib/api';
import { useEvents } from '../lib/events';
import { useI18n } from '../i18n';
import { Button, ErrorBox, Notice, PageTitle, Skeleton, Spinner, VerdictBadge, formatDuration } from '../components/ui';
import { ClaimChecklist } from '../components/ClaimChecklist';
import { ClaimCards, OVERVIEW } from '../components/ClaimCards';
import { JobStatusLabel } from '../components/JobStatusLabel';
import type { InvestigationEvent, JobView } from '../lib/types';

const InvestigationStage = lazy(() => import('../components/InvestigationStage'));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function Investigation() {
  const { jobId } = useParams<{ jobId: string }>();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [view, setView] = useState<JobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const running = useRef(false);

  const terminal = view ? TERMINAL_JOB_STATUSES.includes(view.job.status) : false;
  const awaiting = view ? !view.job.confirmedAt && view.job.currentStage === 'awaiting_confirmation' : false;
  const readOnly = Boolean(view?.readOnly);
  const { events, loaded } = useEvents(jobId, { live: !terminal, readOnly });

  // Virtual courtroom: the viewer follows one claim (or the overview) at a time.
  const [selected, setSelected] = useState<string>(OVERVIEW);
  const userPicked = useRef(false);
  const pointers = useRef(new Map<string, number>());
  const [seen, setSeen] = useState<Record<string, number>>({});
  const byCourt = useMemo(() => {
    const m = new Map<string, InvestigationEvent[]>();
    for (const e of events) {
      const k = e.claimId ?? OVERVIEW;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    return m;
  }, [events]);
  const firstActive = view?.claims.find((c) => c.status === 'confirmed' && c.selected)?.claimId ?? null;
  useEffect(() => {
    // Once claims are confirmed, open the first claim's courtroom unless the viewer chose one.
    if (!userPicked.current && firstActive) setSelected(firstActive);
  }, [firstActive]);
  useEffect(() => {
    const latest = byCourt.get(selected)?.at(-1)?.seq ?? 0;
    setSeen((prev) => (prev[selected] === latest ? prev : { ...prev, [selected]: latest }));
  }, [byCourt, selected]);
  const unseen = useMemo(() => {
    const out = new Set<string>();
    for (const [k, list] of byCourt) if (k !== selected && (list.at(-1)?.seq ?? 0) > (seen[k] ?? 0)) out.add(k);
    return out;
  }, [byCourt, seen, selected]);
  const onPointer = useCallback((p: number) => pointers.current.set(selected, p), [selected]);

  useEffect(() => {
    setView(null);
    setError(null);
    api<JobView>('GET', `/verifications/${jobId}`)
      .then(setView)
      .catch((e) => setError(e.message));
  }, [jobId]);

  // The investigation advances only while this page is open (no durable worker exists).
  const loop = useCallback(async () => {
    if (running.current || !jobId) return;
    running.current = true;
    try {
      for (;;) {
        if (!running.current) break;
        let v: JobView;
        try {
          v = await api<JobView>('POST', `/verifications/${jobId}/advance`);
        } catch (e) {
          setError((e as Error).message);
          await sleep(5000);
          continue;
        }
        setError(null);
        setView(v);
        if (TERMINAL_JOB_STATUSES.includes(v.job.status)) break;
        if (!v.job.confirmedAt && v.job.currentStage === 'awaiting_confirmation') break;
        if (!v.ran?.length) await sleep(v.busy ? 1500 : 3000);
      }
    } finally {
      running.current = false;
    }
  }, [jobId]);

  useEffect(() => {
    if (!view || readOnly || terminal || awaiting) return;
    void loop();
  }, [view?.job.jobId, view?.job.confirmedAt, readOnly, terminal, awaiting, loop]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      running.current = false;
    },
    [],
  );

  useEffect(() => {
    if (terminal) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [terminal]);

  if (error && !view) return <ErrorBox message={error} />;
  if (!view) return <Skeleton lines={6} />;

  const { job } = view;
  const active = view.claims.filter((c) => c.status === 'confirmed' && c.selected);
  const done = view.stages.filter((s) => s.status === 'completed' || s.status === 'skipped').length;
  const claimsDone = active.filter((c) => c.outcome !== 'pending').length;
  const elapsed = (job.completedAtMs ?? now) - job.startedAtMs;

  async function followup(path: string) {
    try {
      const r = await api<{ jobId: string }>('POST', path);
      navigate(`/investigations/${r.jobId}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <PageTitle
        sub={
          <span className="flex flex-wrap items-center gap-3">
            <JobStatusLabel status={job.status} />
            <span>{t('inv.elapsed', { time: formatDuration(elapsed) })}</span>
            {job.confirmedAt && <span>{t('inv.progress', { done, total: view.stages.length, claims: claimsDone, claimTotal: active.length })}</span>}
          </span>
        }
      >
        {t('inv.title')}
      </PageTitle>

      {readOnly && <Notice>{t('inv.readonly')}</Notice>}
      {error && <ErrorBox message={error} />}
      {job.status === 'superseded' && job.supersededBy && (
        <Notice tone="warn">
          {t('inv.superseded')}{' '}
          <Link className="text-navy" to={`/investigations/${job.supersededBy}`}>
            {t('inv.openNewer')}
          </Link>
        </Notice>
      )}
      {job.status === 'paused' && (
        <Notice tone="warn">
          {t('inv.paused')}{' '}
          {!readOnly && (
            <Button variant="secondary" className="ml-2" onClick={() => void loop()}>
              {t('inv.resume')}
            </Button>
          )}
        </Notice>
      )}
      {job.errorDetails && (job.status === 'failed' || job.status === 'research_failed') && <ErrorBox message={job.errorDetails.message} />}

      {!job.confirmedAt && !awaiting && !terminal && <Spinner label={t('inv.extracting')} />}
      {awaiting && !readOnly && <ClaimChecklist view={view} onConfirmed={setView} />}

      {job.confirmedAt && (
        <ClaimCards
          claims={active}
          stages={view.stages}
          selected={selected}
          unseen={unseen}
          onSelect={(id) => {
            userPicked.current = true;
            setSelected(id);
          }}
        />
      )}
      {!terminal && job.confirmedAt && !readOnly && <p className="text-xs text-muted">{t('inv.keepOpen')}</p>}

      <Suspense fallback={<Skeleton lines={4} />}>
        <InvestigationStage
          key={selected}
          events={byCourt.get(selected) ?? []}
          claims={view.claims}
          finished={terminal}
          loaded={loaded}
          focusClaimId={selected === OVERVIEW ? null : selected}
          running={view.stages
            .filter((s) => s.status === 'leased' && (selected === OVERVIEW ? !s.stageKey.includes(':') : s.stageKey.split(':')[1] === selected))
            .map((s) => s.stageKey)}
          initialPointer={pointers.current.get(selected)}
          onPointer={onPointer}
        />
      </Suspense>

      {active.length > 0 && (
        <section id="report" className="border-t border-rule pt-6">
          <ul className="space-y-3">
            {active.map((c) => (
              <li key={c.claimId} className="flex flex-wrap items-start gap-3">
                <VerdictBadge verdict={c.verdict} />
                <div className="min-w-0 flex-1">
                  <p>{c.normalizedText}</p>
                  {c.outcome === 'research_failed' && <p className="text-sm text-wrong">{t('inv.researchFailed')}</p>}
                  {c.outcome === 'failed' && c.failure && <p className="text-sm text-wrong">{t('inv.claimFailed', { message: c.failure.message })}</p>}
                </div>
                {c.outcome !== 'pending' && (
                  <Link to={`/results/${c.claimId}`} className="text-sm text-navy">
                    {t('inv.viewReport')}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!readOnly && (
        <div className="flex flex-wrap gap-3 border-t border-rule pt-6">
          {!terminal && job.confirmedAt && (
            <Button
              variant="danger"
              onClick={async () => {
                running.current = false;
                await api('POST', `/verifications/${job.jobId}/cancel`).catch((e) => setError(e.message));
                setView(await api<JobView>('GET', `/verifications/${job.jobId}`));
              }}
            >
              {t('inv.cancel')}
            </Button>
          )}
          {terminal && job.confirmedAt && job.status !== 'completed' && job.status !== 'superseded' && (
            <Button variant="secondary" onClick={() => void followup(`/verifications/${job.jobId}/retry`)}>
              {t('inv.retry')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
