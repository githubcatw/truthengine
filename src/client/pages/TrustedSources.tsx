import { useEffect, useState, type FormEvent } from 'react';
import { SUBJECTS, type Subject } from '../../shared/schemas';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../i18n';
import { Button, ErrorBox, Field, Input, Notice, PageTitle, Section, Select, Skeleton, Tag, Textarea } from '../components/ui';

interface Source {
  sourceId: string;
  name: string;
  url: string;
  subjects: Subject[];
  gradeLevels: number[];
  reliabilityDescription: string;
  verificationStatus: 'unverified' | 'verified_by_admin';
}
const empty = { name: '', url: '', subjects: [] as Subject[], gradeLevels: [] as number[], reliabilityDescription: '', verificationStatus: 'unverified' as const };

export default function TrustedSources() {
  const { t } = useI18n();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [items, setItems] = useState<Source[] | null>(null);
  const [form, setForm] = useState<Omit<Source, 'sourceId'>>(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api<{ items: Source[] }>('GET', '/sources').then((r) => setItems(r.items)).catch((e) => setError(e.message));
  useEffect(() => void load(), []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (editing) await api('PUT', `/sources/${editing}`, form);
      else await api('POST', '/sources', form);
      setForm(empty);
      setEditing(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-4xl">
      <PageTitle>{t('sources.title')}</PageTitle>
      <Notice>{t('sources.note')}</Notice>
      {error && (
        <div className="mt-4">
          <ErrorBox message={error} />
        </div>
      )}
      <Section title={t('sources.title')}>
        {!items && <Skeleton lines={3} />}
        {items?.length === 0 && <p className="text-sm text-muted">{t('sources.empty')}</p>}
        <ul className="divide-y divide-rule">
          {items?.map((s) => (
            <li key={s.sourceId} className="py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-medium text-navy">
                  {s.name}
                </a>
                <Tag tone={s.verificationStatus === 'verified_by_admin' ? 'correct' : 'neutral'}>{t(`sources.status.${s.verificationStatus}`)}</Tag>
              </div>
              <p className="mt-1 text-muted">{s.reliabilityDescription}</p>
              <p className="mt-1 flex flex-wrap gap-1">
                {s.subjects.map((x) => (
                  <Tag key={x}>{t(`subject.${x}`)}</Tag>
                ))}
                {s.gradeLevels.length > 0 && <Tag>{s.gradeLevels.join(', ')}</Tag>}
              </p>
              {isAdmin && (
                <div className="mt-2 flex gap-3 text-xs">
                  <button
                    className="text-navy"
                    onClick={() => {
                      setEditing(s.sourceId);
                      const { sourceId: _id, ...rest } = s;
                      setForm(rest);
                    }}
                  >
                    {t('common.edit')}
                  </button>
                  <button
                    className="text-wrong"
                    onClick={async () => {
                      await api('DELETE', `/sources/${s.sourceId}`).catch((e) => setError(e.message));
                      await load();
                    }}
                  >
                    {t('common.delete')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Section>
      {isAdmin && (
        <Section title={editing ? t('common.edit') : t('common.add')}>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={save}>
            <Field label={t('sources.name')}>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </Field>
            <Field label={t('sources.url')}>
              <Input type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} required />
            </Field>
            <Field label={t('sources.subjects')}>
              <Select multiple size={6} value={form.subjects} onChange={(e) => setForm({ ...form, subjects: [...e.target.selectedOptions].map((o) => o.value as Subject) })}>
                {SUBJECTS.filter((s) => s !== 'other').map((s) => (
                  <option key={s} value={s}>
                    {t(`subject.${s}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('sources.grades')}>
              <Select multiple size={6} value={form.gradeLevels.map(String)} onChange={(e) => setForm({ ...form, gradeLevels: [...e.target.selectedOptions].map((o) => Number(o.value)) })}>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field label={t('sources.reliability')}>
                <Textarea rows={3} value={form.reliabilityDescription} onChange={(e) => setForm({ ...form, reliabilityDescription: e.target.value })} required minLength={5} />
              </Field>
            </div>
            <Field label={t('sources.status')}>
              <Select value={form.verificationStatus} onChange={(e) => setForm({ ...form, verificationStatus: e.target.value as Source['verificationStatus'] })}>
                <option value="unverified">{t('sources.status.unverified')}</option>
                <option value="verified_by_admin">{t('sources.status.verified_by_admin')}</option>
              </Select>
            </Field>
            <div className="flex items-end gap-2">
              <Button type="submit" busy={busy}>
                {t('common.save')}
              </Button>
              {editing && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setEditing(null);
                    setForm(empty);
                  }}
                >
                  {t('common.cancel')}
                </Button>
              )}
            </div>
          </form>
        </Section>
      )}
    </div>
  );
}
