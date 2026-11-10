import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useI18n } from '../i18n';
import { Button, ErrorBox, Notice, PageTitle, Skeleton, VerdictBadge } from '../components/ui';

interface Receipt {
  receiptId: string;
  claimId: string;
  verdict: 'CORRECT' | 'WRONG';
  topicStatement: string;
  hash: string;
  createdAtMs: number;
}

export default function Receipts() {
  const { t, formatDate } = useI18n();
  const [items, setItems] = useState<Receipt[] | null>(null);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ items: Receipt[] }>('GET', '/receipts').then((r) => setItems(r.items)).catch((e) => setError(e.message));
  }, []);
  return (
    <div className="max-w-3xl">
      <PageTitle>{t('receipts.title')}</PageTitle>
      <Notice>{t('receipts.note')}</Notice>
      {error && <ErrorBox message={error} />}
      {!items && !error && <Skeleton lines={3} />}
      {items?.length === 0 && <p className="mt-6 text-sm text-muted">{t('receipts.empty')}</p>}
      <ul className="mt-6 space-y-3">
        {items?.map((r) => (
          <li key={r.receiptId} className="rounded-lg border border-rule bg-white p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <VerdictBadge verdict={r.verdict} />
              <Link to={`/results/${r.claimId}`} className="font-medium hover:text-navy">
                {r.topicStatement}
              </Link>
            </div>
            <p className="mt-2 break-all font-mono text-xs">
              {t('receipts.hash')}: {r.hash}
            </p>
            <p className="mt-1 text-xs text-muted">{t('receipts.created', { date: formatDate(r.createdAtMs) })}</p>
            <div className="mt-2 flex items-center gap-3">
              <Button
                variant="secondary"
                onClick={async () => {
                  const v = await api<{ intact: boolean }>('GET', `/receipts/${r.receiptId}/verify`).catch(() => ({ intact: false }));
                  setChecks((c) => ({ ...c, [r.receiptId]: v.intact }));
                }}
              >
                {t('receipts.check')}
              </Button>
              {r.receiptId in checks && <span className={checks[r.receiptId] ? 'text-correct' : 'text-wrong'}>{checks[r.receiptId] ? t('receipts.intact') : t('receipts.changed')}</span>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
