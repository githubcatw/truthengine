import type { JobStatus } from '../../shared/schemas';
import { useI18n } from '../i18n';

const TONE: Partial<Record<JobStatus, string>> = {
  completed: 'text-correct',
  failed: 'text-wrong',
  research_failed: 'text-wrong',
  paused: 'text-prosecutor',
  processing: 'text-navy',
};

export function JobStatusLabel({ status }: { status: JobStatus }) {
  const { t } = useI18n();
  return <span className={`text-xs ${TONE[status] ?? 'text-muted'}`}>{t(`status.${status}`)}</span>;
}
