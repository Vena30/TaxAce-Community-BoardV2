# TaxAce Community Board

A private, monthly-themed team feed (think "Facebook, but only for our team").
Everyone logs in with their own account, sees the same posts, and can react, comment and share photos or drawings.

**How people sign in**
1. Email + password (each person has their own)
2. A 6-digit code from an authenticator app (Microsoft Authenticator, Google Authenticator, Authy…)

Only people an **admin has added** can get in. There is no public sign-up.

---

## One-time setup (about 20 minutes)

### 1. Put the code on GitHub
Create a new GitHub repo (e.g. `taxace-community-board`) and upload everything in this folder
(or push it from Codespaces). `.gitignore` already keeps secrets and `node_modules` out.

### 2. Create a NEW Neon database for this board
In Neon, create a **new project** (or at least a new database), e.g. `community-board`.
Don't reuse the database of another dashboard: this app creates tables named `members`, `posts`, `comments`…
Copy its connection string (Neon dashboard → **Connect**).

### 3. Create the Vercel project
Vercel → **Add New → Project** → import the repo. Framework Preset: **Other**. Leave build settings empty.
Before deploying, add two **Environment Variables**:

| Name | Value |
|---|---|
| `DATABASE_URL` | the Neon connection string |
| `APP_SECRET` | 32+ random characters. In a terminal: `openssl rand -base64 48` |

Then **Deploy**.
> Tip: in Vercel → Settings → Functions, set the region closest to your Neon database (faster page loads).

### 4. Create the tables and your admin account (in Codespaces)
Open the repo in Codespaces, then:

```bash
npm install
cp .env.example .env.local      # then open .env.local and paste your DATABASE_URL
npm run db:init
npm run seed-admin -- "Vena" your.email@yourcompany.com
```

`seed-admin` prints a **starter password**. Copy it.

### 5. First login
Open your Vercel link → log in with your email + the starter password. You'll be asked to:
1. choose your own password (10+ characters)
2. scan a QR code with your authenticator app and type the 6-digit code

Done. You're in, and you now see **👥 Manage team** in the account menu (top-right avatar) and the left panel.

### 6. Add your team
**Manage team → Add person** (name + email). The page shows a **one-time starter password**.
Send it to that person privately (not in a group chat). They log in, choose their own password, and set up their authenticator.

---

## Profile photos
Click the 📷 on your picture in the left panel (or **Change profile photo** in the avatar menu at the top right).
The photo is cropped to a square and shown on your posts and comments, for logged-in teammates only.

## Updating an existing install
Copy the new files over your repo, then run `npm run db:init` once (it only adds what's missing; nothing is deleted) and restart `npm run dev` or redeploy.

## Everyday admin tasks (all under Manage team)

| Situation | What to do |
|---|---|
| Someone forgot their password | **Reset password** → send them the new starter password |
| Someone lost/replaced their phone | **Reset authenticator** → at next login they scan a new QR code |
| Someone leaves the company | **Deactivate** → signed out immediately, can't log in. Their old posts stay |
| Need another admin | **Make admin** |
| A post shouldn't be there | Admins can delete any post (admins can't edit other people's words) |
| *You* (the only admin) lost your password or phone | `npm run seed-admin -- "Vena" your.email@yourcompany.com --reset` in Codespaces |

## What's protected
- Passwords are stored only as salted scrypt hashes. Nobody (including admins) can read them.
- Authenticator secrets are encrypted in the database. A code can't be used twice.
- 5 wrong passwords/codes locks the account for 15 minutes.
- Resetting a password or authenticator, or deactivating someone, signs them out on every device.
- Photos and drawings are only served to logged-in members.
- Logins last 7 days (`SESSION_DAYS` to change), then password + code are asked again.

## Good to know
- **Don't change `APP_SECRET` later** unless you mean to: everyone gets signed out and must set up their authenticator again.
- Posts from the old single-file version lived only in each person's own browser; they are not carried over.
- Photos are resized in the browser and stored in the database (fine for a team this size).
- Display names are set by the admin (people can't rename themselves, so nobody can pose as someone else).

## Try it in Codespaces first (no Vercel needed)
After steps 2 and 4 of the setup (Neon database + `.env.local` + `npm run db:init` + `npm run seed-admin`):
```bash
npm run dev
```
Then open the **PORTS** tab in Codespaces, find port **3000**, and click the globe icon (Open in Browser).
Log in with the starter password from `seed-admin`. Stop the server with `Ctrl+C`.
It uses the same code and the same Neon database that Vercel would, so anything you add now is still there after you deploy.

## What's in here
```
public/index.html       the board (themes, drawing, posts) + login screens
api/[...path].js        the server routes (one function)
lib/                    login, MFA, posts, admin code
db/schema.sql           database tables
scripts/                dev server, db:init and seed-admin helpers
vercel.json             security headers
```
