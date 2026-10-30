'use strict';
const { db } = require('../db');
const { HttpError, send, assertUuid } = require('../http');
const { requireSession } = require('../session');
const { REACTION_EMOJIS } = require('../constants');

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_POST_CHARS = 5000;
const MAX_COMMENT_CHARS = 1000;
const MAX_DATA_URL_CHARS = 1500000; // ~1.1 MB of image
const mediaUrl = (id) => (id ? `/api/media/${id}` : null);
const ts = (v) => (v ? new Date(v).getTime() : null);

function cleanText(value, max, label) {
  const text = String(value == null ? '' : value).replace(/\r\n/g, '\n').trim();
  if (text.length > max) throw new HttpError(400, `${label} is too long (${max} characters max).`);
  return text;
}

// Stores a photo/drawing (JPEG or PNG data URL from the browser) and returns its id.
async function saveMedia(dataUrl, opts = {}) {
  if (dataUrl == null || dataUrl === '') return null;
  const s = String(dataUrl);
  if (s.length > (opts.maxChars || MAX_DATA_URL_CHARS)) throw new HttpError(413, 'That image is too large. Try a smaller photo.');
  const m = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/.exec(s);
  if (!m) throw new HttpError(400, 'Only JPEG or PNG images are supported.');
  const head = Buffer.from(m[2].slice(0, 16), 'base64');
  const isJpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  if (!(m[1] === 'image/jpeg' ? isJpeg : isPng)) throw new HttpError(400, 'That file is not a valid image.');
  const sql = db();
  const [row] = await sql`insert into media (data_url) values (${s}) returning id`;
  return row.id;
}

/* GET /api/posts?month=YYYY-MM */
async function list({ req, res, url }) {
  const me = await requireSession(req);
  const month = url.searchParams.get('month') || '';
  if (!MONTH_RE.test(month)) throw new HttpError(400, 'Invalid month.');
  const sql = db();

  const [posts, comments, reacts] = await Promise.all([
    sql`select p.id, p.author_id, p.content, p.month_key, p.created_at, p.edited_at,
               p.img_media_id, p.draw_media_id, m.name as author_name, m.avatar_media_id as author_avatar
          from posts p join members m on m.id = p.author_id
         where p.month_key = ${month}
         order by p.created_at desc
         limit 200`,
    sql`select c.id, c.post_id, c.content, c.created_at, m.name as author_name, m.avatar_media_id as author_avatar
          from comments c
          join posts p on p.id = c.post_id
          join members m on m.id = c.author_id
         where p.month_key = ${month}
         order by c.created_at asc`,
    sql`select r.post_id, r.emoji, count(*)::int as n, bool_or(r.member_id = ${me.id}) as mine
          from reactions r join posts p on p.id = r.post_id
         where p.month_key = ${month}
         group by r.post_id, r.emoji`,
  ]);

  const byPost = new Map(posts.map((p) => [p.id, {
    id: p.id,
    author: p.author_name,
    avatarUrl: mediaUrl(p.author_avatar),
    content: p.content,
    monthKey: p.month_key,
    ts: ts(p.created_at),
    editedTs: ts(p.edited_at),
    imgUrl: mediaUrl(p.img_media_id),
    drawUrl: mediaUrl(p.draw_media_id),
    reactions: {},
    mine: [],
    comments: [],
    canEdit: p.author_id === me.id,
    canDelete: p.author_id === me.id || me.role === 'admin',
  }]));
  for (const c of comments) {
    const p = byPost.get(c.post_id);
    if (p) p.comments.push({ id: c.id, author: c.author_name, avatarUrl: mediaUrl(c.author_avatar), content: c.content, ts: ts(c.created_at) });
  }
  for (const r of reacts) {
    const p = byPost.get(r.post_id);
    if (!p) continue;
    p.reactions[r.emoji] = r.n;
    if (r.mine) p.mine.push(r.emoji);
  }
  send(res, 200, { posts: [...byPost.values()] });
}

/* POST /api/posts  { content, imgUrl, drawUrl, monthKey } */
async function create({ req, res, body }) {
  const me = await requireSession(req);
  const content = cleanText(body.content, MAX_POST_CHARS, 'Your post');
  const month = String(body.monthKey || '');
  if (!MONTH_RE.test(month)) throw new HttpError(400, 'Invalid month.');
  if (!content && !body.imgUrl && !body.drawUrl) throw new HttpError(400, 'Write, draw, or add a photo first.');

  const imgId = await saveMedia(body.imgUrl);
  const drawId = await saveMedia(body.drawUrl);
  const sql = db();
  const [row] = await sql`
    insert into posts (author_id, month_key, content, img_media_id, draw_media_id)
    values (${me.id}, ${month}, ${content}, ${imgId}, ${drawId})
    returning id`;
  send(res, 201, { id: row.id });
}

async function getPost(id) {
  const sql = db();
  const [p] = await sql`select id, author_id, img_media_id, draw_media_id from posts where id = ${id}`;
  if (!p) throw new HttpError(404, 'That post no longer exists.');
  return p;
}

/* PATCH /api/posts/:id  { content }  - author only */
async function edit({ req, res, body, params }) {
  const me = await requireSession(req);
  const id = assertUuid(params.id);
  const p = await getPost(id);
  if (p.author_id !== me.id) throw new HttpError(403, 'You can only edit your own posts.');
  const content = cleanText(body.content, MAX_POST_CHARS, 'Your post');
  if (!content) throw new HttpError(400, 'Post cannot be empty.');
  const sql = db();
  await sql`update posts set content = ${content}, edited_at = now() where id = ${id}`;
  send(res, 200, { ok: true });
}

/* DELETE /api/posts/:id  - author or admin */
async function remove({ req, res, params }) {
  const me = await requireSession(req);
  const id = assertUuid(params.id);
  const p = await getPost(id);
  if (p.author_id !== me.id && me.role !== 'admin') throw new HttpError(403, 'You can only delete your own posts.');
  const sql = db();
  await sql`delete from posts where id = ${id}`;
  for (const mid of [p.img_media_id, p.draw_media_id]) {
    if (mid) await sql`delete from media where id = ${mid}`;
  }
  send(res, 200, { ok: true });
}

/* POST /api/posts/:id/react  { emoji }  - toggles this member's reaction */
async function react({ req, res, body, params }) {
  const me = await requireSession(req);
  const id = assertUuid(params.id);
  await getPost(id);
  const emoji = String(body.emoji || '');
  if (!REACTION_EMOJIS.includes(emoji)) throw new HttpError(400, 'That reaction is not available.');
  const sql = db();
  const removed = await sql`
    delete from reactions where post_id = ${id} and member_id = ${me.id} and emoji = ${emoji} returning 1 as x`;
  if (!removed.length) {
    await sql`insert into reactions (post_id, member_id, emoji) values (${id}, ${me.id}, ${emoji})
              on conflict do nothing`;
  }
  const rows = await sql`
    select emoji, count(*)::int as n, bool_or(member_id = ${me.id}) as mine
      from reactions where post_id = ${id} group by emoji`;
  const reactions = {};
  const mine = [];
  for (const r of rows) {
    reactions[r.emoji] = r.n;
    if (r.mine) mine.push(r.emoji);
  }
  send(res, 200, { reactions, mine });
}

/* POST /api/posts/:id/comments  { content } */
async function comment({ req, res, body, params }) {
  const me = await requireSession(req);
  const id = assertUuid(params.id);
  await getPost(id);
  const content = cleanText(body.content, MAX_COMMENT_CHARS, 'Your comment');
  if (!content) throw new HttpError(400, 'Write a comment first.');
  const sql = db();
  const [row] = await sql`
    insert into comments (post_id, author_id, content) values (${id}, ${me.id}, ${content})
    returning id, created_at`;
  send(res, 201, { comment: { id: row.id, author: me.name, avatarUrl: mediaUrl(me.avatar_media_id), content, ts: ts(row.created_at) } });
}

/* GET /api/media/:id  - photos & drawings, only for logged-in members */
async function media({ req, res, params }) {
  await requireSession(req);
  const id = assertUuid(params.id);
  const sql = db();
  const [row] = await sql`select data_url from media where id = ${id}`;
  if (!row) throw new HttpError(404, 'Not found.');
  const m = /^data:(image\/(?:jpeg|png));base64,(.+)$/.exec(row.data_url);
  if (!m) throw new HttpError(404, 'Not found.');
  res.statusCode = 200;
  res.setHeader('Content-Type', m[1]);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.end(Buffer.from(m[2], 'base64'));
}

module.exports = { list, create, edit, remove, react, comment, media, saveMedia };
