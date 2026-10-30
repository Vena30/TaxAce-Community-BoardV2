-- TaxAce Community Board - database schema (PostgreSQL / Neon)
-- Safe to run more than once. Paste into the Neon SQL Editor, or run: npm run db:init
-- NOTE: keep one statement per semicolon; scripts/init-db.js splits on ";" at line ends.

create table if not exists members (
  id                   uuid primary key default gen_random_uuid(),
  email                text not null unique,
  name                 text not null,
  role                 text not null default 'member' check (role in ('member','admin')),
  password_hash        text not null,
  must_change_password boolean not null default true,
  mfa_secret_enc       text,
  mfa_enabled          boolean not null default false,
  mfa_last_step        bigint not null default 0,
  active               boolean not null default true,
  failed_attempts      integer not null default 0,
  locked_until         timestamptz,
  session_version      integer not null default 1,
  created_at           timestamptz not null default now(),
  last_login_at        timestamptz
);

create table if not exists media (
  id         uuid primary key default gen_random_uuid(),
  data_url   text not null,
  created_at timestamptz not null default now()
);

-- Profile photo (added later; safe to run on a database that already has members)
alter table members add column if not exists avatar_media_id uuid references media(id) on delete set null;

create table if not exists posts (
  id            uuid primary key default gen_random_uuid(),
  author_id     uuid not null references members(id),
  month_key     text not null,
  content       text not null default '',
  img_media_id  uuid references media(id) on delete set null,
  draw_media_id uuid references media(id) on delete set null,
  created_at    timestamptz not null default now(),
  edited_at     timestamptz
);

create index if not exists posts_month_idx on posts (month_key, created_at desc);

create table if not exists comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references posts(id) on delete cascade,
  author_id  uuid not null references members(id),
  content    text not null,
  created_at timestamptz not null default now()
);

create index if not exists comments_post_idx on comments (post_id, created_at);

create table if not exists reactions (
  post_id   uuid not null references posts(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  emoji     text not null,
  primary key (post_id, member_id, emoji)
);
