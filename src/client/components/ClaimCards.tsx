// "Virtual courtroom" selector: one card per claim with its real state. Clicking a
// card shows only that claim's conversation, so parallel debates never overwrite
// each other on screen.
import { useI18n } from '../i18n';
import type { StringKey } from '../i18n/en';
import type { ClaimView, StageView } from '../lib/types';
import { VerdictBadge } from './ui';

export const OVERVIEW = 'overview';

function stagesOf(stages: StageView[], claimId: string) {
  return stages.filter((s) => s.stageKey.split(':')[1] === claimId);
}

/** Planned number of steps for a claim (debate length is known once triage sets the mode). */
function plannedSteps(claim: ClaimView): number {
  const debate = claim.debateMode === 'full' ? 5 : 3;
  return 1 + 4 + debate + 2; // triage, 4 research stages, debate, judge, pedagogue
}

function stepLabel(t: ReturnType<typeof useI18n>['t'], stageKey: string): string {
  const [kind, , step] = stageKey.split(':');
  return kind === 'debate' && step ? t(`step.${step}` as StringKey) : t(`stage.${kind}` as StringKey);
}

export function ClaimCards({
  claims,
  stages,
  selected,
  onSelect,
  unseen,
}: {
  claims: ClaimView[];
  stages: StageView[];
  selected: string;
  onSelect: (id: string) => void;
  /** Claims (or OVERVIEW) with events the viewer has not looked at yet. */
  unseen: Set<string>;
}) {
  const { t } = useI18n();
  const jobStages = stages.filter((s) => !s.stageKey.includes(':') && s.stageKey !== 'finalize');
  const overviewRunning = jobStages.some((s) => s.status === 'leased');

  const card = (id: string, active: boolean, children: React.ReactNode, running: boolean) => (
    <li key={id}>
      <button
        onClick={() => onSelect(id)}
        aria-pressed={active}
        className={`relative flex h-full w-full flex-col gap-2 rounded-xl border bg-white p-4 text-left transition-colors ${active ? 'border-ink shadow-[3px_3px_0_0_rgba(0,0,0,0.12)]' : 'border-rule hover:border-ink/40'}`}
      >
        {running && <span className="absolute right-3 top-3 h-2 w-2 animate-pulse rounded-full bg-navy" aria-hidden />}
        {unseen.has(id) && !active && (
          <span className="absolute right-3 top-6 rounded bg-navy/10 px-1 text-[10px] text-navy">{t('inv.card.new')}</span>
        )}
        {children}
      </button>
    </li>
  );

  return (
    <div>
      <p className="mb-2 text-xs text-muted">{t('inv.courtroom.hint')}</p>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {card(
          OVERVIEW,
          selected === OVERVIEW,
          <>
            <span className="font-pixel text-[10px] text-navy">{t('inv.overview')}</span>
            <span className="text-sm">{t('inv.overview.text')}</span>
            <span className="mt-auto text-xs text-muted">
              {jobStages.map((s) => `${stepLabel(t, s.stageKey)}: ${t(`stage.status.${s.status}`)}`).join(' · ')}
            </span>
          </>,
          overviewRunning,
        )}
        {claims.map((c, i) => {
          const own = stagesOf(stages, c.claimId);
          const runningStage = own.find((s) => s.status === 'leased');
          const finished = c.outcome !== 'pending' && !runningStage;
          const doneReal = own.filter((s) => s.status === 'completed' || s.status === 'skipped').length;
          // A finished claim shows its real step count; a running one never shows fewer planned steps than exist.
          const total = finished ? Math.max(1, own.length) : Math.max(plannedSteps(c), own.length);
          const done = finished ? total : doneReal;
          const status = runningStage
            ? stepLabel(t, runningStage.stageKey)
            : finished
              ? t('inv.card.done')
              : own.length
                ? t('stage.status.pending')
                : t('inv.card.waiting');
          return card(
            c.claimId,
            selected === c.claimId,
            <>
              <span className="font-pixel text-2xl leading-none">{i + 1}</span>
              <span className="line-clamp-3 text-sm leading-snug">{c.normalizedText}</span>
              <span className="mt-auto space-y-1.5">
                <span className="flex items-center justify-between gap-2 text-xs text-muted">
                  <span className="truncate">{status}</span>
                  {c.verdict && <VerdictBadge verdict={c.verdict} />}
                </span>
                {c.outcome === 'research_failed' && <span className="block text-xs text-wrong">{t('status.research_failed')}</span>}
                {c.outcome === 'failed' && <span className="block text-xs text-wrong">{t('status.failed')}</span>}
                <span className="block h-1 overflow-hidden rounded bg-rule" aria-label={t('inv.card.steps', { done, total })}>
                  <span className="block h-full bg-navy transition-all" style={{ width: `${Math.min(100, (done / total) * 100)}%` }} />
                </span>
                <span className="block text-[11px] text-muted">{t('inv.card.steps', { done, total })}</span>
              </span>
            </>,
            Boolean(runningStage),
          );
        })}
      </ul>
    </div>
  );
}
