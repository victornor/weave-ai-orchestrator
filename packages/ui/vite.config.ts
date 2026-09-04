import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const daemon = process.env.OC_DAEMON_URL ?? 'http://127.0.0.1:7433';

export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5273,
    proxy: {
      '/api': { target: daemon, changeOrigin: true, ws: true },
      '/mcp': { target: daemon, changeOrigin: true, ws: true },
      '/llms': { target: daemon, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      treeshake: {
        // @openconductor/shared is pure: constants, mappers and zod schemas
        // the web app never touches. Declaring it side-effect-free lets the
        // unused halves (config/report schemas, and zod with them) drop out.
        moduleSideEffects: (id) => !id.includes('shared/dist/'),
      },
    },
  },
});
