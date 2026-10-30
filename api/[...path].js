'use strict';
// One serverless function that serves every /api/* route (keeps us well inside Vercel's
// free-plan function limit and makes the routes easy to read in one place).
const { HttpError, send, readBody, checkOrigin } = require('../lib/http');
const auth = require('../lib/handlers/auth');
const posts = require('../lib/handlers/posts');
const admin = require('../lib/handlers/admin');
const profile = require('../lib/handlers/profile');

const ROUTES = [
  ['GET',    'me',                          auth.me],
  ['POST',   'me/avatar',                   profile.setAvatar],
  ['DELETE', 'me/avatar',                   profile.removeAvatar],
  ['POST',   'auth/login',                  auth.login],
  ['POST',   'auth/logout',                 auth.logout],
  ['POST',   'auth/password',               auth.changePassword],
  ['POST',   'auth/mfa/setup',              auth.mfaSetup],
  ['POST',   'auth/mfa/enable',             auth.mfaEnable],
  ['POST',   'auth/mfa/verify',             auth.mfaVerify],

  ['GET',    'posts',                       posts.list],
  ['POST',   'posts',                       posts.create],
  ['PATCH',  'posts/:id',                   posts.edit],
  ['DELETE', 'posts/:id',                   posts.remove],
  ['POST',   'posts/:id/react',             posts.react],
  ['POST',   'posts/:id/comments',          posts.comment],
  ['GET',    'media/:id',                   posts.media],

  ['GET',    'admin/members',               admin.listMembers],
  ['POST',   'admin/members',               admin.addMember],
  ['POST',   'admin/members/:id/reset-password', admin.resetPassword],
  ['POST',   'admin/members/:id/reset-mfa', admin.resetMfa],
  ['POST',   'admin/members/:id/active',    admin.setActive],
  ['POST',   'admin/members/:id/role',      admin.setRole],
];

function matchRoute(method, parts) {
  for (const [m, pattern, fn] of ROUTES) {
    if (m !== method) continue;
    const segs = pattern.split('/');
    if (segs.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < segs.length; i++) {
      if (segs[i][0] === ':') {
        try { params[segs[i].slice(1)] = decodeURIComponent(parts[i]); } catch { ok = false; break; }
      } else if (segs[i] !== parts[i]) { ok = false; break; }
    }
    if (ok) return { fn, params };
  }
  return null;
}

module.exports = async function handler(req, res) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
    const method = req.method === 'HEAD' ? 'GET' : req.method;

    const route = matchRoute(method, parts);
    if (!route) throw new HttpError(404, 'Not found.');
    if (method !== 'GET') checkOrigin(req);
    const body = method === 'GET' ? {} : await readBody(req);
    await route.fn({ req, res, url, body, params: route.params });
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message, ...e.extra });
    console.error('API error:', e);
    send(res, 500, { error: 'Something went wrong on our side. Please try again.' });
  }
};
