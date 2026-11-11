import { CheckCircle2, CircleDashed, Loader2, MinusCircle, XCircle } from 'lucide-react';
import { useI18n } from '../i18n';
import { stageLabel } from '../lib/events';
import type { StageView } from '../lib/types';

const ICON = {
  completed: <CheckCircle2 className="h-3.5 w-3.5 text-correct" aria-hidden />,
  skipped: <MinusCircle className="h-3.5 w-3.5 text-muted" aria-hidden />,
  failed: <XCircle className="h-3.5 w-3.5 text-wrong" aria-hidden />,
  leased: <Loader2 className="h-3.5 w-3.5 animate-spin text-navy" aria-hidden />,
  pending: <CircleDashed className="h-3.5 w-3.5 text-muted" aria-hidden />,
};

/** Real stage status and real recorded durations (no estimated completion times). */
export function PipelineStrip({ stages, claimNumber }: { stages: StageView[]; claimNumber: (id: string) => number | null }) {
  const { t } = useI18n();
  return (
    <ol className="flex flex-wrap gap-1.5" aria-label={t('inv.pipeline')}>
      {stages.map((s) => (
        <li key={s.stageKey} className="flex flex-wrap items-center gap-1 rounded border border-rule bg-white px-2 py-1 text-xs" title={s.errorMessage ?? undefined}>
          {ICON[s.status]}
          <span>{stageLabel(t, s.stageKey, claimNumber)}</span>
          {s.durationMs !== null && s.status !== 'leased' && <span className="text-muted">{(s.durationMs / 1000).toFixed(1)}s</span>}
          {s.status === 'failed' && s.errorMessage && <span className="text-wrong">— {s.errorMessage}</span>}
          {s.status === 'failed' && s.errorDetail && <span className="block w-full text-[10px] text-muted">{s.errorDetail}</span>}
          {s.status === 'pending' && s.errorMessage && <span className="text-prosecutor">— {s.errorMessage}</span>}
        </li>
      ))}
    </ol>
  );
}
