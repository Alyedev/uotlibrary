# New Machine Setup

Everything you need to install/configure to clone this repo and run it error-free on a fresh machine.

## 1. Required software

| Tool | Version | Why |
|---|---|---|
| [Node.js](https://nodejs.org/) | **22.5 or later** (24 LTS recommended — this project was built on Node 24) | Runs the server. Uses the built-in `node:sqlite` module, so **no separate SQLite install, no Python, no build tools/`node-gyp` are needed** — just Node itself. |
| [Git](https://git-scm.com/downloads) | any recent version | To clone the repo |

That's it for the bare minimum — `npm install` pulls every JS dependency (Express, helmet, dotenv, etc.) from `package.json`. Nothing else needs to be compiled.

Check your Node version after installing:
```bash
node --version   # must print v22.5.0 or higher
```

## 2. Clone and install

```bash
git clone https://github.com/Alyedev/uotlibrary.git
cd uotlibrary
npm install
```

## 3. Configure environment variables

```bash
cp .env.example .env
```

Then edit `.env` and set at minimum:
- `ADMIN_PASSWORD` — a real password for the dashboard login (if left unset, the server generates a random one every restart)
- `SESSION_SECRET` — any long random string

Leave `SSL_CERT_PATH`, `SSL_KEY_PATH`, and `TRUST_PROXY` unset for local testing on `localhost` (see step 5 if you need camera access from another device on the network).

## 4. Run it

```bash
npm start
```

The console prints the URLs it's listening on (`signup.html`, `signin.html`, `dashboard.html`).

The database (`library.db`) and its tables are created automatically on first boot — nothing to set up manually.

## 5. Optional, only if needed

**Camera access from a kiosk tablet (not `localhost`)** — browsers block camera access over plain HTTP on any address other than `localhost`. You need HTTPS. Pick one:
- Easiest for local testing: install [mkcert](https://github.com/FiloSottile/mkcert) to generate a locally-trusted certificate, then set `SSL_CERT_PATH`/`SSL_KEY_PATH` in `.env` to point at it. (The `certs/` folder in this project — gitignored — is where the previous machine's mkcert output lived; you'll need to regenerate your own.)
- For a real deployment: see the full HTTPS section in [README.md](./README.md) (reverse proxy with Caddy/nginx, direct cert files, or a tunnel like ngrok/Cloudflare Tunnel for demos).

**Keep it running after a crash/reboot** — install [pm2](https://pm2.keymetrics.io/) globally and use the included `ecosystem.config.js`:
```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

**Windows-only silent autostart** — `start-server-silent.vbs` runs `npm start` hidden via `cmd`. It has the old machine's path (`D:\library`) hardcoded — edit that path before using it on a new machine, or just use pm2 instead.

**Regular backups** — run `node scripts/backup.js` (or `npm run backup`) periodically; see the "Data storage and backups" section in [README.md](./README.md) for what it does and why you need it.

## What you do NOT need

- No database server (SQLite is file-based and built into Node via `node:sqlite`)
- No Python, no C++ build tools, no `node-gyp` — nothing in `package.json` has native bindings
- No global npm packages except pm2, and only if you want auto-restart on crash/reboot
- No browser plugins — face detection (`face-api.js`) ships as a vendored file in `public/vendor/`, loaded directly by the page

## Sanity check

After `npm start`, open `http://localhost:3000/signup.html` in a browser on the same machine — the camera should prompt for permission and work (localhost is always a secure context, even over HTTP). If it doesn't, check the terminal for errors first.
