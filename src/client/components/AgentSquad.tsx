import { useState } from 'react';
import { Play } from 'lucide-react';
import { LinkButton } from './ui';
import { PixelAgent } from '../pixel/PixelAgent';
import type { AgentKind, AgentState } from '../pixel/sprites';
import { useI18n } from '../i18n';
import type { StringKey } from '../i18n/en';

const AGENTS: AgentKind[] = ['defender', 'prosecutor', 'judge', 'researcher', 'claim_extractor', 'content_extractor', 'pedagogue', 'quality_auditor'];
const STATES: AgentState[] = ['idle', 'talking', 'researching', 'winner', 'hit'];

/** "Pixel Agent Squad": the real sprites in each animation state. Illustration only, no sample data. */
export function AgentSquad() {
  const { t } = useI18n();
  const [state, setState] = useState<AgentState>('talking');
  const [active, setActive] = useState<AgentKind>('defender');
  return (
    <section className="rounded-2xl border border-rule bg-white p-5 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-5">
        <div>
          <p className="font-pixel text-[10px] tracking-widest text-navy">{t('squad.kicker')}</p>
          <h2 className="mt-2 text-xl font-semibold sm:text-2xl">{t('squad.title')}</h2>
        </div>
        <div role="tablist" aria-label={t('squad.states')} className="flex flex-wrap gap-1 rounded-lg border border-rule bg-paper p-1">
          {STATES.map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={state === s}
              onClick={() => setState(s)}
              className={`rounded-md px-3 py-1 font-mono text-xs ${state === s ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}
            >
              {t(`squad.state.${s}` as StringKey)}
            </button>
          ))}
        </div>
      </div>
      <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {AGENTS.map((a) => (
          <li key={a}>
            <button
              onClick={() => setActive(a)}
              aria-pressed={active === a}
              className={`flex h-full w-full flex-col items-center gap-1 rounded-xl border px-2 py-4 text-center transition-colors ${active === a ? 'border-ink bg-paper' : 'border-rule hover:border-ink/40'}`}
            >
              <PixelAgent agent={a} state={state} size={64} label={false} />
              <span className="font-pixel text-[9px] leading-snug">{t(`agent.${a}`)}</span>
              <span className="text-xs text-muted">{t(`role.${a}` as StringKey)}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-6 flex flex-wrap items-center gap-5 rounded-xl border border-rule bg-paper p-5">
        <PixelAgent agent={active} state={state} size={80} label={false} />
        <div className="min-w-0 flex-1">
          <p className="font-pixel text-[10px] tracking-widest text-correct">{t('squad.spotlight')}</p>
          <p className="mt-1 text-lg font-semibold">{t(`agent.${active}`)}</p>
          <p className="mt-1 text-sm text-muted">{t(`desc.${active}` as StringKey)}</p>
        </div>
        <LinkButton to="/how-it-works" variant="secondary">
          {t('squad.see')} <Play className="h-3 w-3" aria-hidden />
        </LinkButton>
      </div>
    </section>
  );
}
