// Renders public/icon.svg into the PNG app icons (manifest + iPhone home screen) with the Playwright Chromium that
// e2e already installs — no image library needed. Run from apps/web: node scripts/make-icons.mjs
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const svg = readFileSync('public/icon.svg', 'utf8');
const out = [
  ['public/icon-192.png', 192, 0], ['public/icon-512.png', 512, 0],
  ['public/icon-maskable-512.png', 512, 0.1], // Android may crop to a circle: keep the logo in the safe zone
  ['public/apple-touch-icon.png', 180, 0],
];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, size, pad] of out) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * (1 - 2 * pad));
  await page.setContent(`<html><body style="margin:0;background:#e2900f;display:grid;place-items:center;width:${size}px;height:${size}px">
    <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`);
  await page.screenshot({ path: file, omitBackground: false });
  console.log('wrote', file);
}
await browser.close();
