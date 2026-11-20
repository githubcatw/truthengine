import { useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../i18n';
import type { Exercise } from '../lib/types';
import { Button } from './ui';

export function ExerciseCard({ exercise, readOnly, showTopic }: { exercise: Exercise; readOnly?: boolean; showTopic?: boolean }) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<number | null>(exercise.attempt?.selectedIndex ?? null);
  const [result, setResult] = useState<{ correct: boolean; correctIndex: number; explanation: string } | null>(
    exercise.attempt && exercise.correctIndex !== undefined ? { correct: exercise.attempt.correct, correctIndex: exercise.correctIndex, explanation: exercise.explanation } : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <fieldset className="rounded-lg border border-rule bg-white p-4 text-sm">
      {showTopic && <p className="mb-2 text-xs text-muted">{t('learn.fromClaim', { topic: exercise.topicStatement })}</p>}
      <legend className="sr-only">{exercise.question}</legend>
      <p className="font-medium">{exercise.question}</p>
      <div className="mt-3 space-y-1.5">
        {exercise.options.map((o, i) => {
          const tone = result ? (i === result.correctIndex ? 'border-correct bg-correct/5' : i === selected ? 'border-wrong bg-wrong/5' : 'border-rule') : selected === i ? 'border-navy' : 'border-rule';
          return (
            <label key={i} className={`flex cursor-pointer items-center gap-2 rounded border px-3 py-2 ${tone}`}>
              <input type="radio" name={exercise.exerciseId} className="accent-navy" checked={selected === i} disabled={Boolean(result) || readOnly} onChange={() => setSelected(i)} />
              {o}
            </label>
          );
        })}
      </div>
      {!result && !readOnly && (
        <Button
          className="mt-3"
          variant="secondary"
          busy={busy}
          disabled={selected === null}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              setResult(await api('POST', `/exercises/${exercise.exerciseId}/answer`, { selectedIndex: selected }));
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('learn.answer')}
        </Button>
      )}
      {error && <p className="mt-2 text-wrong">{error}</p>}
      {result && (
        <p className={`mt-3 ${result.correct ? 'text-correct' : 'text-wrong'}`}>
          {result.correct ? t('learn.correct') : t('learn.incorrect')} <span className="text-ink">{result.explanation}</span>
        </p>
      )}
    </fieldset>
  );
}
