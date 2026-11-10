// Client Firebase (Auth + realtime reads of the user's own job events).
// Only the public web config is used here; no secrets reach the browser.
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const firebaseConfigured = Boolean(config.apiKey && config.authDomain && config.projectId);
export const googleSignInEnabled = import.meta.env.VITE_FIREBASE_GOOGLE_SIGNIN === 'true';

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let firestorePromise: Promise<Firestore> | null = null;
const emu = import.meta.env.VITE_FIREBASE_EMULATOR_HOST as string | undefined;

if (firebaseConfigured) {
  app = initializeApp(config);
  auth = getAuth(app);
  if (emu) connectAuthEmulator(auth, `http://${emu}:9099`, { disableWarnings: true });
}

/** Firestore is loaded lazily: only the Live Investigation page subscribes to events. */
export function getClientFirestore(): Promise<Firestore> | null {
  if (!app) return null;
  firestorePromise ??= import('firebase/firestore').then(({ getFirestore, connectFirestoreEmulator }) => {
    const fs = getFirestore(app!);
    if (emu) connectFirestoreEmulator(fs, emu, 8080);
    return fs;
  });
  return firestorePromise;
}

export { auth };
