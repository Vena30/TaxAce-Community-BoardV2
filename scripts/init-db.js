'use strict';
// Creates (or updates) the database tables.  Usage:  npm run db:init
require('./_env');
const fs = require('fs');
const path = require('path');
const { db } = require('../lib/db');

(async () => {
  const sql = db();
  const text = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  const statements = text
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);
  for (const stmt of statements) {
    await sql.query(stmt);
  }
  console.log(`Database ready (${statements.length} statements applied).`);
})().catch((e) => {
  console.error('Could not set up the database:', e.message);
  process.exit(1);
});
