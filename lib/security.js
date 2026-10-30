'use strict';
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

/* ------------------------------------------------------------------ */
/* Secrets                                                             */
/* ------------------------------------------------------------------ */
function appSecret() {
  const s = process.env.APP_SECRET;
  if (!s || s.length < 32) {
    throw new Error('APP_SECRET is missing or too short (use 32+ random characters).');
  }
  return s;
}
// Separate keys for separate jobs, all derived from the single APP_SECRET.
function deriveKey(label) {
  return crypto.createHmac('sha256', appSecret()).update(label).digest();
}

/* ------------------------------------------------------------------ */
/* Passwords (scrypt)                                                  */
/* ------------------------------------------------------------------ */
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const dk = await scrypt(password, salt, 64, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), dk.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  try {
    const [alg, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const dk = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
    });
    return crypto.timingSafeEqual(dk, expected);
  } catch {
    return false;
  }
}

let _dummyHash;
// Used so "unknown email" takes as long as "wrong password" (no account probing by timing).
async function dummyVerify(password) {
  if (!_dummyHash) _dummyHash = await hashPassword('not-a-real-password');
  await verifyPassword(password, _dummyHash);
}

// Easy to read aloud / type: no 0 O 1 l I. Looks like  Kp7m-Xw3n-Rt9e
const STARTER_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
function randomStarterPassword() {
  const pick = () => STARTER_ALPHABET[crypto.randomInt(STARTER_ALPHABET.length)];
  const group = () => Array.from({ length: 4 }, pick).join('');
  return `${group()}-${group()}-${group()}`;
}

// Returns an error message, or null when the password is acceptable.
function passwordProblem(password, member) {
  if (typeof password !== 'string' || password.length < 10) return 'Use at least 10 characters.';
  if (password.length > 200) return 'That password is too long (200 characters max).';
  if (/^(.)\1+$/.test(password)) return 'Choose a password that is not one repeated character.';
  const low = password.toLowerCase();
  const local = String(member.email || '').toLowerCase().split('@')[0];
  if (low === String(member.email || '').toLowerCase() || (local.length >= 4 && low.includes(local))) {
    return 'Your password should not contain your email name.';
  }
  const first = String(member.name || '').trim().toLowerCase().split(/\s+/)[0];
  if (first && first.length >= 4 && low.includes(first)) return 'Your password should not contain your name.';
  if (['password123', '1234567890', 'qwertyuiop', 'taxace2026', 'taxace123'].some((w) => low.includes(w))) {
    return 'That password is too easy to guess.';
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Signed tokens (session + pending-login cookies)                     */
/* ------------------------------------------------------------------ */
function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', deriveKey('token')).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', deriveKey('token')).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Encrypting the authenticator secret at rest (AES-256-GCM)           */
/* ------------------------------------------------------------------ */
function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey('mfa'), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

function decryptSecret(stored) {
  const [iv, tag, enc] = String(stored).split('.').map((s) => Buffer.from(s, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey('mfa'), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

/* ------------------------------------------------------------------ */
/* TOTP (RFC 6238) - works with Microsoft/Google Authenticator, Authy   */
/* ------------------------------------------------------------------ */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, val = 0, out = '';
  for (const byte of buf) {
    val = (val << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(val >>> (bits - 5)) & 31];
      bits -= 5;
    }
    val &= (1 << bits) - 1;
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  let bits = 0, val = 0;
  const out = [];
  for (const ch of String(str).replace(/=+$/, '').toUpperCase()) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32');
    val = (val << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((val >>> (bits - 8)) & 255);
      bits -= 8;
      val &= (1 << bits) - 1;
    }
  }
  return Buffer.from(out);
}

function hotp(secret, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', secret).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1000000).padStart(6, '0');
}

function newTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function safeEqualStr(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Returns the matched 30-second step (so it can be stored and never reused), or null.
// Allows one step of clock drift either way. A step <= lastStep is rejected (replay).
function checkTotp(secretB32, code, lastStep, now = Date.now()) {
  const clean = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const secret = base32Decode(secretB32);
  const current = Math.floor(now / 30000);
  for (let w = -1; w <= 1; w++) {
    const step = current + w;
    if (step <= Number(lastStep || 0)) continue;
    if (safeEqualStr(hotp(secret, step), clean)) return step;
  }
  return null;
}

function otpauthUri(email, secretB32) {
  const issuer = 'TaxAce Community Board';
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}` +
    `?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/* ------------------------------------------------------------------ */
/* Cookies                                                             */
/* ------------------------------------------------------------------ */
function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore bad cookie */ }
    }
  });
  return out;
}

function buildCookie(req, name, value, maxAgeSeconds) {
  const host = String(req.headers.host || '');
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(host);
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}` +
    (local ? '' : '; Secure');
}

module.exports = {
  hashPassword, verifyPassword, dummyVerify, randomStarterPassword, passwordProblem,
  signToken, verifyToken, encryptSecret, decryptSecret,
  newTotpSecret, checkTotp, otpauthUri, base32Encode, base32Decode, hotp,
  parseCookies, buildCookie,
};
