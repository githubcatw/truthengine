import { useEffect, useState } from 'react';
import { RoleSchema, type Role } from '../../shared/schemas';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../i18n';
import { Button, ErrorBox, PageTitle, Section, Select, Skeleton, formatDuration } from '../components/ui';

interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: Role;
  accountStatus: 'active' | 'suspended';
}
interface Perf {
  stages: Array<{ stage: string; runs: number; failed: number; avgMs: number; maxMs: number; aiCalls: number }>;
  jobs: { count: number; avgMs: number | null; maxMs: number | null };
}

export default function Admin() {
  const { t, formatDate } = useI18n();
  const { profile } = useAuth();
  const [tab, setTab] = useState<'users' | 'performance' | 'activity' | 'settings'>('users');
  const [users, setUsers] = useState<User[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [perf, setPerf] = useState<Perf | null>(null);
  const [activity, setActivity] = useState<Array<{ id: string; eventType: string; userId: string; resourceId: string; timestamp: number | null }> | null>(null);
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadUsers = async (after: string | null) => {
    try {
      const r = await api<{ items: User[]; nextCursor: string | null }>('GET', `/admin/users${after ? `?cursor=${encodeURIComponent(after)}` : ''}`);
      setUsers((p) => [...(after ? (p ?? []) : []), ...r.items]);
      setCursor(r.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    setError(null);
    if (tab === 'users') void loadUsers(null);
    if (tab === 'performance') api<Perf>('GET', '/admin/performance').then(setPerf).catch((e) => setError(e.message));
    if (tab === 'activity') api<{ items: typeof activity }>('GET', '/admin/activity').then((r) => setActivity(r.items)).catch((e) => setError(e.message));
    if (tab === 'settings') api<Record<string, unknown>>('GET', '/admin/settings').then(setSettings).catch((e) => setError(e.message));
  }, [tab]);

  const update = async (uid: string, path: string, body: unknown) => {
    try {
      await api('PATCH', `/admin/users/${uid}/${path}`, body);
      await loadUsers(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div>
      <PageTitle>{t('admin.title')}</PageTitle>
      <div className="mb-6 flex flex-wrap gap-2">
        {(['users', 'performance', 'activity', 'settings'] as const).map((k) => (
          <Button key={k} variant={tab === k ? 'primary' : 'secondary'} onClick={() => setTab(k)}>
            {t(`admin.${k}`)}
          </Button>
        ))}
      </div>
      {error && <ErrorBox message={error} />}

      {tab === 'users' && (
        <Section title={t('admin.users')}>
          {!users && <Skeleton lines={4} />}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <tbody className="divide-y divide-rule">
                {users?.map((u) => (
                  <tr key={u.uid}>
                    <td className="py-2 pr-3">
                      {u.displayName}
                      <span className="block text-xs text-muted">{u.email}</span>
                    </td>
                    <td className="py-2 pr-3">
                      <Select aria-label={t('admin.role')} value={u.role} disabled={u.uid === profile?.uid} onChange={(e) => void update(u.uid, 'role', { role: RoleSchema.parse(e.target.value) })}>
                        {RoleSchema.options.map((r) => (
                          <option key={r} value={r}>
                            {t(`role.${r}`)}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="py-2">
                      {u.uid !== profile?.uid && (
                        <Button variant={u.accountStatus === 'active' ? 'danger' : 'secondary'} onClick={() => void update(u.uid, 'status', { accountStatus: u.accountStatus === 'active' ? 'suspended' : 'active' })}>
                          {u.accountStatus === 'active' ? t('admin.suspend') : t('admin.activate')}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {cursor && (
            <Button variant="secondary" className="mt-3" onClick={() => void loadUsers(cursor)}>
              {t('common.more')}
            </Button>
          )}
        </Section>
      )}

      {tab === 'performance' && (
        <Section title={t('admin.performance')}>
          <p className="mb-3 text-sm text-muted">{t('admin.perf.note')}</p>
          {!perf && <Skeleton lines={4} />}
          {perf && (
            <>
              {perf.jobs.avgMs !== null && (
                <p className="mb-3 text-sm">
                  {perf.jobs.count} · {t('admin.perf.avg')}: {formatDuration(perf.jobs.avgMs)} · {t('admin.perf.max')}: {formatDuration(perf.jobs.maxMs ?? 0)}
                </p>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-muted">
                    <tr>
                      <th className="py-1 pr-3">{t('admin.perf.stage')}</th>
                      <th className="pr-3">{t('admin.perf.runs')}</th>
                      <th className="pr-3">{t('admin.perf.avg')}</th>
                      <th className="pr-3">{t('admin.perf.max')}</th>
                      <th className="pr-3">{t('admin.perf.ai')}</th>
                      <th>{t('admin.perf.failed')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule">
                    {perf.stages.map((s) => (
                      <tr key={s.stage}>
                        <td className="py-1.5 pr-3 font-mono text-xs">{s.stage}</td>
                        <td className="pr-3">{s.runs}</td>
                        <td className="pr-3">{formatDuration(s.avgMs)}</td>
                        <td className="pr-3">{formatDuration(s.maxMs)}</td>
                        <td className="pr-3">{s.aiCalls}</td>
                        <td>{s.failed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Section>
      )}

      {tab === 'activity' && (
        <Section title={t('admin.activity')}>
          {!activity && <Skeleton lines={4} />}
          <ul className="divide-y divide-rule text-xs">
            {activity?.map((a) => (
              <li key={a.id} className="py-1.5">
                <span className="font-mono">{a.eventType}</span> · {a.resourceId} · <span className="text-muted">{a.userId}</span> {a.timestamp && `· ${formatDate(a.timestamp)}`}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {tab === 'settings' && (
        <Section title={t('admin.settings')}>
          {!settings && <Skeleton lines={4} />}
          {settings && <pre className="overflow-auto rounded border border-rule bg-white p-4 text-xs">{JSON.stringify(settings, null, 2)}</pre>}
        </Section>
      )}
    </div>
  );
}
