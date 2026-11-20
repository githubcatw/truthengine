import { PublicHeader, Footer } from '../components/Layout';
import { useI18n } from '../i18n';
import { PixelAgent } from '../pixel/PixelAgent';
import type { AgentKind } from '../pixel/sprites';

const STEPS: Array<{ key: 'how.s1' | 'how.s2' | 'how.s3' | 'how.s4' | 'how.s5' | 'how.s6' | 'how.s7'; agent: AgentKind }> = [
  { key: 'how.s1', agent: 'content_extractor' },
  { key: 'how.s2', agent: 'quality_auditor' },
  { key: 'how.s3', agent: 'claim_extractor' },
  { key: 'how.s4', agent: 'researcher' },
  { key: 'how.s5', agent: 'defender' },
  { key: 'how.s6', agent: 'judge' },
  { key: 'how.s7', agent: 'pedagogue' },
];

export default function HowItWorks() {
  const { t } = useI18n();
  return (
    <div className="min-h-screen">
      <PublicHeader />
      <main className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-3xl font-semibold tracking-tight">{t('how.title')}</h1>
        <p className="mt-3 text-muted">{t('how.intro')}</p>
        <ol className="mt-10 space-y-6">
          {STEPS.map((s, i) => (
            <li key={s.key} className="flex items-center gap-4">
              <PixelAgent agent={s.agent} size={56} label={false} />
              <p>
                <span className="mr-2 font-pixel text-[10px] text-navy">{i + 1}</span>
                {t(s.key)}
              </p>
            </li>
          ))}
        </ol>
        <section className="mt-12 border-t border-rule pt-8">
          <h2 className="text-xl font-semibold">{t('how.layers.title')}</h2>
          <dl className="mt-4 space-y-3">
            {(['how.layerA', 'how.layerB', 'how.layerC'] as const).map((k, i) => (
              <div key={k} className="flex gap-3">
                <dt className="font-pixel text-[10px] text-navy">{'ABC'[i]}</dt>
                <dd>{t(k)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-sm text-muted">{t('how.layers.note')}</p>
        </section>
        <section className="mt-10 border-t border-rule pt-8">
          <h2 className="text-xl font-semibold">{t('how.verdict.title')}</h2>
          <p className="mt-3 leading-relaxed">{t('how.verdict.text')}</p>
        </section>
        <section className="mt-10 border-t border-rule pt-8">
          <h2 className="text-xl font-semibold">{t('how.limits.title')}</h2>
          <p className="mt-3 leading-relaxed text-muted">{t('how.limits.text')}</p>
        </section>
      </main>
      <Footer />
    </div>
  );
}
