// Builds the program icon — a blue circle with "CVD" — as installer/cvd.ico and public/favicon.ico.
// Each size is drawn by Microsoft Edge (headless) from the SVG below, then packed into one .ico (PNG entries).
//   node installer/make-icon.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
if (!EDGE) throw new Error('Microsoft Edge not found');

const SIZES = [256, 64, 48, 32, 24, 16];
const svg = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3aa0f0"/>
      <stop offset="1" stop-color="#1673d4"/>
    </linearGradient>
  </defs>
  <circle cx="128" cy="128" r="124" fill="url(#g)"/>
  <circle cx="128" cy="128" r="${size >= 48 ? 112 : 124}" fill="none" stroke="#ffffff" stroke-opacity="${size >= 48 ? 0.35 : 0}" stroke-width="6"/>
  <text x="128" y="128" text-anchor="middle" dominant-baseline="central" fill="#ffffff"
        font-family="Segoe UI, Arial, sans-serif" font-weight="800" font-size="${size >= 32 ? 86 : 96}" letter-spacing="-2">CVD</text>
</svg>`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cvd-icon-'));
const pngs = SIZES.map((size) => {
  const html = path.join(tmp, `icon${size}.html`);
  const png = path.join(tmp, `icon${size}.png`);
  fs.writeFileSync(html, `<!doctype html><html><body style="margin:0;background:transparent">${svg(size)}</body></html>`);
  execFileSync(EDGE, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000',
    `--window-size=${size},${size}`, `--screenshot=${png}`, `file:///${html.replace(/\\/g, '/')}`,
  ], { stdio: 'ignore' });
  return { size, data: fs.readFileSync(png) };
});

// ICO: 6-byte header, 16-byte directory entry per image, then the PNG data
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(pngs.length, 4);
let offset = 6 + 16 * pngs.length;
const entries = pngs.map(({ size, data }) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(size >= 256 ? 0 : size, 0);
  e.writeUInt8(size >= 256 ? 0 : size, 1);
  e.writeUInt16LE(1, 4); // planes
  e.writeUInt16LE(32, 6); // bits per pixel
  e.writeUInt32LE(data.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += data.length;
  return e;
});
const ico = Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
fs.writeFileSync(path.join(here, 'cvd.ico'), ico);
fs.writeFileSync(path.join(here, '..', 'public', 'favicon.ico'), ico);
fs.copyFileSync(path.join(tmp, 'icon256.png'), path.join(here, 'cvd-256.png'));
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`cvd.ico ${ico.length} bytes (${SIZES.join(', ')} px)`);
