import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../public/index.html', import.meta.url);
const html = readFileSync(file, 'utf8');
const marker = /<meta http-equiv="Content-Security-Policy" content="[^"]*">/;
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
const hashes = scripts.map(([, source]) => "'sha256-" + createHash('sha256').update(source.replace(/\r\n?/g, '\n')).digest('base64') + "'");
const scriptsAndOcr = [
  ...hashes,
  "'self'",
  "'wasm-unsafe-eval'",
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
  'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/',
];
const csp = [
  'script-src ' + scriptsAndOcr.join(' '),
  "script-src-attr 'none'",
  "worker-src blob:",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ');
const meta = '<meta http-equiv="Content-Security-Policy" content="' + csp + '">';
const updated = marker.test(html) ? html.replace(marker, meta) : html.replace('<head>', '<head>' + meta);
if (process.argv.includes('--check')) {
  if (html !== updated) throw new Error('Run node dev/update-csp.mjs after changing inline scripts.');
} else {
  writeFileSync(file, updated);
}
