import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Client build. Only src/client and src/shared are reachable from index.html;
// the tests folder and src/server are never imported by the client.
// Only variables prefixed VITE_FIREBASE_ are exposed to the browser (public
// Firebase web config). The Gemini key is never VITE_-prefixed.
export default defineConfig({
  plugins: [react()],
  envPrefix: 'VITE_FIREBASE_',
  build: { outDir: 'dist', sourcemap: false },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
});
