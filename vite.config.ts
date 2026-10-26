import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// /api → the direct-database server (server/index.ts), used when the app is not opened from HOSxP XE.
// Proxied requests reach that server from loopback, so the real client address is passed along
// (overwriting anything the client sent) and the server refuses /api to other PCs.
const dataServer = {
  '/api': {
    target: 'http://127.0.0.1:4010',
    configure: (proxy: { on: (event: 'proxyReq', fn: (proxyReq: { setHeader: (k: string, v: string) => void }, req: { socket: { remoteAddress?: string } }) => void) => void }) => {
      proxy.on('proxyReq', (proxyReq, req) => proxyReq.setHeader('x-cv-client-ip', req.socket.remoteAddress ?? ''));
    },
  },
};

export default defineConfig({
  plugins: [react()],
  base: './',
  // not dist/: that folder holds the Windows installer (installer/build-setup.ps1)
  build: { outDir: 'build/web', emptyOutDir: true },
  // every interface, so HOSxP XE can open http://<pc-ip>:4009/?bms-session-id=... (BMS mode);
  // the data API behind /api still answers this PC only (server/index.ts localOnly)
  server: { port: 4009, strictPort: true, host: true, open: 'http://localhost:4009/', proxy: dataServer },
  preview: { port: 4009, strictPort: true, host: 'localhost', proxy: dataServer },
});
