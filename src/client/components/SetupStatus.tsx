import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { SetupStatusSchema, type SetupStatus } from '../../shared/schemas';
import { useI18n } from '../i18n';

export function useSetupStatus() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/setup-status')
      .then(async (r) => setStatus(SetupStatusSchema.parse(await r.json())))
      .catch((e: Error) => setError(e.message));
  }, []);
  return { status, error };
}

/** Shows only services that are not configured (honest setup messages). */
export function SetupWarnings({ only }: { only?: Array<keyof SetupStatus> }) {
  const { status } = useSetupStatus();
  const { t } = useI18n();
  if (!status) return null;
  const labels = { gemini: t('setup.gemini'), firebase: t('setup.firebase'), storage: t('setup.storage') } as const;
  const missing = (Object.keys(status) as Array<keyof SetupStatus>).filter((k) => (!only || only.includes(k)) && !status[k].configured);
  if (!missing.length) return null;
  return (
    <ul className="space-y-2" aria-live="polite">
      {missing.map((k) => (
        <li key={k} className="flex gap-2 rounded-md border border-prosecutor/30 bg-prosecutor/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-prosecutor" aria-hidden />
          <span>
            <strong>{labels[k]}</strong>: {status[k].message}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function SetupPanel() {
  const { status } = useSetupStatus();
  const { t } = useI18n();
  if (!status) return null;
  const rows = [
    [t('setup.gemini'), status.gemini],
    [t('setup.firebase'), status.firebase],
    [t('setup.storage'), status.storage],
  ] as const;
  return (
    <ul className="space-y-2 text-sm">
      {rows.map(([label, s]) => (
        <li key={label} className="flex gap-2">
          {s.configured ? <CheckCircle2 className="h-4 w-4 text-correct" aria-hidden /> : <AlertTriangle className="h-4 w-4 text-wrong" aria-hidden />}
          <span>
            {label}{t('punct.label')}{s.configured ? t('setup.configured') : t('setup.missing')}
            {s.message && <span className="block text-muted">{s.message}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
