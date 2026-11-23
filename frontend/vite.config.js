import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const API = process.env.API_URL || 'http://localhost:5080';

/** Clean URLs in the dev server, the same as the .NET server in production: /order → order.html, /admin → admin/index.html. */
const cleanUrls = () => ({
  name: 'clean-urls',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const [path, qs = ''] = req.url.split('?');
      const q = qs ? `?${qs}` : '';
      if (path === '/order') req.url = `/order.html${q}`;
      else if (path === '/admin' || path === '/admin/') req.url = `/admin/index.html${q}`;
      next();
    });
  },
});

export default defineConfig({
  plugins: [react(), cleanUrls()],
  resolve: { alias: { '@shared': resolve(here, '../shared') } },
  server: {
    port: 5173,
    strictPort: true, // fail loudly instead of silently moving to another port
    fs: { allow: [resolve(here, '..')] },
    proxy: { '/api': { target: API, changeOrigin: false } },
  },
  build: {
    // The .NET server serves the built site from its wwwroot folder.
    outDir: resolve(here, '../backend/SuperWater.Api/wwwroot'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(here, 'index.html'),
        order: resolve(here, 'order.html'),
        admin: resolve(here, 'admin/index.html'),
        notfound: resolve(here, '404.html'),
      },
    },
  },
});
