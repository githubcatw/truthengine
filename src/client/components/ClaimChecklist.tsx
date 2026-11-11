import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useI18n } from '../i18n';
import { Button, ErrorBox, Notice, Tag, Textarea, VerdictBadge } from './ui';
import type { JobView } from '../lib/types';
import type { StringKey } from '../i18n/en';

const MAX = 5;
export const pageNumber = (loc: string | null | undefined) => loc?.match(/^page (\d+)$/)?.[1] ?? null;

export function ClaimChecklist({ view, onConfirmed }: { view: JobView; onConfirmed: (v: JobView) => void }) {
  const { t, formatDate } = useI18n();
  const verifiable = view.claims.filter((c) => c.status !== 'not_verifiable');
  const notVerifiable = view.claims.filter((c) => c.status === 'not_verifiable');
  const [selected, setSelected] = useState<Record<string, boolean>>(() => Object.fromEntries(verifiable.map((c) => [c.claimId, c.selected])));
  const [texts, setTexts] = useState<Record<string, string>>(() => Object.fromEntries(verifiable.map((c) => [c.claimId, c.normalizedText])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = Object.values(selected).filter(Boolean).length;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const v = await api<JobView>('POST', `/verifications/${view.job.jobId}/confirm`, {
        claims: verifiable.map((c) => ({
          claimId: c.claimId,
          selected: Boolean(selected[c.claimId]),
          ...(texts[c.claimId]?.trim() && texts[c.claimId] !== c.normalizedText ? { normalizedText: texts[c.claimId]!.trim() } : {}),
        })),
      });
      onConfirmed(v);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold">{t('inv.confirm.title')}</h2>
      <p className="mt-1 text-sm text-muted">{t('inv.confirm.help', { max: MAX })}</p>
      {verifiable.length === 0 && (
        <div className="mt-4">
          <Notice>{t('inv.confirm.none')}</Notice>
        </div>
      )}
      <ul className="mt-6 space-y-4">
        {verifiable.map((c) => {
          const prev = view.previousResults.find((p) => p.claimId === c.claimId);
          return (
            <li key={c.claimId} className={`rounded-lg border bg-white p-4 ${selected[c.claimId] ? 'border-navy/50' : 'border-rule'}`}>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-navy"
                  checked={Boolean(selected[c.claimId])}
                  disabled={!selected[c.claimId] && count >= MAX}
                  onChange={(e) => setSelected((s) => ({ ...s, [c.claimId]: e.target.checked }))}
                />
                <span className="flex-1 space-y-2">
                  <Textarea
                    rows={2}
                    aria-label={t('res.topic')}
                    value={texts[c.claimId]}
                    maxLength={400}
                    onChange={(e) => setTexts((s) => ({ ...s, [c.claimId]: e.target.value }))}
                  />
                  <span className="block text-xs text-muted">
                    {t('inv.original')}: “{c.originalText}”
                    {pageNumber(c.context?.sourceLocation) && <> · {t('upload.page', { n: pageNumber(c.context?.sourceLocation)! })}</>}
                  </span>
                  {c.splitFrom && (
                    <span className="block text-xs text-muted">
                      {t('inv.splitFrom')}: “{c.splitFrom}”
                    </span>
                  )}
                  {c.ambiguityNote && (
                    <span className="block text-xs text-prosecutor">
                      {t('inv.ambiguity')}: {c.ambiguityNote}
                    </span>
                  )}
                  {prev && (
                    <span className="block rounded border border-rule bg-paper p-2 text-xs">
                      {t('inv.previous', { date: formatDate(prev.completedAtMs) })} <VerdictBadge verdict={prev.verdict} />{' '}
                      {prev.timeSensitivity === 'time_sensitive' && <span className="text-prosecutor">{t('inv.previous.sensitive')} </span>}
                      <Link to={`/results/${prev.resultClaimId}`} className="text-navy">
                        {t('inv.previous.view')}
                      </Link>
                      <span className="block text-muted">{t('inv.previous.fresh')}</span>
                    </span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {notVerifiable.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-medium">{t('inv.notVerifiable')}</h3>
          <ul className="mt-2 space-y-2">
            {notVerifiable.map((c) => (
              <li key={c.claimId} className="text-sm text-muted">
                “{c.originalText}” {c.notVerifiableReason && <Tag>{t(`inv.reason.${c.notVerifiableReason}` as StringKey)}</Tag>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <div className="mt-4">
          <ErrorBox message={error} />
        </div>
      )}
      {verifiable.length > 0 && (
        <Button className="mt-6" onClick={() => void confirm()} busy={busy} disabled={count === 0}>
          {t('inv.confirm.button')}
        </Button>
      )}
    </div>
  );
}
