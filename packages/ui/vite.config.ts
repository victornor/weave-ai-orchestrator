import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const daemon = process.env.AC_DAEMON_URL ?? 'http://127.0.0.1:7433';

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
        // @weave-ai/shared and /render are pure: constants, mappers, zod
        // schemas and view-model functions the web app never touches. Declaring
        // them side-effect-free lets the unused halves (config/report schemas,
        // and zod with them) drop out.
        moduleSideEffects: (id) => !id.includes('shared/dist/') && !id.includes('render/dist/'),
      },
    },
  },
});
