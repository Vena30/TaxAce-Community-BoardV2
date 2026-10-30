'use strict';
const { db } = require('../db');
const { HttpError, send } = require('../http');
const { requireSession, publicMember } = require('../session');
const { saveMedia } = require('./posts');

const MAX_AVATAR_CHARS = 400000; // the browser sends a small 256x256 square (~25 KB)

/* POST /api/me/avatar  { imageUrl }  - replaces the member's profile photo */
async function setAvatar({ req, res, body }) {
  const me = await requireSession(req);
  const id = await saveMedia(body.imageUrl, { maxChars: MAX_AVATAR_CHARS });
  if (!id) throw new HttpError(400, 'Choose a photo first.');
  const sql = db();
  const [updated] = await sql`update members set avatar_media_id = ${id} where id = ${me.id} returning *`;
  if (me.avatar_media_id) await sql`delete from media where id = ${me.avatar_media_id}`;
  send(res, 200, { member: publicMember(updated) });
}

/* DELETE /api/me/avatar */
async function removeAvatar({ req, res }) {
  const me = await requireSession(req);
  const sql = db();
  const [updated] = await sql`update members set avatar_media_id = null where id = ${me.id} returning *`;
  if (me.avatar_media_id) await sql`delete from media where id = ${me.avatar_media_id}`;
  send(res, 200, { member: publicMember(updated) });
}

module.exports = { setAvatar, removeAvatar };
