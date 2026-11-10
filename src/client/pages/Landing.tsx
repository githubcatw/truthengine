import { PublicHeader, Footer } from '../components/Layout';
import { LinkButton } from '../components/ui';
import { PixelAgent } from '../pixel/PixelAgent';
import { useI18n } from '../i18n';
import type { StringKey } from '../i18n/en';
import type { AgentKind } from '../pixel/sprites';

const SECTIONS: Array<{ title: StringKey; text: StringKey; agents: AgentKind[] }> = [
  { title: 'landing.problem.title', text: 'landing.problem.text', agents: ['quality_auditor'] },
  { title: 'landing.agents.title', text: 'landing.agents.text', agents: ['content_extractor', 'claim_extractor', 'researcher'] },
  { title: 'landing.debate.title', text: 'landing.debate.text', agents: ['defender', 'prosecutor'] },
  { title: 'landing.judge.title', text: 'landing.judge.text', agents: ['judge'] },
  { title: 'landing.evidence.title', text: 'landing.evidence.text', agents: ['researcher'] },
  { title: 'landing.armenia.title', text: 'landing.armenia.text', agents: ['pedagogue'] },
];

export default function Landing() {
  const { t } = useI18n();
  return (
    <div className="min-h-screen">
      <PublicHeader />
      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-20 md:grid-cols-[1.4fr_1fr]">
          <div>
            <p className="font-pixel text-[10px] tracking-widest text-navy">TRUTHENGINE CLASSROOM</p>
            <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">{t('landing.headline')}</h1>
            <p className="mt-6 max-w-xl text-lg text-muted">{t('landing.subtext')}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton to="/register">{t('landing.start')}</LinkButton>
              <LinkButton to="/how-it-works" variant="secondary">
                {t('landing.discover')}
              </LinkButton>
            </div>
          </div>
          <div className="flex items-end justify-center gap-2" aria-hidden>
            <PixelAgent agent="defender" state="idle" size={112} />
            <PixelAgent agent="judge" state="thinking" size={128} />
            <PixelAgent agent="prosecutor" state="idle" size={112} />
          </div>
        </section>
        <div className="mx-auto max-w-6xl px-4">
          {SECTIONS.map((s) => (
            <section key={s.title} className="grid gap-6 border-t border-rule py-12 md:grid-cols-[1fr_2fr]">
              <div className="flex gap-2" aria-hidden>
                {s.agents.map((a) => (
                  <PixelAgent key={a} agent={a} size={72} />
                ))}
              </div>
              <div>
                <h2 className="text-xl font-semibold">{t(s.title)}</h2>
                <p className="mt-3 max-w-2xl leading-relaxed text-muted">{t(s.text)}</p>
              </div>
            </section>
          ))}
        </div>
      </main>
      <Footer />
    </div>
  );
}
