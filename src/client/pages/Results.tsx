import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { DebateMessage } from '../../shared/schemas';
import { api } from '../lib/api';
import { useI18n } from '../i18n';
import type { StringKey } from '../i18n/en';
import type { Exercise, Report } from '../lib/types';
import { Button, ErrorBox, Notice, PageTitle, Section, Skeleton, Tag, Textarea, VerdictBadge } from '../components/ui';
import { EvidenceChip, EvidenceDetails } from '../components/Evidence';
import { PixelAgent } from '../pixel/PixelAgent';
import { ExerciseCard } from '../components/ExerciseCard';
import { pageNumber } from '../components/ClaimChecklist';
import { describeResearch } from '../lib/events';
import { newIdempotencyKey } from '../lib/api';

/** Shows the audited document with each finding's exact passage highlighted (PART 8.2). */
function HighlightedDocument({ text, findings }: { text: string; findings: Finding[] }) {
  const ranges: Array<{ start: number; end: number; label: string }> = [];
  for (const f of findings) {
    for (const passage of [f.passage, f.passageB].filter(Boolean) as string[]) {
      const re = new RegExp(passage.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'));
      const m = re.exec(text);
      if (m) ranges.push({ start: m.index, end: m.index + m[0].length, label: f.label });
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  const parts: JSX.Element[] = [];
  let pos = 0;
  ranges.forEach((r, i) => {
    if (r.start < pos) return; // overlapping passages: keep the first
    parts.push(<span key={`t${i}`}>{text.slice(pos, r.start)}</span>);
    parts.push(
      <mark key={`m${i}`} title={r.label} className="rounded bg-prosecutor/15 px-0.5">
        {text.slice(r.start, r.end)}
      </mark>,
    );
    pos = r.end;
  });
  parts.push(<span key="end">{text.slice(pos)}</span>);
  return <div className="max-h-80 overflow-auto whitespace-pre-wrap rounded border border-rule bg-white p-4 text-sm leading-relaxed">{parts}</div>;
}

interface Finding {
  findingId: string;
  label: string;
  kind: string;
  passage: string;
  passageB: string | null;
  explanation: string;
  severity: 'low' | 'medium' | 'high';
  check: { performed: string; result: string };
  offerAsClaim: boolean;
}

function Chips({ ids, report }: { ids: string[]; report: Report }) {
  return (
    <>
      {ids.map((id) => (
        <EvidenceChip key={id} claimId={report.claim.claimId} evidenceId={id} evidence={report.evidence} />
      ))}
    </>
  );
}

function MessageBlock({ m, report }: { m: DebateMessage; report: Report }) {
  const { t } = useI18n();
  const tone = m.agentType === 'defender' ? 'border-defender' : 'border-prosecutor';
  const d = m.details as Record<string, unknown>;
  return (
    <div id={m.argumentId ? `msg-${m.argumentId}` : undefined} className={`scroll-mt-24 border-l-2 bg-white p-3 text-sm ${tone}`}>
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="font-medium text-ink">{t(`msg.${m.messageType}`)}</span>
        {m.argumentId && <span className="font-pixel text-[9px]">{m.argumentId}</span>}
        {m.referencedArgumentIds.length > 0 && <span>→ {m.referencedArgumentIds.join(', ')}</span>}
        {typeof d.accepts === 'boolean' && <span>{d.accepts ? t('msg.accepts') : t('msg.rebuts')}</span>}
        {typeof d.stance === 'string' && <Tag tone={d.stance === 'concedes' ? 'prosecutor' : 'neutral'}>{d.stance === 'concedes' ? t('res.concedes') : t('res.maintains')}</Tag>}
        {m.unsupportedAssertion && <Tag tone="wrong">{t('res.unsupported')}</Tag>}
      </div>
      <p>{m.content}</p>
      {typeof d.concessionNote === 'string' && <p className="mt-1 text-muted">{d.concessionNote}</p>}
      {typeof d.acknowledgement === 'string' && <p className="mt-1 text-muted">{d.acknowledgement}</p>}
      {typeof d.positionResearchResult === 'string' && <p className="mt-1 text-xs text-muted">{t(`res.positionResearch.${d.positionResearchResult}` as StringKey)}</p>}
      {m.referencedEvidenceIds.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          <Chips ids={m.referencedEvidenceIds} report={report} />
        </div>
      )}
    </div>
  );
}

function ArgumentMap({ report }: { report: Report }) {
  const { t } = useI18n();
  const args = report.messages.filter((m) => m.messageType === 'argument' && m.argumentId);
  const finals = report.messages.filter((m) => m.messageType === 'final_position');
  if (!args.length) return <p className="text-sm text-muted">{t('common.none')}</p>;
  const jump = (id: string) => document.getElementById(`msg-${id}`)?.scrollIntoView({ behavior: 'smooth' });
  return (
    <ul className="space-y-3 text-sm">
      {args.map((a) => {
        const chs = report.challenges.filter((c) => c.challengedArgumentId === a.argumentId);
        return (
          <li key={a.messageId}>
            <button onClick={() => jump(a.argumentId!)} className={`font-pixel text-[10px] ${a.agentType === 'defender' ? 'text-defender' : 'text-prosecutor'}`}>
              {a.argumentId}
            </button>{' '}
            <span className="text-muted">{a.content}</span>
            {chs.length > 0 && (
              <ul className="ml-5 mt-1 space-y-1 border-l border-rule pl-3">
                {chs.map((c) => (
                  <li key={c.challengeId}>
                    <button onClick={() => jump(c.challengeId)} className="font-pixel text-[9px] text-navy">
                      {c.challengeId}
                    </button>{' '}
                    {c.explanation}{' '}
                    <Tag tone={c.outcome === 'accepted' ? 'wrong' : c.outcome === 'rebutted' ? 'correct' : 'neutral'}>{t(`challenge.outcome.${c.outcome}`)}</Tag>
                    {c.response && <p className="ml-4 text-muted">↳ {c.response}</p>}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
      {finals.map((f) => (
        <li key={f.messageId} className="border-t border-rule pt-2">
          <span className={f.agentType === 'defender' ? 'text-defender' : 'text-prosecutor'}>{t(`agent.${f.agentType}`)}</span> — {t('msg.final_position')}: {f.content}
        </li>
      ))}
    </ul>
  );
}

export default function Results() {
  const { claimId } = useParams<{ claimId: string }>();
  const [params] = useSearchParams();
  const { t, formatDate } = useI18n();
  const navigate = useNavigate();
  const [report, setReport] = useState<Report | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [documentText, setDocumentText] = useState<string | null>(null);
  const [log, setLog] = useState<Array<{ logId: string; action: string; queryOrUrl: string; resultSummary: string; agentType: string; failureReason: string | null; details?: Record<string, unknown> }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [topicText, setTopicText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setReport(null);
    setError(null);
    api<Report>('GET', `/claims/${claimId}`)
      .then((r) => {
        setReport(r);
        setTopicText(r.claim.normalizedText);
        api<{ items: Finding[]; documentText: string | null }>('GET', `/verifications/${r.job.jobId}/findings`).then((f) => {
          setFindings(f.items);
          setDocumentText(f.documentText);
        }).catch(() => undefined);
        api<{ items: typeof log }>('GET', `/claims/${claimId}/research-log?limit=200`).then((l) => setLog(l.items)).catch(() => undefined);
      })
      .catch((e) => setError(e.message));
  }, [claimId]);

  if (error && !report) return <ErrorBox message={error === 'Not found.' ? t('common.notFound') : error} />;
  if (!report) return <Skeleton lines={8} />;

  const { decision, result, claim } = report;
  const sideName = (w: string) => t(w === 'DEFENDER' ? 'agent.defender' : 'agent.prosecutor');
  const isPast = params.get('past') === '1' || (result ? Date.now() - result.completedAtMs > 3600_000 : false);
  const research = report.research.find((r) => r.agentType === 'researcher')?.output;
  const steps = [...new Set(report.messages.map((m) => m.stepName))];

  async function act(key: string, path: string, body?: unknown) {
    setBusy(key);
    try {
      const r = await api<{ jobId: string }>('POST', path, body);
      navigate(`/investigations/${r.jobId}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  async function downloadPdf() {
    setBusy('pdf');
    try {
      const blob = await api<Blob>('GET', `/reports/${claim.claimId}.pdf`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `truthengine-${claim.claimId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="max-w-4xl">
      <PageTitle>{t('res.title')}</PageTitle>
      {report.readOnly && <Notice>{t('inv.readonly')}</Notice>}
      {error && <ErrorBox message={error} />}

      {/* Overview */}
      <section className="space-y-4">
        <p className="text-xs uppercase tracking-wide text-muted">{t('res.topic')}</p>
        <p className="text-xl font-medium leading-snug">{claim.normalizedText}</p>
        <div className="flex flex-wrap items-center gap-3">
          <VerdictBadge verdict={decision?.verdict ?? null} size="lg" />
          {decision && <span className="text-sm">{t(`res.basis.${decision.verdictBasis}`)}</span>}
        </div>
        {claim.outcome === 'research_failed' && <ErrorBox message={t('inv.researchFailed')} />}
        {claim.outcome === 'failed' && claim.failure && <ErrorBox message={t('inv.claimFailed', { message: claim.failure.message })} />}
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted">{t('res.subject')}</dt>
            <dd>
              {t(`subject.${claim.subject}` as StringKey)}
              {pageNumber(claim.context?.sourceLocation) && <span className="text-muted"> · {t('upload.page', { n: pageNumber(claim.context?.sourceLocation)! })}</span>}
            </dd>
          </div>
          {decision && (
            <div>
              <dt className="text-muted">{t('res.strength')}</dt>
              <dd>{t(`strength.${decision.evidenceStrength}`)}</dd>
            </div>
          )}
          {result && (
            <div>
              <dt className="text-muted">{t('res.evidence')}</dt>
              <dd>{t('res.sources', { total: result.sourceCounts.total, orgs: result.sourceCounts.organizations, verified: result.sourceCounts.verified })}</dd>
            </div>
          )}
        </dl>
        {result && (
          <p className="text-xs text-muted">
            {formatDate(result.completedAtMs)}
            {isPast && <span className="ml-2 text-prosecutor">{t('res.pastResult', { date: formatDate(result.completedAtMs) })}</span>}
          </p>
        )}
        <Notice>{t('res.disclaimer')}</Notice>
        {!report.readOnly && (
          <div className="flex flex-wrap gap-2">
            <Button variant={isPast ? 'primary' : 'secondary'} busy={busy === 'fresh'} onClick={() => void act('fresh', `/verifications/${report.job.jobId}/retry`, { claimIds: [claim.claimId] })}>
              {t('res.fresh')}
            </Button>
            <Button variant="secondary" busy={busy === 'deeper'} onClick={() => void act('deeper', `/verifications/${report.job.jobId}/claims/${claim.claimId}/deeper`)}>
              {t('res.deeper')}
            </Button>
            <Button variant="secondary" onClick={() => setEditing((e) => !e)}>
              {t('res.editTopic')}
            </Button>
            {decision && (
              <Button variant="secondary" busy={busy === 'pdf'} onClick={() => void downloadPdf()}>
                {t('res.download')}
              </Button>
            )}
            {decision && (
              <Button
                variant="secondary"
                busy={busy === 'receipt'}
                onClick={async () => {
                  setBusy('receipt');
                  try {
                    await api('POST', '/receipts', { claimId: claim.claimId });
                    navigate('/receipts');
                  } catch (e) {
                    setError((e as Error).message);
                    setBusy(null);
                  }
                }}
              >
                {t('res.receipt')}
              </Button>
            )}
            <Link to={`/investigations/${report.job.jobId}`} className="inline-flex items-center px-3 text-sm text-navy">
              {t('res.replay')}
            </Link>
          </div>
        )}
        {editing && (
          <div className="space-y-2">
            <Textarea rows={2} value={topicText} maxLength={400} onChange={(e) => setTopicText(e.target.value)} />
            <Button busy={busy === 'topic'} disabled={topicText.trim().length < 5} onClick={() => void act('topic', `/verifications/${report.job.jobId}/claims/${claim.claimId}/topic`, { normalizedText: topicText.trim() })}>
              {t('res.editTopic.save')}
            </Button>
          </div>
        )}
      </section>

      {/* Document Quality and Citation Audit */}
      {findings.length > 0 && (
          <Section title={t('res.audit')}>
            <p className="mb-3 text-sm text-muted">{t('res.audit.note')}</p>
            {documentText && (
              <div className="mb-4">
                <HighlightedDocument text={documentText} findings={findings} />
              </div>
            )}
            <ul className="space-y-3">
              {findings.map((f) => (
                <li key={f.findingId} className="rounded border border-rule bg-white p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{f.label}</span>
                    <Tag tone={f.severity === 'high' ? 'wrong' : f.severity === 'medium' ? 'prosecutor' : 'neutral'}>{f.severity}</Tag>
                  </div>
                  <mark className="mt-2 block bg-prosecutor/10 px-1">“{f.passage}”</mark>
                  {f.passageB && <mark className="mt-1 block bg-prosecutor/10 px-1">“{f.passageB}”</mark>}
                  <p className="mt-2">{f.explanation}</p>
                  <p className="mt-1 text-xs text-muted">
                    {t('res.audit.check')}: {f.check.performed} — {f.check.result}
                  </p>
                  {f.offerAsClaim && !report.readOnly && (
                    <Button
                      variant="secondary"
                      className="mt-2"
                      busy={busy === f.findingId}
                      onClick={async () => {
                        setBusy(f.findingId);
                        try {
                          const r = await api<{ jobId: string }>('POST', '/verifications', { text: f.passage, idempotencyKey: newIdempotencyKey() });
                          navigate(`/investigations/${r.jobId}`);
                        } catch (e) {
                          setError((e as Error).message);
                          setBusy(null);
                        }
                      }}
                    >
                      {t('res.audit.offer')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Section>
      )}

      {/* Believability */}
      {decision && (
        <Section title={t('res.believability')}>
          <div className="grid gap-6 sm:grid-cols-2">
            {(
              [
                ['whyBelievable', 'res.whyBelievable'],
                ['whyMightBeWrong', 'res.whyWrong'],
                ['canEstablish', 'res.canEstablish'],
                ['cannotEstablish', 'res.cannotEstablish'],
              ] as const
            ).map(([k, label]) => (
              <div key={k}>
                <h3 className="text-sm font-medium">{t(label)}</h3>
                <ul className="mt-2 space-y-2 text-sm">
                  {decision.believability[k].length === 0 && <li className="text-muted">{t('common.none')}</li>}
                  {decision.believability[k].map((b, i) => (
                    <li key={i}>
                      {b.text} <Chips ids={b.evidenceIds} report={report} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Evidence */}
      <Section title={t('res.evidence')}>
        {report.evidence.length === 0 ? (
          <p className="text-sm text-muted">{t('res.evidence.none')}</p>
        ) : (
          <ul className="space-y-4">
            {report.evidence.map((e) => (
              <li key={e.evidenceId} className="rounded-lg border border-rule bg-white p-4">
                <EvidenceDetails e={e} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Debate */}
      {report.messages.length > 0 && (
        <Section title={t('res.debate')}>
          {steps.map((step) => (
            <div key={step} className="mb-6">
              <h3 className="mb-3 text-sm font-medium text-muted">{t(`step.${step}` as StringKey)}</h3>
              <div className="grid gap-4 md:grid-cols-2">
                {(['defender', 'prosecutor'] as const).map((side) => (
                  <div key={side} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <PixelAgent agent={side} size={36} label={false} state={decision ? (decision.winner.toLowerCase() === side ? 'winner' : 'loser') : 'idle'} />
                      <span className={`font-pixel text-[9px] uppercase ${side === 'defender' ? 'text-defender' : 'text-prosecutor'}`}>{t(`agent.${side}`)}</span>
                    </div>
                    {report.messages
                      .filter((m) => m.stepName === step && m.agentType === side)
                      .map((m) => (
                        <MessageBlock key={m.messageId} m={m} report={report} />
                      ))}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </Section>
      )}

      {report.messages.length > 0 && (
        <Section title={t('res.argumentMap')}>
          <ArgumentMap report={report} />
        </Section>
      )}

      {/* Judge ruling */}
      {decision && (
        <Section title={t('res.judge')}>
          <div className="flex gap-4">
            <PixelAgent agent="judge" size={64} label={false} />
            <div className="space-y-4 text-sm">
              <p className="text-base">{t('res.iChoose', { side: sideName(decision.winner), reason: decision.reasoning })}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <h3 className="font-medium">{t('res.established')}</h3>
                  <ul className="mt-1 list-disc pl-5">{decision.whatWasEstablished.map((s, i) => <li key={i}>{s}</li>)}</ul>
                </div>
                <div>
                  <h3 className="font-medium">{t('res.notEstablished')}</h3>
                  <ul className="mt-1 list-disc pl-5">{decision.whatWasNotEstablished.map((s, i) => <li key={i}>{s}</li>)}</ul>
                </div>
                {(['defender', 'prosecutor'] as const).map((side) => (
                  <div key={side}>
                    <h3 className="font-medium">{t('res.sideEstablished', { side: t(`agent.${side}`) })}</h3>
                    <ul className="mt-1 list-disc pl-5">{decision[side].established.map((s, i) => <li key={i}>{s}</li>)}</ul>
                    <h3 className="mt-2 font-medium">{t('res.sideFailed', { side: t(`agent.${side}`) })}</h3>
                    <ul className="mt-1 list-disc pl-5">{decision[side].failedToEstablish.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                ))}
              </div>
              <div>
                <h3 className="font-medium">{t('res.decisive')}</h3>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Chips ids={decision.decisiveEvidenceIds} report={report} />
                </div>
                <p className="mt-1">{decision.decisiveEvidenceRationale}</p>
              </div>
              {decision.acceptedArgumentIds.length > 0 && (
                <p>
                  <span className="font-medium">{t('res.accepted')}: </span>
                  {decision.acceptedArgumentIds.join(', ')}
                </p>
              )}
              {decision.rejectedArguments.length > 0 && (
                <div>
                  <h3 className="font-medium">{t('res.rejected')}</h3>
                  <ul className="mt-1 space-y-1">
                    {decision.rejectedArguments.map((r) => (
                      <li key={r.argumentId}>
                        <span className="font-pixel text-[9px]">{r.argumentId}</span> — {r.reason}: {r.note}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <h3 className="font-medium">{t('res.conclusion')}</h3>
                <p>{decision.studentConclusion}</p>
              </div>
            </div>
          </div>
        </Section>
      )}

      {decision && decision.limitations.length > 0 && (
        <Section title={t('res.limitations')}>
          <ul className="list-disc pl-5 text-sm">{decision.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </Section>
      )}

      {/* Learning takeaway */}
      {report.explanation && (
        <Section title={t('res.learning')}>
          <div className="space-y-4 text-sm">
            <p className="font-medium">{report.explanation.keyLesson}</p>
            <p className="whitespace-pre-wrap leading-relaxed">{report.explanation.explanation}</p>
            {report.explanation.fallacies.length > 0 && (
              <div>
                <h3 className="font-medium">{t('learn.fallacies')}</h3>
                <ul className="mt-1 space-y-1">
                  {report.explanation.fallacies.map((f, i) => (
                    <li key={i}>
                      <strong>{f.name}</strong>
                      {f.argumentId && <span className="ml-1 font-pixel text-[9px]">({f.argumentId})</span>}: {f.explanation}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {report.explanation.sourceEvaluationTips.length > 0 && (
              <div>
                <h3 className="font-medium">{t('learn.tips')}</h3>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {report.explanation.sourceEvaluationTips.map((tip, i) => (
                    <li key={i}>
                      {tip.tip} {tip.evidenceId && <Chips ids={[tip.evidenceId]} report={report} />}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="space-y-3">
              {report.exercises.map((x: Exercise) => (
                <ExerciseCard key={x.exerciseId} exercise={x} readOnly={report.readOnly} />
              ))}
            </div>
          </div>
        </Section>
      )}

      {/* Research log */}
      <Section title={t('res.researchLog')}>
        {research && (
          <p className="mb-3 text-xs text-muted">
            {t('res.researchUsed', { searches: research.used?.searches ?? 0, pages: research.used?.pages ?? 0, pdf: research.used?.pdfPages ?? 0, reason: research.stopReason ?? '—' })}
          </p>
        )}
        <ol className="max-h-96 space-y-1 overflow-auto text-xs">
          {log.map((l) => {
            const d = { ...(l.details ?? {}), failureReason: l.failureReason } as Record<string, any>;
            return (
              <li key={l.logId} className="border-b border-rule/60 pb-1.5">
                <span className="font-medium">{t(`agent.${l.agentType}` as StringKey)}</span>: {describeResearch(d, t, `${l.queryOrUrl} — ${l.resultSummary}`)}
                {Array.isArray(d.sites) && d.sites.length > 0 && (
                  <span className="mt-1 flex flex-wrap gap-1">
                    {(d.sites as string[]).map((site) => (
                      <Tag key={site}>{site}</Tag>
                    ))}
                  </span>
                )}
                {typeof d.url === 'string' && (
                  <a href={d.url} target="_blank" rel="noopener noreferrer nofollow" className="block text-[11px] text-muted [overflow-wrap:anywhere] hover:text-navy">
                    {d.url}
                  </a>
                )}
              </li>
            );
          })}
        </ol>
      </Section>
    </article>
  );
}
