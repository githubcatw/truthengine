import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FileUp } from 'lucide-react';
import { SUBJECTS, type Language, type Subject } from '../../shared/schemas';
import { api, newIdempotencyKey } from '../lib/api';
import { useI18n } from '../i18n';
import { Button, ErrorBox, Field, Notice, PageTitle, Select, Spinner, Tag, Textarea } from '../components/ui';
import { SetupWarnings, useSetupStatus } from '../components/SetupStatus';

const MAX_CHARS = 30_000;
const MAX_FILE_MB = 15;
const ACCEPT = '.pdf,.docx,.txt,.png,.jpg,.jpeg,.webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,image/png,image/jpeg,image/webp';

interface ExtractedFile {
  fileId: string;
  fileName: string;
  text: string;
  pages: Array<{ pageNumber: number; status: 'extracted' | 'ocr' | 'failed' | 'skipped'; warning: string | null }>;
  warnings: string[];
}

export default function NewVerification() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const assignmentId = params.get('assignment');
  const { status } = useSetupStatus();
  const [text, setText] = useState(''); // starts EMPTY (no sample claims)
  const [subject, setSubject] = useState<Subject | ''>('');
  const [language, setLanguage] = useState<Language | ''>('');
  const [file, setFile] = useState<ExtractedFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [researchMode, setResearchMode] = useState<'fast' | 'detailed'>('fast');
  const [assignmentTitle, setAssignmentTitle] = useState<string | null>(null);
  const key = useRef(newIdempotencyKey());
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!assignmentId) return;
    api<{ title: string }>('GET', `/assignments/${assignmentId}`)
      .then((a) => setAssignmentTitle(a.title))
      .catch(() => setAssignmentTitle(null));
  }, [assignmentId]);

  async function upload(f: File) {
    setError(null);
    if (f.size > MAX_FILE_MB * 1024 * 1024) {
      setError(`The file is larger than ${MAX_FILE_MB} MB.`);
      return;
    }
    setUploading(true);
    try {
      const buf = await f.arrayBuffer();
      const r = await api<ExtractedFile>('POST', '/files', undefined, {
        raw: buf,
        headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(f.name) },
      });
      setFile(r);
      setText(r.text);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ jobId: string }>('POST', '/verifications', {
        text,
        subject: subject || null,
        language: language || null,
        idempotencyKey: key.current,
        fileId: file?.fileId ?? null,
        assignmentId,
        researchMode,
      });
      navigate(`/investigations/${r.jobId}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const storageOk = status?.storage.configured;
  const pageLabel = { extracted: t('upload.page.ok'), ocr: t('upload.page.ocr'), failed: t('upload.page.failed'), skipped: t('upload.page.skipped') };

  return (
    <div className="max-w-3xl">
      <PageTitle>{t('new.title')}</PageTitle>
      {assignmentTitle && <Notice>{t('new.assignment', { title: assignmentTitle })}</Notice>}
      <div className="my-4">
        <SetupWarnings only={['gemini', 'firebase']} />
      </div>

      {file && (
        <div className="mb-6 space-y-3 rounded-lg border border-rule bg-white p-4">
          <h2 className="font-medium">
            {t('upload.title')}{t('punct.label')}{file.fileName}
          </h2>
          <p className="text-sm text-muted">{t('upload.stored')}</p>
          <div>
            <p className="text-sm font-medium">{t('upload.pages')}</p>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {file.pages.map((p) => (
                <li key={p.pageNumber}>
                  <Tag tone={p.status === 'failed' ? 'wrong' : p.status === 'skipped' ? 'prosecutor' : 'neutral'}>
                    {t('upload.page', { n: p.pageNumber })}{t('punct.label')}{pageLabel[p.status]}
                    {p.warning ? ` — ${p.warning}` : ''}
                  </Tag>
                </li>
              ))}
            </ul>
          </div>
          {file.warnings.length > 0 && (
            <div>
              <p className="text-sm font-medium">{t('upload.warnings')}</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-prosecutor">
                {file.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-sm text-muted">{t('upload.edit')}</p>
        </div>
      )}

      <Field label={file ? t('upload.title') : t('new.title')} hint={t('new.chars', { n: text.length, max: MAX_CHARS })}>
        <Textarea rows={12} value={text} maxLength={MAX_CHARS} placeholder={t('new.placeholder')} onChange={(e) => setText(e.target.value)} />
      </Field>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label={t('new.subject')}>
          <Select value={subject} onChange={(e) => setSubject(e.target.value as Subject | '')}>
            <option value="">{t('new.subject.auto')}</option>
            {SUBJECTS.map((s) => (
              <option key={s} value={s}>
                {t(`subject.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('new.language')}>
          <Select value={language} onChange={(e) => setLanguage(e.target.value as Language | '')}>
            <option value="">{t('new.language.auto')}</option>
            {(['hy', 'en', 'ru'] as const).map((l) => (
              <option key={l} value={l}>
                {t(`lang.${l}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {!file && (
        <div className="mt-6 border-t border-rule pt-6">
          <p className="mb-3 text-sm text-muted">{t('new.or')}</p>
          {storageOk ? (
            <>
              <input ref={fileInput} type="file" accept={ACCEPT} className="sr-only" id="file" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
              <label htmlFor="file" className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-ink/30 px-4 py-3 text-sm hover:border-navy">
                <FileUp className="h-4 w-4" aria-hidden /> {t('new.upload')}
              </label>
              <p className="mt-2 text-xs text-muted">{t('new.upload.types', { mb: MAX_FILE_MB })}</p>
              {uploading && (
                <div className="mt-3">
                  <Spinner label={t('upload.processing')} />
                </div>
              )}
            </>
          ) : (
            <Notice>
              {t('new.upload.disabled')} {status?.storage.message}
            </Notice>
          )}
        </div>
      )}

      <div className="mt-4 max-w-xl">
        <Field label={t('new.mode')} hint={t(researchMode === 'fast' ? 'new.mode.fast.hint' : 'new.mode.detailed.hint')}>
          <Select value={researchMode} onChange={(e) => setResearchMode(e.target.value as 'fast' | 'detailed')}>
            <option value="fast">{t('new.mode.fast')}</option>
            <option value="detailed">{t('new.mode.detailed')}</option>
          </Select>
        </Field>
      </div>

      {error && (
        <div className="mt-4">
          <ErrorBox message={error} />
        </div>
      )}
      <div className="mt-6 flex gap-3">
        <Button onClick={() => void submit()} busy={busy} disabled={text.trim().length < 10 || uploading}>
          {file ? t('upload.verify') : t('new.submit')}
        </Button>
        {file && (
          <Button
            variant="ghost"
            onClick={() => {
              setFile(null);
              setText('');
            }}
          >
            {t('common.cancel')}
          </Button>
        )}
      </div>
    </div>
  );
}
