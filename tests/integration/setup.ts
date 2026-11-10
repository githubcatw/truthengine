// Integration tests run against the Firebase emulators started by `firebase emulators:exec`.
process.env.FIREBASE_PROJECT_ID = 'demo-truthengine';
process.env.GCLOUD_PROJECT = 'demo-truthengine';
process.env.FIREBASE_STORAGE_BUCKET = 'demo-truthengine.appspot.com';
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Integration tests require the Firestore emulator (npm run test:integration).');
