import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The public address used in canonical links, the sitemap and social cards. Override with VITE_SITE_URL.
process.env.VITE_SITE_URL = (process.env.VITE_SITE_URL || 'https://aiui.softera.site').replace(/\/+$/, '');

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:4317', changeOrigin: true } },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1500 },
  // The build-time render of the public pages (src/prerender.tsx) bundles everything it needs.
  ssr: { noExternal: true },
});
