import { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { SetupStatusSchema, type SetupStatus } from '../shared/schemas';

type Load = { state: 'loading' } | { state: 'ok'; status: SetupStatus } | { state: 'error'; message: string };

// Foundation shell: shows only what really exists — the brand and the live
// server configuration status. Feature pages are added in later parts.
export function App() {
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  useEffect(() => {
    fetch('/api/setup-status')
      .then(async (r) => {
        if (!r.ok) throw new Error(`Server responded with ${r.status}`);
        setLoad({ state: 'ok', status: SetupStatusSchema.parse(await r.json()) });
      })
      .catch((e: Error) => setLoad({ state: 'error', message: `Could not reach the server: ${e.message}` }));
  }, []);

  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <p className="font-pixel text-[10px] tracking-widest text-navy">TRUTHENGINE CLASSROOM</p>
      <h1 className="mt-4 text-3xl font-semibold">Don&apos;t Just Trust AI. Verify It.</h1>

      <section className="mt-12 border-t border-rule pt-6" aria-live="polite">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted">Server setup</h2>
        {load.state === 'loading' && <p className="mt-4 text-muted">Checking configuration…</p>}
        {load.state === 'error' && <p className="mt-4 text-wrong">{load.message}</p>}
        {load.state === 'ok' && (
          <ul className="mt-4 space-y-3">
            {(
              [
                ['Gemini API (server Secrets)', load.status.gemini],
                ['Firebase (Auth and Firestore)', load.status.firebase],
                ['Firebase Storage (document upload)', load.status.storage],
              ] as const
            ).map(([label, s]) => (
              <li key={label} className="flex gap-3">
                {s.configured ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-correct" aria-hidden />
                ) : (
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-wrong" aria-hidden />
                )}
                <div>
                  <p className="font-medium">
                    {label}: {s.configured ? 'configured' : 'not configured'}
                  </p>
                  {s.message && <p className="text-sm text-muted">{s.message}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
