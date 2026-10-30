'use strict';

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra || {};
  }
}

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && !Buffer.isBuffer(value) ? value : {};
}

function parseJson(text) {
  if (!text.trim()) return {};
  try { return asObject(JSON.parse(text)); } catch { throw new HttpError(400, 'Invalid request.'); }
}

// Always returns a plain object (empty when the request has no body).
async function readBody(req) {
  const b = req.body;
  if (typeof b === 'string') return parseJson(b);
  if (Buffer.isBuffer(b)) return parseJson(b.toString('utf8'));
  if (b !== undefined && b !== null) return asObject(b);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4 * 1024 * 1024) throw new HttpError(413, 'That upload is too large.');
    chunks.push(chunk);
  }
  return parseJson(Buffer.concat(chunks).toString('utf8'));
}

// Blocks cross-site form posts: browsers always send Origin on POST/PATCH/DELETE.
function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  let originHost;
  try { originHost = new URL(origin).host; } catch { throw new HttpError(403, 'Request blocked.'); }
  if (originHost !== host) throw new HttpError(403, 'Request blocked.');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function assertUuid(id) {
  if (!UUID_RE.test(String(id))) throw new HttpError(404, 'Not found.');
  return String(id).toLowerCase();
}

function addCookies(res, cookies) {
  const existing = res.getHeader('Set-Cookie');
  const list = existing ? (Array.isArray(existing) ? existing : [existing]) : [];
  res.setHeader('Set-Cookie', list.concat(cookies));
}

module.exports = { HttpError, send, readBody, checkOrigin, assertUuid, addCookies };
