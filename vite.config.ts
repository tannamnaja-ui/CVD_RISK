import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// /api → the direct-database server (server/index.ts), used when the app is not opened from HOSxP XE.
const dataServer = { '/api': 'http://127.0.0.1:4010' };

export default defineConfig({
  plugins: [react()],
  base: './',
  // not dist/: that folder holds the Windows installer (installer/build-setup.ps1)
  build: { outDir: 'build/web', emptyOutDir: true },
  // localhost only: in direct-database mode there is no login, so other PCs must not reach the app
  server: { port: 4009, strictPort: true, host: 'localhost', open: true, proxy: dataServer },
  preview: { port: 4009, strictPort: true, host: 'localhost', proxy: dataServer },
});
