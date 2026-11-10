import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { AlertTriangle, Loader2 } from 'lucide-react';
import type { Verdict } from '../../shared/schemas';
import { useI18n } from '../i18n';

const variants = {
  primary: 'bg-navy text-white hover:bg-navy/90 disabled:bg-navy/40',
  secondary: 'border border-rule bg-white text-ink hover:border-ink/40 disabled:text-muted',
  ghost: 'text-ink hover:bg-ink/5 disabled:text-muted',
  danger: 'border border-wrong/40 text-wrong hover:bg-wrong/5',
} as const;

type Variant = keyof typeof variants;
const base = 'inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy';

export function Button({ variant = 'primary', busy, children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button className={`${base} ${variants[variant]} ${className}`} disabled={busy || rest.disabled} {...rest}>
      {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function LinkButton({ variant = 'primary', className = '', ...rest }: LinkProps & { variant?: Variant }) {
  return <Link className={`${base} ${variants[variant]} ${className}`} {...rest} />;
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <header className="mb-8">
      <h1 className="text-2xl font-semibold tracking-tight">{children}</h1>
      {sub && <p className="mt-2 text-muted">{sub}</p>}
    </header>
  );
}

export function Section({ title, children, id, aside }: { title: ReactNode; children: ReactNode; id?: string; aside?: ReactNode }) {
  return (
    <section id={id} className="border-t border-rule py-8">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-rule bg-white p-5 ${className}`}>{children}</div>;
}

export function Spinner({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <p className="flex items-center gap-2 text-muted" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {label ?? t('common.loading')}
    </p>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-3" aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-4 animate-pulse rounded bg-rule/70" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function ErrorBox({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div role="alert" className="flex gap-3 rounded-md border border-wrong/30 bg-wrong/5 p-4 text-sm text-wrong">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="space-y-2">
        <p>{message}</p>
        {action}
      </div>
    </div>
  );
}

export function Notice({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'warn' }) {
  return (
    <div className={`rounded-md border p-4 text-sm ${tone === 'warn' ? 'border-prosecutor/30 bg-prosecutor/5 text-ink' : 'border-rule bg-white text-muted'}`}>{children}</div>
  );
}

export function VerdictBadge({ verdict, size = 'md' }: { verdict: Verdict | null; size?: 'md' | 'lg' }) {
  const { t } = useI18n();
  if (!verdict) return <span className="rounded border border-rule px-2 py-0.5 text-xs text-muted">{t('res.noVerdict')}</span>;
  const tone = verdict === 'CORRECT' ? 'border-correct text-correct bg-correct/5' : 'border-wrong text-wrong bg-wrong/5';
  const sz = size === 'lg' ? 'px-4 py-1.5 text-base' : 'px-2 py-0.5 text-xs';
  return <span className={`inline-block rounded border-2 font-pixel tracking-wider ${tone} ${sz}`}>{t(`verdict.${verdict}`)}</span>;
}

export function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'defender' | 'prosecutor' | 'correct' | 'wrong' }) {
  const tones = {
    neutral: 'border-rule text-muted',
    defender: 'border-defender/40 text-defender',
    prosecutor: 'border-prosecutor/40 text-prosecutor',
    correct: 'border-correct/40 text-correct',
    wrong: 'border-wrong/40 text-wrong',
  };
  return <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs ${tones[tone]}`}>{children}</span>;
}

const fieldCls = 'w-full rounded-md border border-rule bg-white px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy';

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>((p, ref) => <input ref={ref} {...p} className={`${fieldCls} ${p.className ?? ''}`} />);
Input.displayName = 'Input';
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>((p, ref) => <textarea ref={ref} {...p} className={`${fieldCls} ${p.className ?? ''}`} />);
Textarea.displayName = 'Textarea';
export function Select(p: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={`${fieldCls} ${p.className ?? ''}`} />;
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return m ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}
