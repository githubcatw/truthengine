import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useI18n } from '../i18n';
import { Button, ErrorBox, PageTitle, Skeleton, VerdictBadge } from '../components/ui';
import { JobStatusLabel } from '../components/JobStatusLabel';
import type { JobView } from '../lib/types';

type Item = Pick<JobView['job'], 'jobId' | 'status' | 'startedAtMs' | 'claimSummaries' | 'sourceType' | 'deep'>;

export default function History() {
  const { t, formatDate } = useI18n();
  const [items, setItems] = useState<Item[] | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (after: number | null) => {
    setBusy(true);
    try {
      const r = await api<{ items: Item[]; nextCursor: number | null }>('GET', `/verifications?limit=20${after ? `&cursor=${after}` : ''}`);
      setItems((prev) => [...(after ? (prev ?? []) : []), ...r.items]);
      setCursor(r.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => void load(null), [load]);
  return (
    <div>
      <PageTitle>{t('history.title')}</PageTitle>
      {error && <ErrorBox message={error} />}
      {!items && !error && <Skeleton lines={5} />}
      {items?.length === 0 && <p className="text-muted">{t('history.empty')}</p>}
      <ul className="divide-y divide-rule">
        {items?.map((j) => (
          <li key={j.jobId} className="py-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
              <span>
                {formatDate(j.startedAtMs)} · {j.sourceType === 'document' ? t('history.document') : t('history.text')} · {t('history.claims', { n: j.claimSummaries.length })}
              </span>
              <span className="flex items-center gap-3">
                <JobStatusLabel status={j.status} />
                <Link to={`/investigations/${j.jobId}`} className="text-navy">
                  {t('common.open')}
                </Link>
              </span>
            </div>
            <ul className="mt-2 space-y-1">
              {j.claimSummaries.map((c) => (
                <li key={c.claimId} className="flex items-start gap-2">
                  <VerdictBadge verdict={c.verdict} />
                  <Link to={`/results/${c.claimId}`} className="hover:text-navy">
                    {c.normalizedText}
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {cursor && (
        <Button variant="secondary" busy={busy} onClick={() => void load(cursor)} className="mt-4">
          {t('common.more')}
        </Button>
      )}
    </div>
  );
}
