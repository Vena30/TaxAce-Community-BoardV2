'use strict';
const QRCode = require('qrcode');
const { db } = require('../db');
const { HttpError, send } = require('../http');
const {
  hashPassword, verifyPassword, dummyVerify, passwordProblem,
  newTotpSecret, encryptSecret, decryptSecret, checkTotp, otpauthUri,
} = require('../security');
const {
  loadMember, requireSession, requirePending,
  issueSession, issuePending, clearCookies, publicMember, nextStep,
} = require('../session');

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const GENERIC_LOGIN_ERROR = 'Incorrect email or password.';

function assertNotLocked(m) {
  if (m.locked_until && new Date(m.locked_until) > new Date()) {
    const mins = Math.max(1, Math.ceil((new Date(m.locked_until) - new Date()) / 60000));
    throw new HttpError(429, `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
  }
}

// Counts a failed password OR failed code. At MAX_ATTEMPTS the account locks for LOCK_MINUTES.
// The counter only resets once someone fully signs in (password AND code).
async function registerFailure(id) {
  const sql = db();
  await sql`
    update members
       set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= ${MAX_ATTEMPTS}
                               then now() + make_interval(mins => ${LOCK_MINUTES}::int)
                               else locked_until end
     where id = ${id}`;
}

async function finishSignIn(req, res, m) {
  const sql = db();
  await sql`update members set failed_attempts = 0, locked_until = null, last_login_at = now() where id = ${m.id}`;
  issueSession(req, res, m);
}

/* POST /api/auth/login  { email, password } */
async function login({ req, res, body }) {
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || !password) throw new HttpError(400, 'Enter your email and password.');
  if (email.length > 254 || password.length > 200) throw new HttpError(401, GENERIC_LOGIN_ERROR);

  const sql = db();
  const [m] = await sql`select * from members where email = ${email}`;
  if (!m || !m.active) {
    await dummyVerify(password);
    throw new HttpError(401, GENERIC_LOGIN_ERROR);
  }
  assertNotLocked(m);
  if (!(await verifyPassword(password, m.password_hash))) {
    await registerFailure(m.id);
    throw new HttpError(401, GENERIC_LOGIN_ERROR);
  }
  issuePending(req, res, m);
  send(res, 200, { next: nextStep(m) });
}

/* GET /api/me */
async function me({ req, res }) {
  const m = await loadMember(req, 'session');
  if (m) return send(res, 200, { member: publicMember(m) });
  const p = await loadMember(req, 'pending');
  if (p) return send(res, 401, { pending: nextStep(p) });
  send(res, 401, {});
}

/* POST /api/auth/logout */
async function logout({ req, res }) {
  clearCookies(req, res);
  send(res, 200, { ok: true });
}

/* POST /api/auth/password  { newPassword, currentPassword? }
   - first login (pending sign-in, must_change_password): no current password needed
   - later changes (full session): current password required */
async function changePassword({ req, res, body }) {
  const sql = db();
  let m = await loadMember(req, 'session');
  let pendingMode = false;
  if (!m) {
    m = await loadMember(req, 'pending');
    pendingMode = true;
  }
  if (!m) throw new HttpError(401, 'Please log in.');

  if (pendingMode) {
    if (!m.must_change_password) throw new HttpError(403, 'Log in fully before changing your password.');
  } else {
    assertNotLocked(m);
    if (!(await verifyPassword(String(body.currentPassword || ''), m.password_hash))) {
      await registerFailure(m.id);
      throw new HttpError(400, 'Your current password is not correct.');
    }
  }

  const next = String(body.newPassword || '');
  const problem = passwordProblem(next, m);
  if (problem) throw new HttpError(400, problem);
  if (await verifyPassword(next, m.password_hash)) {
    throw new HttpError(400, 'Choose a password you have not used before.');
  }

  const hash = await hashPassword(next);
  // session_version + 1 signs out every other device that had this account open.
  const [updated] = await sql`
    update members
       set password_hash = ${hash}, must_change_password = false, session_version = session_version + 1
     where id = ${m.id}
     returning *`;

  if (pendingMode) {
    issuePending(req, res, updated);
    return send(res, 200, { next: nextStep(updated) });
  }
  issueSession(req, res, updated);
  send(res, 200, { next: 'done' });
}

/* POST /api/auth/mfa/setup  -> QR code + secret for the authenticator app */
async function mfaSetup({ req, res }) {
  const m = await requirePending(req);
  if (m.must_change_password) throw new HttpError(403, 'Set a new password first.');
  if (m.mfa_enabled) throw new HttpError(400, 'Two-step verification is already set up.');
  const sql = db();
  const secret = newTotpSecret();
  await sql`update members set mfa_secret_enc = ${encryptSecret(secret)}, mfa_last_step = 0 where id = ${m.id}`;
  const qr = await QRCode.toDataURL(otpauthUri(m.email, secret), { margin: 1, width: 224 });
  send(res, 200, { qr, secret: secret.match(/.{1,4}/g).join(' ') });
}

async function verifyCodeFor(m, code) {
  assertNotLocked(m);
  const step = checkTotp(decryptSecret(m.mfa_secret_enc), code, m.mfa_last_step);
  if (step === null) {
    await registerFailure(m.id);
    throw new HttpError(400, 'That code did not work. Wait for the next code in your app and try again.');
  }
  const sql = db();
  await sql`update members set mfa_last_step = ${step} where id = ${m.id}`;
}

/* POST /api/auth/mfa/enable  { code }  - confirms the authenticator app is set up, finishes sign-in */
async function mfaEnable({ req, res, body }) {
  const m = await requirePending(req);
  if (m.must_change_password) throw new HttpError(403, 'Set a new password first.');
  if (m.mfa_enabled || !m.mfa_secret_enc) throw new HttpError(400, 'Start the authenticator setup again.');
  await verifyCodeFor(m, body.code);
  const sql = db();
  const [updated] = await sql`update members set mfa_enabled = true where id = ${m.id} returning *`;
  await finishSignIn(req, res, updated);
  send(res, 200, { member: publicMember(updated) });
}

/* POST /api/auth/mfa/verify  { code }  - normal login code check */
async function mfaVerify({ req, res, body }) {
  const m = await requirePending(req);
  if (m.must_change_password) throw new HttpError(403, 'Set a new password first.');
  if (!m.mfa_enabled || !m.mfa_secret_enc) throw new HttpError(400, 'Two-step verification is not set up yet.');
  await verifyCodeFor(m, body.code);
  await finishSignIn(req, res, m);
  send(res, 200, { member: publicMember(m) });
}

module.exports = { login, me, logout, changePassword, mfaSetup, mfaEnable, mfaVerify };
