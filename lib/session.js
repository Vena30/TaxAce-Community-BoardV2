'use strict';
const { db } = require('./db');
const { HttpError, addCookies } = require('./http');
const { signToken, verifyToken, parseCookies, buildCookie } = require('./security');

const SESSION_COOKIE = 'tb_session';
const PENDING_COOKIE = 'tb_pending';
const PENDING_MINUTES = 10;
const sessionDays = () => Math.max(1, Number(process.env.SESSION_DAYS) || 7);

// Loads the member behind a cookie of the given kind ('session' | 'pending'), or null.
// A token only works while the member is active AND its session_version still matches,
// so resetting a password / MFA or deactivating someone signs them out everywhere.
async function loadMember(req, kind) {
  const cookies = parseCookies(req.headers.cookie);
  const token = verifyToken(cookies[kind === 'session' ? SESSION_COOKIE : PENDING_COOKIE]);
  if (!token || token.t !== kind) return null;
  const sql = db();
  const rows = await sql`select * from members where id = ${token.u}`;
  const m = rows[0];
  if (!m || !m.active || m.session_version !== token.v) return null;
  return m;
}

async function requireSession(req) {
  const m = await loadMember(req, 'session');
  if (!m) throw new HttpError(401, 'Please log in.');
  return m;
}

async function requirePending(req) {
  const m = await loadMember(req, 'pending');
  if (!m) throw new HttpError(401, 'Your sign-in timed out. Please log in again.');
  return m;
}

async function requireAdmin(req) {
  const m = await requireSession(req);
  if (m.role !== 'admin') throw new HttpError(403, 'Admins only.');
  return m;
}

function issueSession(req, res, m) {
  const maxAge = sessionDays() * 86400;
  const token = signToken({ u: m.id, v: m.session_version, t: 'session', exp: Date.now() + maxAge * 1000 });
  addCookies(res, [buildCookie(req, SESSION_COOKIE, token, maxAge), buildCookie(req, PENDING_COOKIE, '', 0)]);
}

function issuePending(req, res, m) {
  const maxAge = PENDING_MINUTES * 60;
  const token = signToken({ u: m.id, v: m.session_version, t: 'pending', exp: Date.now() + maxAge * 1000 });
  addCookies(res, [buildCookie(req, PENDING_COOKIE, token, maxAge), buildCookie(req, SESSION_COOKIE, '', 0)]);
}

function clearCookies(req, res) {
  addCookies(res, [buildCookie(req, SESSION_COOKIE, '', 0), buildCookie(req, PENDING_COOKIE, '', 0)]);
}

function publicMember(m) {
  return {
    id: m.id, name: m.name, email: m.email, role: m.role,
    avatarUrl: m.avatar_media_id ? `/api/media/${m.avatar_media_id}` : null,
  };
}

// What the person must do next to finish signing in.
function nextStep(m) {
  if (m.must_change_password) return 'change_password';
  return m.mfa_enabled ? 'mfa_code' : 'mfa_setup';
}

module.exports = {
  loadMember, requireSession, requirePending, requireAdmin,
  issueSession, issuePending, clearCookies, publicMember, nextStep,
};
