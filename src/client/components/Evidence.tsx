import { useEffect, useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import type { EvidenceRecord, ProvenanceStatus } from '../../shared/schemas';
import { api } from '../lib/api';
import { useI18n } from '../i18n';
import type { Report } from '../lib/types';
import type { StringKey } from '../i18n/en';
import { Tag } from './ui';

const PROV_TONE: Record<ProvenanceStatus, 'correct' | 'neutral' | 'prosecutor' | 'wrong'> = {
  quote_verified: 'correct',
  fetched: 'neutral',
  search_metadata_only: 'prosecutor',
  retrieval_failed: 'wrong',
};

export function ProvenanceLabel({ status }: { status: ProvenanceStatus }) {
  const { t } = useI18n();
  return <Tag tone={PROV_TONE[status]}>{t(`prov.${status}`)}</Tag>;
}

/** Full evidence card: layer A provenance, layer B quality, layer C relation. */
export function EvidenceDetails({ e }: { e: EvidenceRecord }) {
  const { t, formatDate } = useI18n();
  const q = e.qualityAssessment;
  const pol = e.sourcePolicy;
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-pixel text-[10px] text-navy">[{e.evidenceId}]</span>
        <ProvenanceLabel status={e.provenanceStatus} />
        {e.failureReason && <Tag tone="wrong">{t(`fail.${e.failureReason}`)}</Tag>}
        {!e.countsAsIndependent && e.provenanceStatus === 'quote_verified' && <Tag>{t('ev.notIndependent')}</Tag>}
        {pol?.use === 'context_only' && <Tag tone="prosecutor">{t('cred.contextOnly')}</Tag>}
      </div>
      <p className="font-medium">{e.sourceTitle ?? e.domain}</p>
      <p className="text-muted">
        {[e.sourceOrganization, e.domain, e.sourceType, e.publicationDate].filter(Boolean).join(' · ')}
      </p>
      {e.urlOrigin === 'classroom_material' ? (
        <p className="text-navy">{e.sourceTitle ?? e.domain}</p>
      ) : (
        <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex max-w-full items-center gap-1 break-all text-navy">
          {e.sourceUrl} <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
        </a>
      )}
      <p className="text-xs text-muted">
        {t('ev.retrieved', { date: formatDate(Date.parse(e.retrievalDate)) })} · {t(`origin.${e.urlOrigin}`)} · {t('ev.foundBy', { agent: t(`agent.${e.foundByAgent}`) })}
        {e.excerptLocation && ` · ${t('ev.location', { loc: e.excerptLocation })}`}
      </p>
      {e.excerpt ? (
        <blockquote className="border-l-2 border-correct pl-3 italic">“{e.excerpt}”</blockquote>
      ) : (
        e.snippet && (
          <div className="border-l-2 border-dashed border-prosecutor pl-3 text-muted">
            <span className="block text-xs not-italic">{t('prov.search_metadata_only')}</span>
            {e.snippet}
          </div>
        )
      )}
      {e.urlOrigin !== 'classroom_material' && (
        <p className="text-xs">
          <span className="font-medium">{t('cred.label')}{t('punct.label')}</span>{' '}
          {pol ? (
            <>
              {t(`quality.${pol.tier}`)} — <span className="text-muted">{t(`cred.cat.${pol.category}`)}</span>
              {pol.use === 'context_only' && pol.attribution && <span className="text-muted"> · {t('cred.speaks')}</span>}
            </>
          ) : (
            <span className="text-muted">{t('cred.unlisted')}</span>
          )}
        </p>
      )}
      {q && (
        <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
          {(['credibility', 'currency', 'methodology', 'independence', 'relevance'] as const).map((k) => (
            <div key={k}>
              <dt className="inline font-medium">{t(`quality.${k}`)}{t('punct.label')}</dt>
              <dd className="inline">
                {t(`quality.${q[k].rating}`)} — <span className="text-muted">{q[k].rationale}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {e.provisionalRelation && (
        <p className="text-xs">
          {t('ev.provisional')}{t('punct.label')}{t(`relation.${e.provisionalRelation}`)}
          {e.directness && `, ${t(`directness.${e.directness}`)}`}
          {e.conditionsMatch === false && <span className="text-prosecutor"> · {t('ev.conditionsMismatch')}</span>}
          {e.conditionsNote && <span className="text-muted"> ({e.conditionsNote})</span>}
        </p>
      )}
      {e.originalSourceId && <p className="text-xs text-muted">↳ {e.originalSourceId}</p>}
    </div>
  );
}

const reportCache = new Map<string, Promise<Report>>();
export function loadReport(claimId: string): Promise<Report> {
  if (!reportCache.has(claimId)) {
    const p = api<Report>('GET', `/claims/${claimId}`);
    p.catch(() => reportCache.delete(claimId));
    reportCache.set(claimId, p);
  }
  return reportCache.get(claimId)!;
}
export function invalidateReport(claimId: string) {
  reportCache.delete(claimId);
}

/** `[E3]` chip that opens the stored source record. */
export function EvidenceChip({ claimId, evidenceId, evidence }: { claimId: string; evidenceId: string; evidence?: EvidenceRecord[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [record, setRecord] = useState<EvidenceRecord | null>(evidence?.find((e) => e.evidenceId === evidenceId) ?? null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open || record) return;
    invalidateReport(claimId);
    loadReport(claimId)
      .then((r) => setRecord(r.evidence.find((e) => e.evidenceId === evidenceId) ?? null))
      .catch((e) => setError((e as Error).message));
  }, [open, record, claimId, evidenceId]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded border border-navy/40 bg-navy/5 px-1.5 py-0.5 font-pixel text-[9px] text-navy hover:bg-navy/10">
        [{evidenceId}]
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label={evidenceId} className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4" onClick={() => setOpen(false)}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-lg bg-white p-5 shadow-xl" onClick={(ev) => ev.stopPropagation()}>
            <div className="mb-3 flex justify-end">
              <button onClick={() => setOpen(false)} aria-label={t('common.close')} className="rounded p-1 hover:bg-ink/5">
                <X className="h-4 w-4" />
              </button>
            </div>
            {record ? <EvidenceDetails e={record} /> : error ? <p className="text-wrong">{error}</p> : <p className="text-muted">{t('common.loading')}</p>}
          </div>
        </div>
      )}
    </>
  );
}

export const relationKey = (r: string) => `relation.${r}` as StringKey;
