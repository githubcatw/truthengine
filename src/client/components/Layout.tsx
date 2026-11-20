import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, Menu, X } from 'lucide-react';
import { LanguageSchema, type Language } from '../../shared/schemas';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { useI18n } from '../i18n';
import type { StringKey } from '../i18n/en';

interface NavItem {
  to: string;
  label: StringKey;
  roles?: Array<'student' | 'teacher' | 'admin'>;
}

// Only features that work appear here (PART 4).
const NAV: NavItem[] = [
  { to: '/dashboard', label: 'nav.dashboard' },
  { to: '/new', label: 'nav.new' },
  { to: '/history', label: 'nav.history' },
  { to: '/learning', label: 'nav.learning' },
  { to: '/progress', label: 'nav.student' },
  { to: '/classrooms', label: 'nav.classrooms' },
  { to: '/teacher', label: 'nav.teacher', roles: ['teacher', 'admin'] },
  { to: '/sources', label: 'nav.sources' },
  { to: '/receipts', label: 'nav.receipts' },
  { to: '/admin', label: 'nav.admin', roles: ['admin'] },
];

export function LanguageSwitcher() {
  const { lang, setLang, t } = useI18n();
  const { user, refreshProfile } = useAuth();
  return (
    <select
      aria-label={t('settings.language')}
      className="rounded border border-rule bg-transparent px-2 py-1 text-xs"
      value={lang}
      onChange={async (e) => {
        const l = LanguageSchema.parse(e.target.value) as Language;
        setLang(l);
        if (user) {
          await api('PATCH', '/me', { preferredLanguage: l }).catch(() => undefined);
          await refreshProfile();
        }
      }}
    >
      {(['hy', 'en', 'ru'] as const).map((l) => (
        <option key={l} value={l}>
          {t(`lang.${l}`)}
        </option>
      ))}
    </select>
  );
}

function UnreadBell() {
  const [count, setCount] = useState(0);
  const location = useLocation();
  const { t } = useI18n();
  useEffect(() => {
    api<{ unread: number }>('GET', '/notifications/unread-count')
      .then((r) => setCount(r.unread))
      .catch(() => setCount(0));
  }, [location.pathname]);
  return (
    <Link to="/notifications" className="relative rounded p-1.5 hover:bg-ink/5" aria-label={t('nav.notifications')}>
      <Bell className="h-4 w-4" aria-hidden />
      {count > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-wrong px-1 text-[10px] text-white">{count}</span>}
    </Link>
  );
}

export function PublicHeader() {
  const { t } = useI18n();
  const { user } = useAuth();
  return (
    <header className="border-b border-rule">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
        <Link to="/" className="font-pixel text-[11px] tracking-widest text-navy">
          TRUTHENGINE
        </Link>
        <nav className="flex flex-wrap items-center gap-4 text-sm">
          <Link to="/how-it-works" className="text-muted hover:text-ink">
            {t('nav.how')}
          </Link>
          {user ? (
            <Link to="/dashboard" className="font-medium">
              {t('nav.dashboard')}
            </Link>
          ) : (
            <>
              <Link to="/login" className="text-muted hover:text-ink">
                {t('nav.login')}
              </Link>
              <Link to="/register" className="font-medium text-navy">
                {t('nav.register')}
              </Link>
            </>
          )}
          <LanguageSwitcher />
        </nav>
      </div>
    </header>
  );
}

export function Footer() {
  const { t } = useI18n();
  return (
    <footer className="mt-16 border-t border-rule">
      <div className="mx-auto max-w-6xl px-4 py-6 text-xs text-muted">
        <p className="font-pixel text-[9px] tracking-widest text-navy">TRUTHENGINE CLASSROOM</p>
        <p className="mt-2">{t('footer.note')}</p>
      </div>
    </footer>
  );
}

export function AppLayout({ children }: { children?: ReactNode }) {
  const { t } = useI18n();
  const { profile, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  const items = NAV.filter((n) => !n.roles || (profile && n.roles.includes(profile.role)));

  const links = (
    <>
      {items.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          className={({ isActive }) => `block rounded px-3 py-1.5 text-sm ${isActive ? 'bg-navy/10 font-medium text-navy' : 'text-ink hover:bg-ink/5'}`}
        >
          {t(n.label)}
        </NavLink>
      ))}
    </>
  );

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-rule bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <button className="rounded p-1.5 hover:bg-ink/5 lg:hidden" onClick={() => setOpen((o) => !o)} aria-label={t('nav.menu')} aria-expanded={open}>
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <Link to="/dashboard" className="font-pixel text-[11px] tracking-widest text-navy">
              TRUTHENGINE
            </Link>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <UnreadBell />
            <LanguageSwitcher />
            <NavLink to="/profile" className="hidden max-w-[10rem] truncate rounded px-2 py-1 text-muted hover:text-ink sm:block">
              {profile?.displayName ?? profile?.email}
            </NavLink>
            <NavLink to="/settings" className="rounded px-2 py-1 text-muted hover:text-ink">
              {t('nav.settings')}
            </NavLink>
            <button
              className="rounded px-2 py-1 text-muted hover:text-ink"
              onClick={async () => {
                await logout();
                navigate('/');
              }}
            >
              {t('nav.logout')}
            </button>
          </div>
        </div>
        {open && <nav className="space-y-1 border-t border-rule px-4 py-3 lg:hidden">{links}</nav>}
      </header>
      <div className="mx-auto flex max-w-6xl gap-8 px-4 py-8">
        <nav className="hidden w-48 shrink-0 space-y-1 lg:block" aria-label={t('nav.menu')}>
          {links}
          <NavLink to="/how-it-works" className="block rounded px-3 py-1.5 text-sm text-muted hover:bg-ink/5">
            {t('nav.how')}
          </NavLink>
        </nav>
        <main className="min-w-0 flex-1">{children ?? <Outlet />}</main>
      </div>
      <Footer />
    </div>
  );
}
