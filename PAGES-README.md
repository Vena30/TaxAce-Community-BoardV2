# TaxAce Community Board: GitHub Pages preview (fake login)

This is a **preview**, not the real board. It looks and behaves like the real thing, but:

- The login is fake. Anyone who opens the page can read its source, so it protects nothing.
- Posts, photos, drawings and comments are saved **only in the visitor's own browser**. Nobody else sees them.

**Do not put real client or tax information on it.**

## Put it online

1. Copy the `docs/` folder into your GitHub repo (the same repo is fine; it does not touch the Vercel build, which uses `public/`).
2. Commit and push.
3. GitHub: **Settings > Pages > Build and deployment > Deploy from a branch**, pick `main` and the `/docs` folder, **Save**.
4. After a minute the site is at `https://YOUR-USERNAME.github.io/YOUR-REPO/`.

## Preview logins

Password for every account: `taxace-demo`

- `admin@taxace.demo` (sees **Manage team**)
- `member@taxace.demo`
- any other email also works and becomes a member named from the email

"Reset demo data" in the account menu wipes everything saved in that browser.

## Changing the demo password

Open `docs/index.html`, search for `DEMO_PASSWORD`, and change the value.

## When the real logins are ready

At the top of the script in `index.html` there is `const DEMO_MODE=true;`. Set it to `false` and the same file talks to the `/api` server (Vercel + Neon, password + authenticator) instead of the browser. Copy it into `public/index.html` for the Vercel deployment.
