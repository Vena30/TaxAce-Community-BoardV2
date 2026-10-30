'use strict';
// Runs the whole board locally (no Vercel needed).  Usage:  npm run dev
// Serves the page at http://localhost:3000 and the API from the same code that Vercel would run.
require('./_env');
const http = require('http');
const fs = require('fs');
const path = require('path');

const missing = ['DATABASE_URL', 'APP_SECRET'].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing ${missing.join(' and ')}. Add ${missing.length > 1 ? 'them' : 'it'} to .env.local (see .env.example).`);
  process.exit(1);
}

const handler = require('../api/[...path].js');
const PAGE = path.join(__dirname, '..', 'public', 'index.html');
const PORT = Number(process.env.PORT) || 3000;

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      // Codespaces reaches us through a proxy, so make the same-origin safety check
      // compare against the public address the browser is actually using (dev only).
      if (process.env.CODESPACES && req.headers.origin) {
        try { req.headers['x-forwarded-host'] = new URL(req.headers.origin).host; } catch { /* ignore */ }
      }
      return await handler(req, res);
    }
    if (pathname === '/' || pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(PAGE));
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  } catch (e) {
    console.error(e);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Server error');
  }
});

server.listen(PORT, () => {
  console.log(`\nTaxAce Community Board is running on port ${PORT}.`);
  console.log('In Codespaces: open the PORTS tab, find port ' + PORT + ', and click the globe icon (Open in Browser).');
  console.log('On your own computer: http://localhost:' + PORT);
  console.log('Press Ctrl+C to stop.\n');
});
