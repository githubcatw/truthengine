import type { ReactNode } from 'react';
import { PublicHeader } from '../../components/Layout';
import { SetupWarnings } from '../../components/SetupStatus';
import { firebaseConfigured } from '../../lib/firebase';
import { useI18n } from '../../i18n';
import { ErrorBox } from '../../components/ui';

export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="min-h-screen">
      <PublicHeader />
      <main className="mx-auto max-w-sm px-4 py-16">
        <h1 className="mb-6 text-2xl font-semibold">{title}</h1>
        {!firebaseConfigured ? <ErrorBox message={t('auth.setupMissing')} /> : children}
        <div className="mt-6">
          <SetupWarnings only={['firebase']} />
        </div>
      </main>
    </div>
  );
}

export function authErrorMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'Incorrect email or password.';
  if (code.includes('email-already-in-use')) return 'An account with this email already exists.';
  if (code.includes('weak-password')) return 'The password is too weak.';
  if (code.includes('too-many-requests')) return 'Too many attempts. Please wait and try again.';
  if (code.includes('popup-closed')) return 'The sign-in window was closed.';
  if (code.includes('operation-not-allowed')) return 'This sign-in method is not enabled in Firebase Authentication.';
  return (e as Error)?.message ?? 'Sign-in failed.';
}
