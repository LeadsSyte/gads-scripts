// Vitest configuration. Used only by component tests in test/components/.
// The plain Node test files in test/*.test.mjs continue to run via the
// existing run-all.mjs runner — no need to migrate them.

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/components/setup.js'],
    include: ['test/components/**/*.test.{js,jsx}'],
    // Stub the import.meta.env values our code reads at module scope so
    // imports don't blow up in the jsdom test environment.
    env: {
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: ''
    }
  }
});
