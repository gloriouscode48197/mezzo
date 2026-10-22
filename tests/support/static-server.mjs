/**
 * Minimal static file server for the Playwright test suite — no dependency
 * beyond Node's own `http`/`fs`. Serves the repo root (the same static
 * HTML/CSS/JS files index.html/try-it.html/etc. already are, with no build
 * step) on PORT (default 8973, matching playwright.config.js's webServer).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const PORT = Number(process.env.PORT) || 8973;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, `http://localhost:${PORT}`).pathname);
  // A directory (/playground/ or /playground) serves its index.html, as Vercel does.
  let filePath = path.join(ROOT, urlPath);
  try { if (fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html'); } catch { /* 404 below */ }

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end();
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`[static-server] serving ${ROOT} on http://localhost:${PORT}`);
});
