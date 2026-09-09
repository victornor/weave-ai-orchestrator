import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Test against the shared source, so the suite needs no prior `pnpm build`. The production
  // `vite build` still consumes `shared/dist` (see the treeshake hint in vite.config.ts).
  resolve: {
    alias: {
      '@agent-conductor/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
      '@agent-conductor/render': fileURLToPath(new URL('../render/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    css: false,
  },
});
