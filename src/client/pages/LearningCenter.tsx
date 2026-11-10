import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../i18n';
import type { StringKey } from '../i18n/en';
import type { Exercise } from '../lib/types';
import { Button, ErrorBox, PageTitle, Section, Skeleton } from '../components/ui';
import { ExerciseCard } from '../components/ExerciseCard';
import { PixelAgent } from '../pixel/PixelAgent';

const TOPICS = ['hallucinations', 'misinformation', 'fallacies', 'credibility', 'emotion', 'evidence', 'crosscheck', 'responsible'] as const;

export default function LearningCenter() {
  const { t } = useI18n();
  const [items, setItems] = useState<Exercise[] | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = async (after: number | null) => {
    try {
      const r = await api<{ items: Exercise[]; nextCursor: number | null }>('GET', `/exercises?limit=20${after ? `&cursor=${after}` : ''}`);
      setItems((p) => [...(after ? (p ?? []) : []), ...r.items]);
      setCursor(r.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => void load(null), []);
  return (
    <div className="max-w-3xl">
      <PageTitle>
        <span className="flex items-center gap-3">
          <PixelAgent agent="pedagogue" size={48} label={false} /> {t('learn.title')}
        </span>
      </PageTitle>
      <Section title={t('learn.topics')}>
        <div className="space-y-2">
          {TOPICS.map((k) => (
            <details key={k} className="rounded-lg border border-rule bg-white p-4">
              <summary className="cursor-pointer font-medium">{t(`learn.topic.${k}` as StringKey)}</summary>
              <p className="mt-2 text-sm leading-relaxed text-muted">{t(`learn.topic.${k}.text` as StringKey)}</p>
            </details>
          ))}
        </div>
      </Section>
      <Section title={t('learn.exercises')}>
        {error && <ErrorBox message={error} />}
        {!items && !error && <Skeleton lines={3} />}
        {items?.length === 0 && <p className="text-sm text-muted">{t('learn.exercises.empty')}</p>}
        <div className="space-y-3">
          {items?.map((x) => (
            <ExerciseCard key={x.exerciseId} exercise={x} showTopic />
          ))}
        </div>
        {cursor && (
          <Button variant="secondary" className="mt-4" onClick={() => void load(cursor)}>
            {t('common.more')}
          </Button>
        )}
      </Section>
    </div>
  );
}
