'use strict';
// Creates the first admin (or recovers one).  Usage:
//   npm run seed-admin -- "Vena" vena@yourcompany.com
//   npm run seed-admin -- "Vena" vena@yourcompany.com --reset     (lost password or phone: new starter password, MFA cleared)
require('./_env');
const { db } = require('../lib/db');
const { hashPassword, randomStarterPassword } = require('../lib/security');

(async () => {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const reset = process.argv.includes('--reset');
  const [name, emailRaw] = args;
  const email = String(emailRaw || '').trim().toLowerCase();
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('Usage: npm run seed-admin -- "Full Name" email@company.com [--reset]');
    process.exit(1);
  }
  const sql = db();
  const starter = randomStarterPassword();
  const hash = await hashPassword(starter);
  const [existing] = await sql`select id from members where email = ${email}`;

  if (existing && !reset) {
    console.error(`${email} already exists. Add --reset to give them a new starter password and clear their authenticator.`);
    process.exit(1);
  }
  if (existing) {
    await sql`
      update members
         set name = ${name}, role = 'admin', active = true, password_hash = ${hash}, must_change_password = true,
             mfa_enabled = false, mfa_secret_enc = null, mfa_last_step = 0, failed_attempts = 0, locked_until = null,
             session_version = session_version + 1
       where id = ${existing.id}`;
  } else {
    await sql`
      insert into members (email, name, role, password_hash, must_change_password)
      values (${email}, ${name}, 'admin', ${hash}, true)`;
  }
  console.log(`\nAdmin ${existing ? 'reset' : 'created'}: ${name} <${email}>`);
  console.log(`Starter password (shown once): ${starter}`);
  console.log('Log in with it, choose a new password, then scan the QR code with your authenticator app.\n');
})().catch((e) => {
  console.error('Failed:', e.message);
  process.exit(1);
});
