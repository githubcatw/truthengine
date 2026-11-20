import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../i18n';
import { ErrorBox, LinkButton, PageTitle, Section, Skeleton, VerdictBadge } from '../components/ui';
import { SetupWarnings } from '../components/SetupStatus';
import { JobStatusLabel } from '../components/JobStatusLabel';
import type { JobView } from '../lib/types';

type HistoryItem = Pick<JobView['job'], 'jobId' | 'status' | 'startedAtMs' | 'claimSummaries' | 'sourceType'>;

export default function Dashboard() {
  const { t, formatDate } = useI18n();
  const { profile } = useAuth();
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ items: HistoryItem[] }>('GET', '/verifications?limit=50')
      .then((r) => setItems(r.items))
      .catch((e) => setError(e.message));
  }, []);
  const verdicts = (items ?? []).flatMap((i) => i.claimSummaries.map((c) => c.verdict)).filter(Boolean);
  return (
    <div>
      <PageTitle>{t('dash.welcome', { name: profile?.displayName ?? profile?.email ?? '' })}</PageTitle>
      <SetupWarnings />
      {error && <ErrorBox message={error} />}
      {!items && !error && <Skeleton lines={4} />}
      {items && (
        <>
          <dl className="grid grid-cols-3 gap-4">
            {[
              [t('dash.stats.total'), items.length],
              [t('dash.stats.correct'), verdicts.filter((v) => v === 'CORRECT').length],
              [t('dash.stats.wrong'), verdicts.filter((v) => v === 'WRONG').length],
            ].map(([label, n]) => (
              <div key={String(label)} className="border-l-2 border-rule pl-3">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="text-2xl font-semibold">{n}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-8">
            <LinkButton to="/new">{t('dash.start')}</LinkButton>
          </div>
          <Section title={t('dash.recent')} aside={items.length > 0 && <Link to="/history" className="text-sm text-navy">{t('dash.viewAll')}</Link>}>
            {items.length === 0 ? (
              <p className="text-muted">{t('dash.empty')}</p>
            ) : (
              <ul className="divide-y divide-rule">
                {items.slice(0, 5).map((j) => (
                  <li key={j.jobId} className="py-3">
                    <Link to={`/investigations/${j.jobId}`} className="flex flex-wrap items-center justify-between gap-2 hover:text-navy">
                      <span className="min-w-0 flex-1 truncate">{j.claimSummaries[0]?.normalizedText ?? t('inv.extracting')}</span>
                      <span className="flex items-center gap-2 text-xs text-muted">
                        {j.claimSummaries.map((c) => (
                          <VerdictBadge key={c.claimId} verdict={c.verdict} />
                        ))}
                        <JobStatusLabel status={j.status} />
                        {formatDate(j.startedAtMs)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
