// Firebase Admin initialisation. The Admin SDK bypasses Firestore Security Rules,
// so every protected route must verify tokens and ownership itself (PART 6.2).
// If configuration is missing we report exactly what is missing and never fall
// back to an in-memory database.
import { cert, getApps, initializeApp, applicationDefault, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { AppError } from './errors';

let app: App | null = null;
let initError: string | null = null;

function init(): void {
  if (app || initError) return;
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET?.trim() || undefined;
  try {
    if (getApps().length) {
      app = getApps()[0]!;
    } else if (json) {
      app = initializeApp({ credential: cert(JSON.parse(json)), storageBucket });
    } else if (projectId) {
      app = initializeApp({ credential: applicationDefault(), projectId, storageBucket });
    } else {
      initError = 'Firebase is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON (or FIREBASE_PROJECT_ID with default credentials) in the server Secrets.';
    }
  } catch {
    initError = 'Firebase credentials could not be loaded. Check FIREBASE_SERVICE_ACCOUNT_JSON.';
  }
}

export function firebaseStatus(): { configured: boolean; message: string | null } {
  init();
  return { configured: Boolean(app), message: initError };
}

export function storageStatus(): { configured: boolean; message: string | null } {
  init();
  if (!app) return { configured: false, message: 'Document upload is disabled until Firebase is configured. Pasted text still works.' };
  if (!process.env.FIREBASE_STORAGE_BUCKET?.trim()) {
    return { configured: false, message: 'Document upload is disabled: FIREBASE_STORAGE_BUCKET is not set. Pasted text still works.' };
  }
  return { configured: true, message: null };
}

function requireApp(): App {
  init();
  if (!app) throw new AppError('FIREBASE_NOT_CONFIGURED', initError ?? 'Firebase is not configured.');
  return app;
}

export const db = () => getFirestore(requireApp());
export const adminAuth = () => getAuth(requireApp());
