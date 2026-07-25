# Library Sign-In Kiosk

A face-recognition sign-in kiosk and admin dashboard for the **University of Technology - Iraq** library. Students register once with their name, phone, college, grade, and gender plus a face photo; after that, a kiosk camera recognizes their face and logs a visit automatically. Staff can review everyone registered, today's activity, and each person's full visit history from a password-protected dashboard.

Built with Node 24, Express 5, `node:sqlite` (via `db.js`), and [face-api.js](https://github.com/justadudewhohacks/face-api.js) for face **detection** client-side. Face **matching** (deciding whether a detected face belongs to a registered person) happens server-side: the kiosk sends the detected face's descriptor to `POST /api/signin`, and the server compares it against the stored roster and logs the visit — the kiosk never downloads anyone's biometric data, and a sign-in can't be forged by guessing an ID. No build step, plain HTML/CSS/JS.

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` and set at least `ADMIN_PASSWORD` and `SESSION_SECRET` to real values (see [Known limitations](#known-limitations) for why this matters).

```bash
npm start
```

The server prints the URLs it's listening on when it boots.

## The three surfaces

| URL | Who uses it | Purpose |
|---|---|---|
| `/signup.html` | Student, at the kiosk | Register name/phone/college/grade/gender and capture a face photo |
| `/signin.html` | Student, at the kiosk | Continuously scans the camera and logs a visit on a face match |
| `/dashboard.html` | Library staff only | List everyone, see today's activity, view full visit history per person — requires logging in at `/login.html` |

## CRITICAL: HTTPS is required for real deployments

Browsers only allow camera access (`getUserMedia`) on a ["secure context"](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts). Plain `http://` works fine for local testing on `localhost` — but **any real kiosk tablet that talks to the server over a network (not `localhost`) must reach it over HTTPS, or the browser will silently block the camera** and the sign-up/sign-in pages won't work at all.

Pick one of these for a real deployment:

**(a) Reverse proxy with a real TLS certificate — recommended, easiest option.**
Run this Node app on `localhost` only and put a reverse proxy in front of it that terminates TLS. [Caddy](https://caddyserver.com/) is the simplest choice: point it at a real domain name and it automatically provisions and renews a free Let's Encrypt certificate with almost no configuration — a `Caddyfile` as short as:
```
library.yourdomain.edu {
    reverse_proxy localhost:3000
}
```
nginx works too, but you'll need to obtain and renew the certificate yourself (e.g. with `certbot`).
If you use this option, also set `TRUST_PROXY=true` in `.env` — otherwise the app can't tell the request came through your proxy over HTTPS, and it has no way to see the kiosk's real IP address for rate-limiting. **Only set this if a reverse proxy you control is actually in front** — enabling it with no proxy present lets anyone forge an `X-Forwarded-For` header and bypass rate limiting entirely.

**(b) Run Node's built-in HTTPS server directly.**
If you already have a certificate and key file (e.g. from your university IT department or `certbot`), set `SSL_CERT_PATH` and `SSL_KEY_PATH` in `.env` to their file paths. The server will start in HTTPS mode using them directly — no reverse proxy needed.

**(c) A tunnel — for quick testing or demos only.**
Tools like [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) or [ngrok](https://ngrok.com/) give you an HTTPS URL pointing at your local machine in seconds, with no certificate setup. Great for showing the kiosk to someone remotely or testing on a real tablet before you have permanent hosting — not a substitute for a real deployment.

## Data storage and backups

All personally identifiable information lives in two places, both `.gitignore`d by design:

- **`library.db`** — the SQLite database (names, phone numbers, college/grade/gender, face descriptors, visit history). Runs in WAL mode.
- **`photos/`** — the captured face photos

**Back these up regularly** — if either is lost, registered students need to sign up again. Run:

```bash
node scripts/backup.js
```

This uses SQLite's own `VACUUM INTO` (safe to run while the server is live, unlike a plain file copy of a WAL-mode database) to write a consistent snapshot of `library.db` plus a copy of `photos/` into `backups/<timestamp>/`. **Copy that folder to a second location** (another drive, a network share, cloud storage) — schedule this nightly with Windows Task Scheduler (or cron/systemd on Linux). A backup that only ever lives on the same machine as the original isn't a real backup.

## Staying up

`npm start` just runs `node server.js` in the foreground — if it crashes or the machine reboots, nothing brings it back automatically. For a real deployment, run it under a process manager instead. An [`ecosystem.config.js`](./ecosystem.config.js) is included for [pm2](https://pm2.keymetrics.io/):

```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # follow its printed instructions so it survives a reboot too
```

(A native Windows Service via [NSSM](https://nssm.cc/), or a Scheduled Task set to restart on failure, both work too if you'd rather not use pm2.)

## Changing the college/grade dropdown options

The list of colleges and grades is defined in **three places that must be kept in sync**:

1. `public/signup.js` — the `COLLEGES` and `GRADES` arrays, used to render the sign-up form's dropdowns
2. `server.js` — the same lists, used server-side to validate incoming sign-up requests
3. `public/dashboard.js` — `FILTER_COLLEGES` and `FILTER_GRADES`, used for the dashboard's filter dropdowns

**If you edit one and not the others, sign-ups will start failing validation** (the form will submit a college/grade the server no longer recognizes) **or the dashboard filters will silently go out of date.** Always update all three together.

## Known limitations

- **Admin sessions are stored in memory** (in `server.js`). They reset on every server restart, and won't work correctly across multiple server instances behind a load balancer. This is fine for a single-process deployment; scaling beyond one process would need a shared session store (e.g. Redis). In practice, this means an unplanned restart mid-day logs out whoever's currently viewing the dashboard — that's expected, they just need to log back in.
- **The default admin password is random.** If `ADMIN_PASSWORD` isn't set in `.env`, the server generates a random password at first boot and prints it to the console — it changes on every restart. Set `ADMIN_PASSWORD` in `.env` for a stable, known password.
- **No schema migration system.** `db.js` runs `CREATE TABLE IF NOT EXISTS` on every boot. Fine for the current fixed schema; if you ever add/change columns, you'll need to handle migrating existing rows yourself (or start from a fresh `library.db`).
- **A process-level `uncaughtException`/`unhandledRejection` handler logs and keeps the process alive** rather than crashing on an unexpected error, since every route here is synchronous and a hard crash would take down all three kiosk pages with no recovery. This is a safety net, not a substitute for a real process manager (see "Staying up" above) — it doesn't fix whatever caused the error, it just keeps serving requests instead of going dark.
