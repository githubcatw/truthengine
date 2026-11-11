// Live investigation animation (PART 14). A visual representation of persisted
// events only: every bubble, query and verdict comes from a stored record.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useReducedMotion } from 'framer-motion';
import { FastForward, Pause, Play, Rewind, SkipBack, SkipForward, FileText } from 'lucide-react';
import { PixelAgent, SpeechBubble } from '../pixel/PixelAgent';
import type { AgentKind, AgentState } from '../pixel/sprites';
import { describeEvent, eventExtras, stageLabel } from '../lib/events';
import { useI18n } from '../i18n';
import type { ClaimView, InvestigationEvent } from '../lib/types';
import { EvidenceChip } from './Evidence';
import { VerdictBadge } from './ui';

const TECHNICAL = new Set(['stage_started', 'stage_completed', 'stage_retry', 'research_log', 'evidence_saved', 'extraction_page']);

function displayMs(e: InvestigationEvent | undefined, reduce: boolean, live: boolean): number {
  if (!e) return 0;
  if (reduce) return 400;
  if (e.type === 'judge_decision') return 7000;
  if (e.type === 'debate_message') return Math.min(7000, 2500 + (e.summary?.length ?? 0) * 18);
  // While live, small technical steps pass quickly so playback keeps up with the real work.
  if (TECHNICAL.has(e.type)) return live ? 800 : 1500;
  return 2500;
}

/** Which agent is doing the work of a running stage (keeps its "working" animation going). */
function agentForStage(stageKey: string): AgentKind | null {
  const kind = stageKey.split(':')[0]!;
  if (kind === 'extract_claims' || kind === 'triage') return 'claim_extractor';
  if (kind === 'audit') return 'quality_auditor';
  if (kind.startsWith('research')) return 'researcher';
  if (kind === 'judge') return 'judge';
  if (kind === 'pedagogue') return 'pedagogue';
  return null;
}

const SiteChip = ({ site }: { site: string }) => <span className="rounded border border-rule bg-paper px-1.5 py-0.5 text-[11px] text-ink">{site}</span>;

function agentOf(e: InvestigationEvent | undefined): AgentKind | null {
  if (!e) return null;
  switch (e.type) {
    case 'debate_message':
      return e.agentType === 'prosecutor' ? 'prosecutor' : 'defender';
    case 'judge_decision':
      return 'judge';
    case 'pedagogue_lesson':
      return 'pedagogue';
    case 'quality_finding':
      return 'quality_auditor';
    case 'extraction_page':
      return 'content_extractor';
    case 'claims_extracted':
    case 'triage_completed':
      return 'claim_extractor';
    case 'research_log':
    case 'evidence_saved':
      return e.agentType === 'defender' ? 'defender' : e.agentType === 'prosecutor' ? 'prosecutor' : 'researcher';
    default:
      if (e.stageKey?.startsWith('extract_claims') || e.stageKey?.startsWith('triage')) return 'claim_extractor';
      if (e.stageKey?.startsWith('audit')) return 'quality_auditor';
      if (e.stageKey?.startsWith('research')) return 'researcher';
      if (e.stageKey?.startsWith('judge')) return 'judge';
      if (e.stageKey?.startsWith('pedagogue')) return 'pedagogue';
      return null;
  }
}

export default function InvestigationStage({
  events,
  claims,
  finished,
  loaded,
  focusClaimId,
  running = [],
  initialPointer,
  onPointer,
}: {
  /** Events of the selected courtroom only (one claim, or the job-level overview). */
  events: InvestigationEvent[];
  claims: ClaimView[];
  finished: boolean;
  loaded: boolean;
  focusClaimId: string | null;
  /** Stage keys currently running for this courtroom. */
  running?: string[];
  /** Where the viewer left this courtroom last time (kept per claim). */
  initialPointer?: number;
  onPointer?: (pointer: number) => void;
}) {
  const { t } = useI18n();
  const reduce = Boolean(useReducedMotion());
  const [pointer, setPointer] = useState(-1);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<1 | 2 | 4>(1);
  const [fastForwarded, setFastForwarded] = useState(false);

  // On refresh: fast-forward through already-persisted events, then continue live.
  useEffect(() => {
    if (loaded && !fastForwarded) {
      setPointer(initialPointer !== undefined ? Math.min(initialPointer, events.length - 1) : events.length > 3 ? events.length - 1 : -1);
      setFastForwarded(true);
    }
  }, [loaded, fastForwarded, events.length]);

  // Playback queue with a minimum readable display time; speeds up when far behind.
  useEffect(() => {
    if (paused || pointer >= events.length - 1) return;
    const behind = events.length - 1 - pointer;
    // Live: catch up quickly so the timeline does not lag behind the real progress.
    const auto = !finished ? (behind > 6 ? 4 : behind > 2 ? 2 : 1) : behind > 20 ? 4 : behind > 8 ? 2 : 1;
    const ms = pointer < 0 ? 200 : displayMs(events[pointer], reduce, !finished) / ((finished ? speed : 1) * auto);
    const id = setTimeout(() => setPointer((p) => Math.min(p + 1, events.length - 1)), ms);
    return () => clearTimeout(id);
  }, [pointer, events, paused, speed, reduce, finished]);

  useEffect(() => {
    if (fastForwarded) onPointer?.(pointer);
  }, [pointer, fastForwarded, onPointer]);

  useEffect(() => {
    if (pointer > events.length - 1) setPointer(events.length - 1);
  }, [pointer, events.length]);
  const shown = useMemo(() => events.slice(0, pointer + 1), [events, pointer]);
  const current = shown[shown.length - 1];
  // Inside one courtroom the claim is already known, so stage labels need no "Claim N" prefix.
  const claimNumber = (_id: string): number | null => null;
  const currentClaimId = focusClaimId;
  const topic = focusClaimId ? claims.find((c) => c.claimId === focusClaimId)?.normalizedText : null;
  const forClaim = (e: InvestigationEvent) => !currentClaimId || e.claimId === currentClaimId;
  const working = new Set(running.map(agentForStage).filter(Boolean) as AgentKind[]);

  const lastOf = (pred: (e: InvestigationEvent) => boolean) => [...shown].reverse().find((e) => forClaim(e) && pred(e));
  const defMsg = lastOf((e) => e.type === 'debate_message' && e.agentType === 'defender');
  const proMsg = lastOf((e) => e.type === 'debate_message' && e.agentType === 'prosecutor');
  const decision = lastOf((e) => e.type === 'judge_decision');
  const evidence = shown.filter((e) => e.type === 'evidence_saved' && forClaim(e));
  const active = agentOf(current);
  const winner = decision ? ((decision.data as { winner: string }).winner === 'DEFENDER' ? 'defender' : 'prosecutor') : null;

  const stateFor = (who: 'defender' | 'prosecutor' | 'judge'): AgentState => {
    if (decision && who !== 'judge') return winner === who ? 'winner' : 'loser';
    if (who === 'judge') return active === 'judge' ? 'talking' : decision ? 'idle' : working.has('judge') || current?.stageKey?.startsWith('debate') ? 'thinking' : 'idle';
    if (active === who) return current?.type === 'research_log' || current?.type === 'evidence_saved' ? 'researching' : 'talking';
    const target = (current?.data as { referencedArgumentIds?: string[] })?.referencedArgumentIds?.[0] ?? '';
    if (current?.type === 'debate_message' && (current.data as { messageType: string }).messageType === 'challenge' && target.startsWith(who === 'defender' ? 'D-' : 'P-')) return 'hit';
    return current?.type === 'debate_message' ? 'thinking' : 'idle';
  };

  const chips = (e: InvestigationEvent | undefined) => {
    if (!e) return null;
    const sites = eventExtras(e).sites;
    if (sites.length) return sites.map((site) => <SiteChip key={site} site={site} />);
    return e.claimId ? ((e.data as { evidenceIds?: string[] }).evidenceIds ?? []).map((id) => <EvidenceChip key={id} claimId={e.claimId!} evidenceId={id} />) : null;
  };
  /** Source link of a page action, small and wrapped inside the bubble. */
  const footer = (e: InvestigationEvent | undefined) => {
    const url = e ? eventExtras(e).url : null;
    return url ? (
      <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="hover:text-navy">
        {url}
      </a>
    ) : null;
  };

  const bubbleHeader = (e: InvestigationEvent) => {
    const d = e.data as { messageType?: string; argumentId?: string; referencedArgumentIds?: string[]; step?: string; unsupported?: boolean };
    const parts = [d.step ? t(`step.${d.step}` as never) : null, d.messageType === 'challenge' ? t('anim.challenging', { id: d.referencedArgumentIds?.[0] ?? '' }) : d.argumentId, d.unsupported ? t('res.unsupported') : null];
    return parts.filter(Boolean).join(' · ');
  };

  const workbench: AgentKind[] = ['content_extractor', 'quality_auditor', 'claim_extractor', 'researcher', 'pedagogue'];
  const benchActive = active && workbench.includes(active) ? active : null;
  const isDebate = current?.type === 'debate_message';
  const challengeLine = isDebate && ['challenge', 'response'].includes((current!.data as { messageType: string }).messageType);
  const stageStarts = events.map((e, i) => (e.type === 'stage_started' ? i : -1)).filter((i) => i >= 0);
  const atEnd = pointer >= events.length - 1;
  const decisions = events.filter((e) => e.type === 'judge_decision');

  return (
    <div className="space-y-4">
      {topic && (
        <div className="sticky top-14 z-10 rounded-md border border-rule bg-paper/95 px-4 py-2 text-sm backdrop-blur">
          <span className="font-pixel text-[9px] uppercase tracking-wider text-navy">{t('inv.debating', { topic: '' })}</span> {topic}
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <button className="rounded border border-rule bg-white px-2 py-1" onClick={() => setPaused((p) => !p)} aria-label={paused ? t('anim.resume') : t('anim.pause')}>
          {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
        </button>
        {/* Speed control only for replays: a live session follows the real pace. */}
        {finished && (
          <>
            <span className="ml-1 text-muted">{t('anim.speed')}:</span>
            {([1, 2, 4] as const).map((s) => (
              <button key={s} className={`rounded border px-2 py-1 ${speed === s ? 'border-navy text-navy' : 'border-rule bg-white'}`} onClick={() => setSpeed(s)}>
                {s}x
              </button>
            ))}
          </>
        )}
        <button className="rounded border border-rule bg-white px-2 py-1" onClick={() => setPointer(Math.max(-1, ([...stageStarts].reverse().find((i) => i < pointer) ?? -1)))} aria-label={t('anim.prevStage')} title={t('anim.prevStage')}>
          <SkipBack className="h-3.5 w-3.5" />
        </button>
        <button className="rounded border border-rule bg-white px-2 py-1" onClick={() => setPointer(stageStarts.find((i) => i > pointer) ?? events.length - 1)} aria-label={t('anim.nextStage')} title={t('anim.nextStage')}>
          <SkipForward className="h-3.5 w-3.5" />
        </button>
        <button className="rounded border border-rule bg-white px-2 py-1" onClick={() => setPointer(events.length - 1)} title={t('anim.latest')}>
          <FastForward className="mr-1 inline h-3.5 w-3.5" />
          {t('anim.latest')}
        </button>
        <button className="rounded border border-rule bg-white px-2 py-1" onClick={() => { setPointer(-1); setPaused(false); }} title={t('anim.replay')}>
          <Rewind className="mr-1 inline h-3.5 w-3.5" />
          {t('anim.replay')}
        </button>
        <a href="#report" className="rounded border border-rule bg-white px-2 py-1">
          <FileText className="mr-1 inline h-3.5 w-3.5" />
          {t('anim.report')}
        </a>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted">
        {t('anim.timeline')}
        <input type="range" className="flex-1 accent-navy" min={-1} max={Math.max(0, events.length - 1)} value={pointer} onChange={(e) => setPointer(Number(e.target.value))} />
        <span>
          {pointer + 1}/{events.length}
        </span>
      </label>

      {/* Desktop/tablet stage */}
      <div className="hidden rounded-lg border border-rule bg-white p-4 md:block">
        <div className="flex flex-col items-center gap-2">
          <PixelAgent agent="judge" state={stateFor('judge')} size={88} />
          {decision && (
            <div className="flex flex-col items-center gap-2">
              <SpeechBubble agent="judge" side="top" text={describeEvent(decision, t)} chips={chips(decision)} typeMs={active === 'judge' ? 18 : 0} />
              <VerdictBadge verdict={(decision.data as { verdict: 'CORRECT' | 'WRONG' }).verdict} size="lg" />
            </div>
          )}
        </div>
        <div className="mt-4 grid grid-cols-[auto_1fr_auto] items-start gap-4">
          <div className="flex flex-col items-center">
            <PixelAgent agent="defender" state={stateFor('defender')} size={96} />
          </div>
          <div className="min-h-[10rem] space-y-3">
            <div className="flex justify-between gap-3">
              <div className="flex-1">{defMsg && <SpeechBubble agent="defender" side="left" header={bubbleHeader(defMsg)} text={defMsg.summary ?? ''} chips={chips(defMsg)} typeMs={current === defMsg ? 18 : 0} />}</div>
              <div className="flex flex-1 justify-end">{proMsg && <SpeechBubble agent="prosecutor" side="right" header={bubbleHeader(proMsg)} text={proMsg.summary ?? ''} chips={chips(proMsg)} typeMs={current === proMsg ? 18 : 0} />}</div>
            </div>
            {challengeLine && (
              <svg viewBox="0 0 100 6" className="h-3 w-full" aria-hidden>
                <line x1="5" y1="3" x2="95" y2="3" stroke={current!.agentType === 'defender' ? '#1E6E78' : '#A4492F'} strokeWidth="1" strokeDasharray="3 2" />
                {current!.agentType === 'defender' ? <polygon points="95,0 100,3 95,6" fill="#1E6E78" /> : <polygon points="5,0 0,3 5,6" fill="#A4492F" />}
              </svg>
            )}
            {evidence.length > 0 && (
              <div className="flex flex-wrap justify-center gap-1 border-t border-dashed border-rule pt-3">
                {evidence.map((e) => (
                  <EvidenceChip key={e.seq} claimId={e.claimId!} evidenceId={(e.data as { evidenceId: string }).evidenceId} />
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-col items-center">
            <PixelAgent agent="prosecutor" state={stateFor('prosecutor')} size={96} />
          </div>
        </div>
        <div className="mt-6 flex flex-wrap items-end justify-center gap-3 border-t border-rule pt-4">
          {workbench.map((a) => (
            <PixelAgent
              key={a}
              agent={a}
              size={52}
              state={
                benchActive === a
                  ? a === 'researcher' || a === 'claim_extractor'
                    ? 'researching'
                    : 'talking'
                  : working.has(a)
                    ? 'researching'
                    : 'idle'
              }
            />
          ))}
        </div>
        <div className="mt-3 flex justify-center">
          {current && !isDebate && current.type !== 'judge_decision' ? (
            <SpeechBubble agent={benchActive ?? 'system'} side="top" header={stageLabel(t, current.stageKey, claimNumber)} text={describeEvent(current, t, claimNumber)} chips={chips(current)} footer={footer(current)} typeMs={TECHNICAL.has(current.type) ? 0 : 18} />
          ) : (
            !current && <p className="text-sm text-muted">{t('anim.waiting')}</p>
          )}
        </div>
      </div>

      {/* Mobile: chronological stack, each character beside its bubble */}
      <ol className="space-y-3 md:hidden">
        {shown.slice(-12).map((e) => {
          const a = agentOf(e);
          return (
            <li key={e.seq} className="flex items-start gap-2">
              {a ? <PixelAgent agent={a} size={40} label={false} state={e === current ? 'talking' : 'idle'} /> : <span className="w-10" />}
              <SpeechBubble agent={a ?? 'system'} side="left" header={stageLabel(t, e.stageKey, claimNumber)} text={describeEvent(e, t, claimNumber)} chips={chips(e)} footer={footer(e)} typeMs={e === current && !TECHNICAL.has(e.type) ? 18 : 0} />
            </li>
          );
        })}
      </ol>

      {finished && atEnd && decisions.length > 0 && (
        <div className="rounded-lg border border-rule bg-white p-4" id="report">
          <ul className="space-y-2">
            {decisions.map((d) => (
              <li key={d.seq} className="flex flex-wrap items-center gap-3">
                <VerdictBadge verdict={(d.data as { verdict: 'CORRECT' | 'WRONG' }).verdict} size="lg" />
                <span className="min-w-0 flex-1">{claims.find((c) => c.claimId === d.claimId)?.normalizedText}</span>
                <Link to={`/results/${d.claimId}`} className="text-sm font-medium text-navy">
                  {t('inv.viewReport')}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Text transcript of the same events (accessible without animation) */}
      <details className="rounded-lg border border-rule bg-white p-4" open={reduce}>
        <summary className="cursor-pointer text-sm font-medium">{t('inv.transcript')}</summary>
        <ol className="mt-3 max-h-96 space-y-1 overflow-auto text-sm" aria-live="polite">
          {shown.map((e) => (
            <li key={e.seq} className="border-b border-rule/60 pb-1">
              <span className="mr-2 font-pixel text-[8px] text-muted">#{e.seq}</span>
              {e.agentType && <span className="mr-1 font-medium">{t(`agent.${e.agentType}` as never)}:</span>}
              {describeEvent(e, t, claimNumber)}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
