require('dotenv').config();

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const SSL_CERT_PATH = process.env.SSL_CERT_PATH;
const SSL_KEY_PATH = process.env.SSL_KEY_PATH;
// Only trust X-Forwarded-* headers (client IP, protocol) when this process
// genuinely sits behind a reverse proxy that sets them itself. Trusting them
// unconditionally would let anyone spoof their own X-Forwarded-For and walk
// straight through every IP-based rate limiter below. Off by default.
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';
const PHOTOS_DIR = path.join(__dirname, 'photos');

if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });

// ---- Secrets: never hardcode a default. Generate and (for the admin password) ----
// ---- surface a usable one at boot if the operator hasn't provided one yet.    ----
function generateRandomToken(byteLength) {
  return crypto.randomBytes(byteLength).toString('base64url');
}

let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  ADMIN_PASSWORD = generateRandomToken(16).slice(0, 16);
  console.log('');
  console.log('='.repeat(70));
  console.log('  NO ADMIN_PASSWORD SET — a temporary password was generated.');
  console.log('');
  console.log(`      ADMIN_PASSWORD = ${ADMIN_PASSWORD}`);
  console.log('');
  console.log('  This password will be DIFFERENT every time the server restarts.');
  console.log('  To keep it stable, create a .env file in D:/library containing:');
  console.log('');
  console.log(`      ADMIN_PASSWORD=${ADMIN_PASSWORD}`);
  console.log('');
  console.log('='.repeat(70));
  console.log('');
}

let SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  // Generated silently: MemoryStore-backed sessions already reset on every
  // restart, so there's nothing gained by prompting the operator about this one.
  SESSION_SECRET = crypto.randomBytes(32).toString('hex');
}

const app = express();

// See TRUST_PROXY above — only enabled when actually deployed behind a
// reverse proxy (needed there for `cookie.secure: 'auto'` and rate-limiting
// to see the real client IP/protocol instead of the proxy's own).
if (TRUST_PROXY) app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
      },
    },
  })
);

// Single-process deployment: the default in-memory session store is fine here.
// Trade-off is intentional and simple — all sessions reset on every restart.
app.use(
  session({
    name: 'sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: 'auto',
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
    },
  })
);

app.use(express.json({ limit: '8mb' }));

// ---- Rate limiters ----
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'عدد كبير جداً من محاولات تسجيل الدخول، الرجاء المحاولة مرة أخرى لاحقاً.' },
});

const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'عدد كبير جداً من محاولات التسجيل من هذا الجهاز، الرجاء الانتظار والمحاولة مرة أخرى.' },
});

const signinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'عدد كبير جداً من محاولات تسجيل الحضور من هذا الجهاز، الرجاء الانتظار والمحاولة مرة أخرى.' },
});

// Defense-in-depth on the admin-only routes: requireAdmin is the real gate,
// but a stolen/compromised staff session (browser malware, a leaked cookie)
// shouldn't be able to script unlimited full-PII exports or mass deletions
// either. This one limiter instance is shared across every admin route below,
// and the dashboard's own 15s auto-refresh alone costs 2 requests per open
// tab per refresh — with several staff members possibly viewing it from the
// same office IP at once, the cap needs real headroom above routine usage;
// it's still low enough to stop a genuinely automated exfil/delete loop fast.
const adminActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'عدد كبير جداً من الطلبات، الرجاء المحاولة مرة أخرى لاحقاً.' },
});

// ---- Auth helpers ----
function sha256(input) {
  return crypto.createHash('sha256').update(String(input)).digest();
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  if (req.accepts(['html', 'json']) === 'html') {
    return res.redirect('/login.html');
  }
  return res.status(401).json({ error: 'غير مصرح' });
}

// ---- Auth routes (registered before express.static so they always win) ----
app.post('/api/login', loginLimiter, (req, res) => {
  const body = req.body || {};
  const submitted = typeof body.password === 'string' ? body.password : '';

  const submittedHash = sha256(submitted);
  const expectedHash = sha256(ADMIN_PASSWORD);
  const match = crypto.timingSafeEqual(submittedHash, expectedHash);

  if (!match) {
    return res.status(401).json({ error: 'كلمة المرور غير صحيحة' });
  }

  // Rotate the session ID on privilege escalation so a session ID an attacker
  // may have fixed/known before login cannot become an authenticated session.
  req.session.regenerate((err) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'خطأ داخلي في الخادم' });
    }
    req.session.isAdmin = true;
    res.json({ ok: true });
  });
});

app.post('/api/logout', (req, res) => {
  if (!req.session) return res.json({ ok: true });
  req.session.destroy((err) => {
    if (err) console.error(err);
    res.clearCookie('sid');
    res.json({ ok: true });
  });
});

app.get('/api/session', (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

// Explicit, auth-gated handler for the dashboard page — registered before
// express.static so it intercepts the request instead of the file being
// served openly as a static asset.
app.get('/dashboard.html', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Serves the mkcert local CA's PUBLIC certificate only (never its private
// key, which never leaves the machine that generated it) — installing this
// on a kiosk tablet is what makes the HTTPS certificate above show as
// trusted there instead of a "connection is not private" warning. This is
// a public certificate by nature (that's the point of a CA cert), so it's
// fine to serve unauthenticated; the explicit content-type is what makes
// Android/iOS offer to install it as a trusted certificate on download
// instead of just saving an unrecognized file.
app.get('/install-certificate/library-ca.pem', (req, res) => {
  const rootCaPath = path.join(__dirname, 'certs', 'rootCA.pem');
  if (!fs.existsSync(rootCaPath)) {
    return res.status(404).json({ error: 'غير موجود' });
  }
  res.type('application/x-x509-ca-cert');
  res.sendFile(rootCaPath);
});

// ---- Static assets ----
// Public/unauthenticated by design: the sign-up and sign-in kiosks are shared
// devices with no operator login, and login.html itself obviously can't require
// a session to load. All CSS/JS/vendor/models/img assets ride along with them.
app.use(express.static(path.join(__dirname, 'public')));
app.use('/photos', express.static(PHOTOS_DIR));

function nowIso() {
  return new Date().toISOString();
}

function todayPrefix() {
  return nowIso().slice(0, 10); // YYYY-MM-DD
}

function yearPrefix() {
  return nowIso().slice(0, 4); // YYYY
}

function personRowToJson(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    college: row.college,
    grade: row.grade,
    gender: row.gender,
    photoUrl: `/photos/${row.photo_path}`,
    createdAt: row.created_at,
  };
}

// ---- Server-side validation allowlists ----
// keep this in sync with public/signup.js COLLEGES
const COLLEGES = [
  'College of Mechanical Engineering',
  'College of Civil Engineering',
  'College of Electrical Engineering',
  'College of Electromechanical Engineering',
  'College of Artificial Intelligence Engineering',
  'College of Chemical Engineering',
  'College of Production Engineering',
  'College of Applied Sciences',
  'College of Architecture Engineering',
  'College of Computer Science',
  'College of Computer Engineering',
  'College of Materials Engineering',
  'College of Laser and Optoelectronics Engineering',
  'College of Oil and Gas Engineering',
  'College of Communication Engineering',
  'College of Biomedical Engineering',
  'Other',
];

// keep in sync with public/signup.js GRADES
const GRADES = ['1st Year', '2nd Year', '3rd Year', '4th Year', '5th Year', 'Graduate Student'];

const GENDERS = ['Male', 'Female'];

const PHONE_REGEX = /^[0-9+()\-.\s]{7,20}$/;
const MAX_PHOTO_BYTES = 6 * 1024 * 1024; // 6MB

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

function isValidImageSignature(buffer, declaredType) {
  if (declaredType === 'png') return buffer.subarray(0, 8).equals(PNG_SIGNATURE);
  if (declaredType === 'jpeg') return buffer.subarray(0, 3).equals(JPEG_SIGNATURE);
  return false;
}

// Many Arabic-locale tablet keyboards default to Arabic-Indic (U+0660-U+0669)
// or Extended Arabic-Indic/Persian (U+06F0-U+06F9) digits instead of ASCII
// 0-9. Normalize those to ASCII before validating/storing phone numbers so
// they're recognized and stored consistently regardless of keyboard used.
function normalizeArabicIndicDigits(str) {
  return str.replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.codePointAt(0);
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}

// Create a new person (sign-up).
// Left PUBLIC/unauthenticated on purpose: the sign-up kiosk is a shared device
// with no staff login, so this must be reachable without a session.
app.post('/api/people', signupLimiter, (req, res) => {
  const body = req.body || {};
  const { name, phone, college, grade, gender, descriptor, photo } = body;

  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80) {
    return res.status(400).json({ error: 'يجب أن يكون الاسم بين 2 و80 حرفاً' });
  }
  const normalizedPhone = typeof phone === 'string' ? normalizeArabicIndicDigits(phone).trim() : phone;
  if (typeof phone !== 'string' || !PHONE_REGEX.test(normalizedPhone)) {
    return res.status(400).json({ error: 'رقم الهاتف غير صالح' });
  }
  if (typeof college !== 'string' || !COLLEGES.includes(college.trim())) {
    return res.status(400).json({ error: 'الكلية غير صالحة' });
  }
  if (typeof grade !== 'string' || !GRADES.includes(grade.trim())) {
    return res.status(400).json({ error: 'المرحلة الدراسية غير صالحة' });
  }
  if (typeof gender !== 'string' || !GENDERS.includes(gender.trim())) {
    return res.status(400).json({ error: 'الجنس غير صالح' });
  }
  if (
    !Array.isArray(descriptor) ||
    descriptor.length !== 128 ||
    !descriptor.every((n) => typeof n === 'number' && Number.isFinite(n))
  ) {
    return res.status(400).json({ error: 'تعذّر قراءة بيانات الوجه' });
  }
  if (typeof photo !== 'string') {
    return res.status(400).json({ error: 'بيانات الصورة غير صالحة' });
  }

  const matches = /^data:image\/(png|jpeg);base64,(.+)$/.exec(photo);
  if (!matches) {
    return res.status(400).json({ error: 'بيانات الصورة غير صالحة' });
  }
  const ext = matches[1] === 'png' ? 'png' : 'jpg';
  const buffer = Buffer.from(matches[2], 'base64');
  if (buffer.length > MAX_PHOTO_BYTES) {
    return res.status(400).json({ error: 'حجم الصورة كبير جداً' });
  }
  // This route is public, so anyone can POST here directly (bypassing the
  // signup.js camera flow entirely) with any bytes labeled as a PNG/JPEG data
  // URL. Verify the actual file signature rather than trusting the caller's
  // declared mime type before writing it to disk under the public /photos path.
  if (!isValidImageSignature(buffer, matches[1])) {
    return res.status(400).json({ error: 'بيانات الصورة غير صالحة' });
  }

  const filename = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(PHOTOS_DIR, filename), buffer);

  const createdAt = nowIso();
  const stmt = db.prepare(`
    INSERT INTO people (name, phone, college, grade, gender, photo_path, descriptor, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    name.trim(),
    normalizedPhone,
    college.trim(),
    grade.trim(),
    gender.trim(),
    filename,
    JSON.stringify(descriptor),
    createdAt
  );

  const personId = Number(result.lastInsertRowid);
  db.prepare(`INSERT INTO visits (person_id, kind, visited_at) VALUES (?, 'signup', ?)`).run(
    personId,
    createdAt
  );

  const row = db.prepare('SELECT * FROM people WHERE id = ?').get(personId);
  res.status(201).json(personRowToJson(row));
});

// List all people (dashboard) — staff only.
app.get('/api/people', requireAdmin, adminActionLimiter, (req, res) => {
  // Single query (with the visits indexes added in db.js) instead of two
  // extra synchronous queries per row, to avoid stalling node:sqlite's
  // blocking API on the event loop as the person list grows.
  const rows = db
    .prepare(
      `SELECT p.*,
        (SELECT COUNT(*) FROM visits v WHERE v.person_id = p.id AND v.kind = 'signin' AND v.visited_at LIKE ?) AS signin_count,
        (SELECT visited_at FROM visits v WHERE v.person_id = p.id AND v.kind = 'signin' ORDER BY v.visited_at DESC LIMIT 1) AS last_visit
       FROM people p
       ORDER BY p.created_at DESC`
    )
    .all(`${yearPrefix()}%`);
  const people = rows.map((row) => ({
    ...personRowToJson(row),
    signinCount: row.signin_count,
    lastVisit: row.last_visit,
  }));
  res.json(people);
});

// One person + full visit history — staff only.
app.get('/api/people/:id', requireAdmin, adminActionLimiter, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(404).json({ error: 'غير موجود' });

  const row = db.prepare('SELECT * FROM people WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'غير موجود' });
  const visits = db
    .prepare('SELECT id, kind, visited_at FROM visits WHERE person_id = ? ORDER BY visited_at DESC')
    .all(row.id);
  res.json({ ...personRowToJson(row), visits });
});

// Bulk-delete accounts (and their visit history + stored photo files) —
// staff only. This is destructive/irreversible, so it's tightly gated and
// bounded, and wraps the DB changes in a transaction so a mid-way failure
// can't leave visits and people out of sync with each other.
app.delete('/api/people', requireAdmin, adminActionLimiter, (req, res) => {
  const body = req.body || {};
  const ids = Array.isArray(body.ids)
    ? [...new Set(body.ids.map(Number).filter(Number.isInteger))]
    : [];

  if (!ids.length) {
    return res.status(400).json({ error: 'لم يتم تحديد أي حسابات للحذف' });
  }
  if (ids.length > 500) {
    return res.status(400).json({ error: 'يمكن حذف 500 حساب كحد أقصى في المرة الواحدة' });
  }

  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT id, photo_path FROM people WHERE id IN (${placeholders})`).all(...ids);

  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM visits WHERE person_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM people WHERE id IN (${placeholders})`).run(...ids);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    console.error(err);
    return res.status(500).json({ error: 'خطأ داخلي في الخادم' });
  }

  // Best-effort photo cleanup — the DB rows are already gone regardless of
  // whether a photo file happens to be missing or fails to unlink.
  for (const row of rows) {
    fs.unlink(path.join(PHOTOS_DIR, row.photo_path), (err) => {
      if (err && err.code !== 'ENOENT') console.error('Failed to delete photo file', row.photo_path, err);
    });
  }

  res.json({ ok: true, deleted: rows.length });
});

// ---- Self-service "update my info" endpoints ----
// Both are intentionally PUBLIC/unauthenticated: the kiosk is a shared device
// with no staff login. Security relies on the person knowing BOTH their exact
// registered full name AND their registered phone number — a lightweight but
// practical barrier on a physical campus kiosk.

// Look up a person by (name, phone) — returns minimal public profile so the
// kiosk can show the person their current data before they edit it.
app.post('/api/people/self-lookup', signupLimiter, (req, res) => {
  const body  = req.body || {};
  const name  = typeof body.name  === 'string' ? body.name.trim()  : '';
  const phone = typeof body.phone === 'string'
    ? normalizeArabicIndicDigits(body.phone).trim()
    : '';

  if (name.length < 2)  return res.status(400).json({ error: 'يرجى إدخال الاسم الكامل' });
  if (!phone)           return res.status(400).json({ error: 'يرجى إدخال رقم الهاتف' });

  const row = db
    .prepare('SELECT * FROM people WHERE LOWER(name) = LOWER(?) AND phone = ? LIMIT 1')
    .get(name, phone);

  if (!row) {
    return res.status(404).json({
      error: 'لم يتم العثور على حسابك. تأكد من كتابة اسمك الكامل تماماً كما سجّلته، ورقم هاتفك كاملاً مع الصفر في البداية (مثال: 07701234567).',
    });
  }

  res.json(personRowToJson(row));
});

// Update (grade, phone, photo) for a person identified by (name, current phone).
app.patch('/api/people/self-update', signupLimiter, (req, res) => {
  const body     = req.body || {};
  const name     = typeof body.name  === 'string' ? body.name.trim()  : '';
  const phone    = typeof body.phone === 'string'
    ? normalizeArabicIndicDigits(body.phone).trim()
    : '';
  const newPhone = typeof body.newPhone === 'string'
    ? normalizeArabicIndicDigits(body.newPhone).trim()
    : phone;
  const newGrade = typeof body.newGrade === 'string' ? body.newGrade.trim() : '';

  // -- Validate inputs --
  if (name.length < 2)  return res.status(400).json({ error: 'يرجى إدخال الاسم الكامل' });
  if (!phone)           return res.status(400).json({ error: 'رقم الهاتف الأصلي مطلوب' });
  if (!PHONE_REGEX.test(newPhone)) return res.status(400).json({ error: 'رقم الهاتف الجديد غير صالح' });
  if (!GRADES.includes(newGrade)) return res.status(400).json({ error: 'المرحلة الدراسية غير صالحة' });

  // -- Look up the person --
  const row = db
    .prepare('SELECT * FROM people WHERE LOWER(name) = LOWER(?) AND phone = ? LIMIT 1')
    .get(name, phone);

  if (!row) {
    return res.status(404).json({
      error: 'لم يتم العثور على حسابك. تأكد من كتابة اسمك الكامل تماماً كما سجّلته، ورقم هاتفك كاملاً مع الصفر في البداية (مثال: 07701234567).',
    });
  }

  let newPhotoFilename = row.photo_path;
  let newDescriptor    = row.descriptor;

  // -- If a new photo was provided, validate and save it --
  if (body.photo) {
    if (
      !Array.isArray(body.descriptor) ||
      body.descriptor.length !== 128 ||
      !body.descriptor.every((n) => typeof n === 'number' && Number.isFinite(n))
    ) {
      return res.status(400).json({ error: 'تعذّر قراءة بيانات الوجه' });
    }

    const matches = /^data:image\/(png|jpeg);base64,(.+)$/.exec(body.photo);
    if (!matches) return res.status(400).json({ error: 'بيانات الصورة غير صالحة' });

    const ext    = matches[1] === 'png' ? 'png' : 'jpg';
    const buffer = Buffer.from(matches[2], 'base64');

    if (buffer.length > MAX_PHOTO_BYTES) return res.status(400).json({ error: 'حجم الصورة كبير جداً' });
    if (!isValidImageSignature(buffer, matches[1])) return res.status(400).json({ error: 'بيانات الصورة غير صالحة' });

    newPhotoFilename = `${crypto.randomUUID()}.${ext}`;
    fs.writeFileSync(path.join(PHOTOS_DIR, newPhotoFilename), buffer);

    // Best-effort delete of the old photo file
    if (row.photo_path && row.photo_path !== newPhotoFilename) {
      fs.unlink(path.join(PHOTOS_DIR, row.photo_path), (err) => {
        if (err && err.code !== 'ENOENT') console.error('Failed to delete old photo', row.photo_path, err);
      });
    }

    newDescriptor = JSON.stringify(body.descriptor);
  }

  // -- Persist --
  db.prepare(
    'UPDATE people SET grade = ?, phone = ?, photo_path = ?, descriptor = ? WHERE id = ?'
  ).run(newGrade, newPhone, newPhotoFilename, newDescriptor, row.id);

  const updated = db.prepare('SELECT * FROM people WHERE id = ?').get(row.id);
  res.json(personRowToJson(updated));
});

// 0.6 is the standard "same person" cutoff for this 128-d face descriptor
// model (face-api.js/dlib's own recommended threshold).
const MATCH_THRESHOLD = 0.6;
// Don't log a fresh visit more than once every 5 minutes for the same
// person — someone standing at the kiosk gets redetected every ~800ms.
const REGREET_COOLDOWN_MS = 5 * 60 * 1000;

function euclideanDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

// Log a recognized sign-in visit.
// Left PUBLIC/unauthenticated on purpose: the sign-in kiosk is a shared device
// with no staff login, so this must be reachable without a session.
//
// The face MATCH is decided here, server-side, against the submitted
// descriptor — the kiosk no longer asserts "this is person X" by ID (that
// used to let anyone with network access to this route fabricate attendance
// for any personId with zero camera involvement, and required shipping every
// registered person's full biometric descriptor to any anonymous caller via
// a separate /api/descriptors endpoint just so the kiosk could match
// locally). Now the kiosk only ever learns the identity of a face it already
// captured live, once the server confirms a close-enough match, and no
// biometric data ever leaves this endpoint. The response is still kept to
// the bare minimum the kiosk actually renders (name/photo/time) — never
// phone, college, grade, or gender.
app.post('/api/signin', signinLimiter, (req, res) => {
  const body = req.body || {};
  const descriptor = body.descriptor;
  if (
    !Array.isArray(descriptor) ||
    descriptor.length !== 128 ||
    !descriptor.every((n) => typeof n === 'number' && Number.isFinite(n))
  ) {
    return res.status(400).json({ error: 'تعذّر قراءة بيانات الوجه' });
  }

  const rows = db.prepare('SELECT id, name, photo_path, descriptor FROM people').all();
  let best = null;
  let bestDist = Infinity;
  for (const row of rows) {
    const dist = euclideanDistance(descriptor, JSON.parse(row.descriptor));
    if (dist < bestDist) {
      bestDist = dist;
      best = row;
    }
  }

  if (!best || bestDist > MATCH_THRESHOLD) {
    return res.status(404).json({ error: 'الشخص غير موجود' });
  }

  // Authoritative cooldown check-then-insert. node:sqlite's DatabaseSync API
  // is synchronous, so this whole handler runs to completion before Node's
  // single-threaded event loop can start another request — two "simultaneous"
  // sign-ins for the same person can't race each other into two visit rows.
  const recentVisit = db
    .prepare(`SELECT visited_at FROM visits WHERE person_id = ? AND kind = 'signin' ORDER BY visited_at DESC LIMIT 1`)
    .get(best.id);

  let visitedAt;
  if (recentVisit && Date.now() - new Date(recentVisit.visited_at).getTime() < REGREET_COOLDOWN_MS) {
    visitedAt = recentVisit.visited_at;
  } else {
    visitedAt = nowIso();
    db.prepare(`INSERT INTO visits (person_id, kind, visited_at) VALUES (?, 'signin', ?)`).run(best.id, visitedAt);
  }

  res.json({ name: best.name, photoUrl: `/photos/${best.photo_path}`, visitedAt });
});

// Dashboard summary: today's sign-ups and sign-ins — staff only.
app.get('/api/dashboard/today', requireAdmin, adminActionLimiter, (req, res) => {
  const prefix = todayPrefix();
  const yPrefix = `${yearPrefix()}%`;
  const signupsToday = db
    .prepare(
      `SELECT p.*,
        (SELECT COUNT(*) FROM visits v WHERE v.person_id = p.id AND v.kind = 'signin' AND v.visited_at LIKE ?) AS signin_count,
        (SELECT visited_at FROM visits v WHERE v.person_id = p.id AND v.kind = 'signin' ORDER BY v.visited_at DESC LIMIT 1) AS last_visit
       FROM people p
       WHERE p.created_at LIKE ?
       ORDER BY p.created_at DESC`
    )
    .all(yPrefix, `${prefix}%`)
    .map((row) => ({
      ...personRowToJson(row),
      signinCount: row.signin_count,
      lastVisit: row.last_visit,
    }));

  const signinsToday = db
    .prepare(
      `SELECT v.id, v.visited_at, p.id AS person_id, p.name, p.college, p.grade, p.gender, p.photo_path,
        (SELECT COUNT(*) FROM visits v2 WHERE v2.person_id = p.id AND v2.kind = 'signin' AND v2.visited_at LIKE ?) AS signin_count,
        (SELECT visited_at FROM visits v3 WHERE v3.person_id = p.id AND v3.kind = 'signin' ORDER BY v3.visited_at DESC LIMIT 1) AS last_visit
       FROM visits v JOIN people p ON p.id = v.person_id
       WHERE v.kind = 'signin' AND v.visited_at LIKE ?
       ORDER BY v.visited_at DESC`
    )
    .all(yPrefix, `${prefix}%`)
    .map((r) => ({
      visitId: r.id,
      visitedAt: r.visited_at,
      personId: r.person_id,
      name: r.name,
      college: r.college,
      grade: r.grade,
      gender: r.gender,
      photoUrl: `/photos/${r.photo_path}`,
      signinCount: r.signin_count,
      lastVisit: r.last_visit,
    }));

  const totalPeople = db.prepare('SELECT COUNT(*) AS c FROM people').get().c;

  res.json({
    date: prefix,
    totalPeople,
    signupsToday,
    signinsToday,
  });
});

// CSV field escaping for the export below:
//  1) CSV/Excel formula-injection prevention — a field is user-supplied (name,
//     phone, etc. all come from the public sign-up kiosk), so if it starts with
//     a character Excel/LibreOffice treats as a formula trigger (=, +, -, @, a
//     tab, or a carriage return), prefix it with a straight apostrophe to force
//     plain-text rendering instead of formula evaluation.
//  2) RFC4180 quoting — if the (possibly now-prefixed) field contains a comma,
//     double-quote, or newline, wrap it in double quotes and double any
//     internal double-quotes.
function csvEscapeField(value) {
  let str = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\n\r]/.test(str)) {
    str = `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Export the full roster as CSV — staff only. This is a full-PII dump
// (name/phone/college/grade/gender/visit stats), so it must stay behind
// requireAdmin exactly like GET /api/people.
app.get('/api/export/people.csv', requireAdmin, adminActionLimiter, (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.*,
        (SELECT COUNT(*) FROM visits v WHERE v.person_id = p.id AND v.kind = 'signin' AND v.visited_at LIKE ?) AS signin_count,
        (SELECT visited_at FROM visits v WHERE v.person_id = p.id AND v.kind = 'signin' ORDER BY v.visited_at DESC LIMIT 1) AS last_visit
       FROM people p
       ORDER BY p.created_at DESC`
    )
    .all(`${yearPrefix()}%`);

  const header = [
    'الاسم',
    'الهاتف',
    'الكلية',
    'المرحلة',
    'الجنس',
    'عدد مرات الحضور (هذا العام)',
    'آخر زيارة',
    'تاريخ التسجيل',
  ];
  const lines = [header.map(csvEscapeField).join(',')];
  for (const row of rows) {
    lines.push(
      [row.name, row.phone, row.college, row.grade, row.gender, row.signin_count, row.last_visit, row.created_at]
        .map(csvEscapeField)
        .join(',')
    );
  }
  const csv = '\uFEFF' + lines.join('\r\n') + '\r\n';

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="library-people.csv"');
  res.send(csv);
});

// Export one day's activity log (sign-up and/or sign-in events) as CSV —
// staff only, same PII/formula-injection precautions as the roster export.
// Query params: date=YYYY-MM-DD (required), types=signup,signin (optional,
// comma-separated subset; defaults to both).
app.get('/api/export/logs.csv', requireAdmin, adminActionLimiter, (req, res) => {
  const date = typeof req.query.date === 'string' ? req.query.date : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'يجب تحديد يوم صالح' });
  }

  const typesParam = typeof req.query.types === 'string' ? req.query.types : 'signup,signin';
  const requested = typesParam
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t === 'signup' || t === 'signin');
  const kinds = requested.length ? [...new Set(requested)] : ['signup', 'signin'];

  const placeholders = kinds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT v.kind, v.visited_at, p.name, p.phone, p.college, p.grade, p.gender
       FROM visits v JOIN people p ON p.id = v.person_id
       WHERE v.visited_at LIKE ? AND v.kind IN (${placeholders})
       ORDER BY v.visited_at ASC`
    )
    .all(`${date}%`, ...kinds);

  const header = ['نوع السجل', 'الاسم', 'الهاتف', 'الكلية', 'المرحلة', 'الجنس', 'الوقت'];
  const lines = [header.map(csvEscapeField).join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.kind === 'signup' ? 'تسجيل' : 'حضور',
        row.name,
        row.phone,
        row.college,
        row.grade,
        row.gender,
        row.visited_at,
      ]
        .map(csvEscapeField)
        .join(',')
    );
  }
  const csv = '\uFEFF' + lines.join('\r\n') + '\r\n';

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="library-logs-${date}.csv"`);
  res.send(csv);
});

// Catch-all for unmatched API routes.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'غير موجود' });
});

// Final error handler — never leak err.message/err.stack to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // A malformed request body (bad JSON) is a client mistake, not a server
  // fault — respond 400 instead of falling through to a generic 500.
  if (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && err.status === 400)) {
    return res.status(400).json({ error: 'طلب غير صالح' });
  }
  console.error(err);
  res.status(500).json({ error: 'خطأ داخلي في الخادم' });
});

function startServer() {
  const hasSsl =
    SSL_CERT_PATH && SSL_KEY_PATH && fs.existsSync(SSL_CERT_PATH) && fs.existsSync(SSL_KEY_PATH);

  if (hasSsl) {
    const options = {
      cert: fs.readFileSync(SSL_CERT_PATH),
      key: fs.readFileSync(SSL_KEY_PATH),
    };
    const server = https.createServer(options, app).listen(PORT, () => {
      console.log(`Library sign-in system running at https://localhost:${PORT}`);
      console.log(`  Sign-up tablet:  https://localhost:${PORT}/signup.html`);
      console.log(`  Sign-in tablet:  https://localhost:${PORT}/signin.html`);
      console.log(`  Dashboard:       https://localhost:${PORT}/dashboard.html`);
    });
    return server;
  }

  const server = http.createServer(app).listen(PORT, () => {
    console.log(`Library sign-in system running at http://localhost:${PORT}`);
    console.log(`  Sign-up tablet:  http://localhost:${PORT}/signup.html`);
    console.log(`  Sign-in tablet:  http://localhost:${PORT}/signin.html`);
    console.log(`  Dashboard:       http://localhost:${PORT}/dashboard.html`);
  });

  // Shown regardless of NODE_ENV — gating this behind 'production' meant it
  // never fired for an operator who hasn't set up .env yet, which is exactly
  // the operator most likely to need the warning.
  console.warn(
    'WARNING: serving over plain HTTP. Browsers BLOCK camera access (getUserMedia) ' +
      'on every origin except https:// and localhost — any kiosk tablet that is not ' +
      'literally "localhost" will not be able to use its camera. Set SSL_CERT_PATH ' +
      'and SSL_KEY_PATH (or put a reverse proxy in front) to serve over HTTPS instead. ' +
      'See README.md.'
  );

  return server;
}

const server = startServer();

function shutdown(signal) {
  console.log(`\nReceived ${signal}, shutting down gracefully...`);
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Last-resort safety net: every route handler and DB call in this file is
// synchronous, so this should rarely if ever fire — but if it does, the
// alternative is Node's default behavior of crashing the entire process
// silently, taking all three kiosk pages down until someone notices and
// manually restarts it. Logging and staying up is the better failure mode
// for this app; run it behind a process manager (see README) for real
// crash recovery rather than relying on this alone.
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

module.exports = app;
