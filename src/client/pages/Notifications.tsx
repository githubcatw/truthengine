import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { JobStatus } from '../../shared/schemas';
import { api } from '../lib/api';
import { useI18n } from '../i18n';
import { ErrorBox, PageTitle, Skeleton } from '../components/ui';

interface Notification {
  notificationId: string;
  type: 'verification_finished';
  jobId: string;
  status: JobStatus;
  read: boolean;
  createdAtMs: number;
}

export default function Notifications() {
  const { t, formatDate } = useI18n();
  const [items, setItems] = useState<Notification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api<{ items: Notification[] }>('GET', '/notifications').then((r) => setItems(r.items)).catch((e) => setError(e.message));
  useEffect(() => void load(), []);
  return (
    <div className="max-w-2xl">
      <PageTitle>{t('notif.title')}</PageTitle>
      {error && <ErrorBox message={error} />}
      {!items && !error && <Skeleton lines={3} />}
      {items?.length === 0 && <p className="text-sm text-muted">{t('notif.empty')}</p>}
      <ul className="divide-y divide-rule">
        {items?.map((n) => (
          <li key={n.notificationId} className={`flex flex-wrap items-center justify-between gap-2 py-3 text-sm ${n.read ? 'text-muted' : ''}`}>
            <Link to={`/investigations/${n.jobId}`} className="hover:text-navy">
              {t('notif.verification_finished', { status: t(`status.${n.status}`) })}
            </Link>
            <span className="flex items-center gap-3 text-xs text-muted">
              {formatDate(n.createdAtMs)}
              {!n.read && (
                <button
                  className="text-navy"
                  onClick={async () => {
                    await api('POST', `/notifications/${n.notificationId}/read`).catch(() => undefined);
                    await load();
                  }}
                >
                  {t('notif.markRead')}
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
