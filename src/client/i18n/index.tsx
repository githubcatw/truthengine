import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Language } from '../../shared/schemas';
import { en, type StringKey } from './en';
import { setErrorTranslator } from '../lib/api';
import { hy } from './hy';
import { ru } from './ru';

const DICTS: Record<Language, Record<StringKey, string>> = { en, hy, ru };
const STORAGE_KEY = 'te.lang';

function initialLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'hy' || saved === 'en' || saved === 'ru') return saved;
  } catch {
    /* storage unavailable */
  }
  const nav = navigator.language?.slice(0, 2);
  return nav === 'ru' ? 'ru' : nav === 'en' ? 'en' : 'hy';
}

export type T = (key: StringKey, vars?: Record<string, string | number>) => string;

interface I18n {
  lang: Language;
  setLang: (l: Language) => void;
  t: T;
  formatDate: (ms: number) => string;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(initialLanguage);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const setLang = useCallback((l: Language) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* per-viewer convenience only */
    }
  }, []);
  useEffect(() => {
    // English keeps the server's specific message; other languages show the translated meaning of the code.
    setErrorTranslator((code, serverMessage) => {
      if (lang === 'en') return serverMessage;
      return DICTS[lang][`error.${code}` as StringKey] ?? serverMessage;
    });
  }, [lang]);
  const value = useMemo<I18n>(() => {
    const dict = DICTS[lang];
    const locale = lang === 'hy' ? 'hy-AM' : lang === 'ru' ? 'ru-RU' : 'en-GB';
    return {
      lang,
      setLang,
      t: (key, vars) => {
        let s = dict[key] ?? en[key] ?? key;
        if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
        return s;
      },
      formatDate: (ms) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms)),
    };
  }, [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n outside I18nProvider');
  return v;
}
