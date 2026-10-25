#!/usr/bin/env node
/**
 * Veylqorix web server.
 *
 * Serves the static landing + dashboard from ./public and proxies /api/*
 * to the Veylqorix API (default http://localhost:4173). When the API is not
 * reachable the dashboard automatically shows clearly-labeled demo data.
 *
 *   VeylQORIX_WEB_PORT=3000 VeylQORIX_API=http://localhost:4173 node serve.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, '..', 'public');
const webPort = Number(process.env.VeylQORIX_WEB_PORT ?? 3000);
const apiBase = new URL(process.env.VeylQORIX_API ?? 'http://localhost:4173');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const p = url.pathname;

  // Proxy API requests to the Veylqorix API so the dashboard can use
  // same-origin /api in dev.
  if (p.startsWith('/api/')) {
    const target = new URL(p + url.search, apiBase);
    const body = [];
    for await (const chunk of req) body.push(chunk);
    const upstream = await fetch(target, {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
      body: req.method === 'POST' || req.method === 'PUT' ? Buffer.concat(body) : undefined,
    }).catch(() => null);
    if (!upstream) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'API upstream not reachable' }));
      return;
    }
    const text = await upstream.text();
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(text);
    return;
  }

  // Static file serving (path-safe: no traversal out of publicDir).
  let filePath = p === '/' ? '/index.html' : p;
  const resolved = path.resolve(publicDir, '.' + filePath);
  if (!resolved.startsWith(publicDir + path.sep) && resolved !== publicDir) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(resolved, (err, data) => {
    if (err) {
      // SPA fallback to index.html so client-side routing works on reload.
      fs.readFile(path.join(publicDir, 'index.html'), (e2, html) => {
        if (e2) {
          res.writeHead(404);
          return res.end('Not found');
        }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(html);
      });
      return;
    }
    const ext = path.extname(resolved);
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(webPort, () => {
  console.log(`veylqorix-web on http://localhost:${webPort}  (API: ${apiBase})`);
});
