# 🥖 Bread Route

Delivery & payment tracker for a bakery: which businesses got bread, how much, who paid, who didn't.
Real logins (username + password), owner/staff roles, shared live data for the whole team. English + Macedonian.

## Deploy on Vercel (about 10 minutes)

1. Put this folder in a GitHub repo (or run `npx vercel` inside it).
2. On vercel.com: **Add New → Project →** import the repo. No framework / build settings needed.
3. In the project: **Storage → Create Database → Neon (Postgres)** and connect it to the project.
   This adds `DATABASE_URL` automatically. Tables are created on first use.
4. **Settings → Environment Variables:** add `AUTH_SECRET` = any long random string
   (e.g. run `openssl rand -hex 32`, or mash 40+ random characters).
5. **Deployments → Redeploy.** Open the URL.

The first screen asks you to create the **owner** account. Then open **Team → Add team member** for
each of the other workers. Share the site link; each person signs in with their own username/password.

## Run locally (no accounts needed)

    npm install
    npm run dev      # http://localhost:3000, uses an embedded database in ./.data

## Notes
- New team members are owners (full access) by default; you can pick "Staff" for a limited role. Staff can add deliveries/payments/businesses and delete only their own deliveries. The owner can do everything.
- Passwords are bcrypt-hashed; sessions are signed HttpOnly cookies; 5 wrong passwords locks that user for 10 minutes.
- Data refreshes every ~8 seconds on every phone.
- Netlify: this project uses Vercel's `/api` function format; moving to Netlify means converting 5 small files.

## v4 additions

- **Money tab**: Expenses, Recipes (cost per loaf per product), Trends (6/12 months), Cash (daily payments received + till count).
- **Install as app**: iPhone Safari → Share → Add to Home Screen; Android Chrome → ⋮ → Install app.
- **Backup by email** (default `markokjanzo98@gmail.com`, changeable in Team tab). Add these in Vercel → Settings → Environment Variables, then Redeploy:
  - `SMTP_USER` – the Gmail address that sends the mail
  - `SMTP_PASS` – a Gmail **App Password** (Google Account → Security → 2-Step Verification → App passwords)
  - `CRON_SECRET` – any long random string (lets the weekly Monday backup run)
  - optional: `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `BACKUP_TO`
- Note: sending real email could not be tested from the build sandbox (only the message building was).
