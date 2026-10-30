'use strict';
const { db } = require('../db');
const { HttpError, send, assertUuid } = require('../http');
const { requireAdmin } = require('../session');
const { hashPassword, randomStarterPassword } = require('../security');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function adminView(m) {
  return {
    id: m.id,
    name: m.name,
    email: m.email,
    role: m.role,
    active: m.active,
    mfaEnabled: m.mfa_enabled,
    mustChangePassword: m.must_change_password,
    lastLoginAt: m.last_login_at ? new Date(m.last_login_at).getTime() : null,
    locked: !!(m.locked_until && new Date(m.locked_until) > new Date()),
  };
}

/* GET /api/admin/members */
async function listMembers({ req, res }) {
  await requireAdmin(req);
  const sql = db();
  const rows = await sql`select * from members order by active desc, lower(name)`;
  send(res, 200, { members: rows.map(adminView) });
}

/* POST /api/admin/members  { name, email, role? }  -> returns a one-time starter password */
async function addMember({ req, res, body }) {
  await requireAdmin(req);
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const role = body.role === 'admin' ? 'admin' : 'member';
  if (!name || name.length > 60) throw new HttpError(400, 'Enter the person\u2019s name (60 characters max).');
  if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpError(400, 'Enter a valid email address.');
  const starter = randomStarterPassword();
  const hash = await hashPassword(starter);
  const sql = db();
  try {
    const [m] = await sql`
      insert into members (email, name, role, password_hash, must_change_password)
      values (${email}, ${name}, ${role}, ${hash}, true)
      returning *`;
    send(res, 201, { member: adminView(m), starterPassword: starter });
  } catch (e) {
    if (e && (e.code === '23505' || /duplicate key|unique/i.test(String(e.message)))) {
      throw new HttpError(409, 'A member with that email already exists.');
    }
    throw e;
  }
}

async function target(params) {
  const id = assertUuid(params.id);
  const sql = db();
  const [m] = await sql`select * from members where id = ${id}`;
  if (!m) throw new HttpError(404, 'Member not found.');
  return m;
}

/* POST /api/admin/members/:id/reset-password -> new one-time starter password, signs them out everywhere */
async function resetPassword({ req, res, params }) {
  await requireAdmin(req);
  const m = await target(params);
  const starter = randomStarterPassword();
  const hash = await hashPassword(starter);
  const sql = db();
  const [u] = await sql`
    update members
       set password_hash = ${hash}, must_change_password = true, failed_attempts = 0, locked_until = null,
           session_version = session_version + 1
     where id = ${m.id} returning *`;
  send(res, 200, { member: adminView(u), starterPassword: starter });
}

/* POST /api/admin/members/:id/reset-mfa -> they set up their authenticator again at next login */
async function resetMfa({ req, res, params }) {
  await requireAdmin(req);
  const m = await target(params);
  const sql = db();
  const [u] = await sql`
    update members
       set mfa_enabled = false, mfa_secret_enc = null, mfa_last_step = 0, failed_attempts = 0, locked_until = null,
           session_version = session_version + 1
     where id = ${m.id} returning *`;
  send(res, 200, { member: adminView(u) });
}

/* POST /api/admin/members/:id/active  { active } */
async function setActive({ req, res, params, body }) {
  const admin = await requireAdmin(req);
  const m = await target(params);
  const active = !!body.active;
  if (m.id === admin.id && !active) throw new HttpError(400, 'You cannot deactivate your own account.');
  const sql = db();
  const [u] = await sql`
    update members set active = ${active}, session_version = session_version + 1
     where id = ${m.id} returning *`;
  send(res, 200, { member: adminView(u) });
}

/* POST /api/admin/members/:id/role  { role } */
async function setRole({ req, res, params, body }) {
  const admin = await requireAdmin(req);
  const m = await target(params);
  const role = body.role === 'admin' ? 'admin' : 'member';
  if (m.id === admin.id && role !== 'admin') throw new HttpError(400, 'You cannot remove your own admin access.');
  const sql = db();
  const [u] = await sql`update members set role = ${role} where id = ${m.id} returning *`;
  send(res, 200, { member: adminView(u) });
}

module.exports = { listMembers, addMember, resetPassword, resetMfa, setActive, setRole };
