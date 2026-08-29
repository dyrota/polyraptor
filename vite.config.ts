import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Pure client-side app: no backend, no API routes. Pyodide itself loads from
// the jsdelivr CDN (see src/pyodide/bridge.ts); only the two vendored wheels
// in public/wheels/ are served from this origin.
export default defineConfig({
  plugins: [react()],
});
