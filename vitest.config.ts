import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['packages/**/src/**/*.test.ts','packages/**/test/**/*.test.ts'], environment: 'node', testTimeout: 30000, setupFiles: ['./vitest.setup.ts'] } });
