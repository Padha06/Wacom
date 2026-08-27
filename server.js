const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load .env locally if present (Vercel/Railway inject env vars directly, so this is a no-op in prod)
try { require('dotenv').config(); } catch (e) {}

const ROOT = path.join(__dirname, 'public');

// ---- Configuration from environment (Vercel/Railway) with config.json fallback (local) ----
let fileConfig = {};
try { fileConfig = require('./config.json'); } catch (e) {}

function stripQuotes(v) {
  let s = String(v).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  return s;
}

function envOrFile(envName, fileKey, def) {
  const envRaw = process.env[envName];
  if (envRaw != null && String(envRaw).trim() !== '') return stripQuotes(envRaw);
  const fileVal = fileConfig[fileKey];
  if (fileVal != null && String(fileVal).trim() !== '') return stripQuotes(fileVal);
  return def;
}

const config = {
  port: parseInt(envOrFile('PORT', 'port', '3000'), 10) || 3000,
  tenantId: envOrFile('TENANT_ID', 'tenantId', ''),
  environment: envOrFile('ENVIRONMENT', 'environment', ''),
  company: envOrFile('COMPANY', 'company', ''),
  companyGuid: envOrFile('COMPANY_GUID', 'companyGuid', ''),
  clientId: envOrFile('CLIENT_ID', 'clientId', ''),
  clientSecret: envOrFile('CLIENT_SECRET', 'clientSecret', '')
};

const bc = require('./bc.js')(config);
const { buildSignedPdf } = require('./pdf.js');

// ---- Login users: APP_USERS = "user1:pass1|STATION1,user2:pass2|STATION2" ----
// Each entry maps a login username+password to a BC station code.
// Also supports legacy STATION_PINS fallback (warns), and strips quotes for Vercel copy-paste.
const appUsers = new Map();
function parseAppUsers(src) {
  appUsers.clear();
  const cleaned = stripQuotes(String(src || '').trim());
  cleaned
    .split(',')
    .forEach(function (entry) {
      entry = stripQuotes(entry.trim());
      if (!entry) return;
      const pipe = entry.indexOf('|');
      const station = pipe > 0 ? stripQuotes(entry.slice(pipe + 1).trim()).toUpperCase() : '';
      const cred = pipe > 0 ? entry.slice(0, pipe) : entry;
      const colon = cred.indexOf(':');
      if (colon > 0) {
        const user = stripQuotes(cred.slice(0, colon).trim());
        const pass = stripQuotes(cred.slice(colon + 1).trim());
        if (user && pass && station) appUsers.set(user, { password: pass, station });
      }
    });
}
let _appUsersSrc = envOrFile('APP_USERS', 'appUsers', '');
if (!_appUsersSrc) {
  const legacy = envOrFile('STATION_PINS', 'stationPins', '');
  if (legacy) {
    console.warn('[auth] APP_USERS empty - ignoring legacy STATION_PINS (different format). Set APP_USERS="user:pass|STATION,..."');
  }
}
parseAppUsers(_appUsersSrc);

// ---- Auth sessions: token -> { username, station, createdAt } ----
const authSessions = new Map();
const AUTH_TTL_MS = 12 * 60 * 60 * 1000; // 12h

function makeAuthToken() {
  return crypto.randomBytes(24).toString('hex');
}

function createAuthSession(username, station) {
  const token = makeAuthToken();
  authSessions.set(token, { username, station, createdAt: Date.now() });
  return token;
}

function getAuthToken(req) {
  const url = new URL(req.url, 'http://localhost');
  const q = url.searchParams.get('token');
  if (q) return q;
  const cookies = req.headers.cookie || '';
  const m = cookies.match(/(?:^|;\s*)ws_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

function authFor(req) {
  const token = getAuthToken(req);
  if (!token) return null;
  const s = authSessions.get(token);
  if (!s) return null;
  if (Date.now() - s.createdAt > AUTH_TTL_MS) { authSessions.delete(token); return null; }
  return s;
}

// ---- Signing sessions keyed by station ----
const sessions = new Map();

function newSessionId() { return crypto.randomBytes(8).toString('hex'); }

function mapTransaction(rec) {
  return {
    transactionType: rec.transactionType,
    documentNo: rec.documentNo,
    documentType: rec.documentType,
    accountNo: rec.accountNo,
    accountType: rec.accountType,
    balAccountNo: rec.balAccountNo,
    currencyCode: rec.currencyCode,
    postingDate: rec.postingDate,
    amount: rec.amount,
    amountLCY: rec.amountLCY,
    currencyFactor: rec.currencyFactor,
    vendorName: rec.vendorName,
    customerName: rec.customerName,
    primaryContactCode: rec.primaryContactCode,
    documentAttached: rec.documentAttached,
    lines: (rec.treasuryTransactionLines || []).map(function (l) {
      return {
        lineNo: l.lineNo,
        postingDate: l.postingDate,
        accountNo: l.accountNo,
        description: l.description,
        accountType: l.accountType,
        balAccountNo: l.balAccountNo,
        currencyCode: l.currencyCode,
        treasuryTransactionType: l.treasuryTransactionType,
        expectedUSD: l.expectedUSD,
        actualUSD: l.actualUSD,
        fxDifference: l.fxDifference
      };
    })
  };
}

function sessionPublic(sesh) {
  return {
    id: sesh.id,
    status: sesh.status,
    record: sesh.record,
    strokes: sesh.strokes.length,
    savedAt: sesh.savedAt,
    error: sesh.error
  };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

function serveStatic(req, res, urlPath) {
  let p = urlPath;
  if (p === '/' || p === '') p = '/login.html';
  if (p === '/login' || p === '/login/') p = '/login.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403); res.end(); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found'); return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 5e6) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const lastDispatchCheck = new Map();
const txCache = new Map();

async function checkDispatchQueue(station, force) {
  const now = Date.now();
  const last = lastDispatchCheck.get(station) || 0;
  if (!force && now - last < 700) return null;
  lastDispatchCheck.set(station, now);
  return await bc.getOpenDispatch(station);
}

async function cachedTransaction(tt, dn) {
  const key = tt + '\u0000' + dn;
  const hit = txCache.get(key);
  if (hit && Date.now() - hit.at < 120000) return hit.record;
  const rec = await bc.getTreasuryTransaction(tt, dn);
  txCache.set(key, { at: Date.now(), record: rec });
  return rec;
}

function makeSession(station, tt, dn, record) {
  const sesh = {
    id: newSessionId(),
    station,
    transactionType: tt,
    documentNo: dn,
    status: 'waiting',
    record: mapTransaction(record),
    strokes: [],
    currentStroke: null,
    subscribers: new Set(),
    savedAt: null,
    error: null
  };
  sessions.set(station, sesh);
  return sesh;
}

async function ensureActiveSession(station) {
  const cur = sessions.get(station);
  // When idle (no session yet), query immediately so a newly dispatched document
  // appears on the very next poll (~1s). When a session is active, throttle.
  const dispatch = await checkDispatchQueue(station, !cur || cur.status === 'signed');
  if (!dispatch) {
    return (cur && cur.status !== 'signed') ? cur : null;
  }
  // Same dispatch as the current session -> keep it (do not reset the canvas).
  if (cur && cur.status !== 'signed' &&
      cur.transactionType === dispatch.transactionType &&
      cur.documentNo === dispatch.documentNo) {
    return cur;
  }
  // A different dispatch arrived (e.g. a new "Take Vendor Signature" action).
  // Switch to the newest one, but only if the user hasn't started signing yet;
  // never wipe a signature in progress.
  if (cur && cur.strokes.length > 0 && cur.status !== 'signed') return cur;
  const record = await cachedTransaction(dispatch.transactionType, dispatch.documentNo);
  return makeSession(station, dispatch.transactionType, dispatch.documentNo, record);
}

function sendEvent(sesh, name, data) {
  const msg = 'event: ' + name + '\ndata: ' + JSON.stringify(data) + '\n\n';
  for (const push of sesh.subscribers) {
    try { push(msg); } catch (e) {}
  }
}

const handler = async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  try {
    // Authentication: accepts JSON ({username,password,redirect?}) or a browser
    // form POST (application/x-www-form-urlencoded, same fields). On success sets
    // the session cookie and returns JSON (for fetch) or a 302 redirect (for a
    // native form submission) to the user's station kiosk page.
    if (p === '/api/login' && req.method === 'POST') {
      const raw = (await readBody(req)) || '';
      let u = '', pw = '', dest = '';
      const ctype = String(req.headers['content-type'] || '');
      if (ctype.indexOf('application/json') >= 0) {
        const body = JSON.parse(raw || '{}');
        u = String(body.username || '').trim();
        pw = String(body.password || '');
        dest = String(body.redirect || '');
      } else {
        const params = new URLSearchParams(raw);
        u = String(params.get('username') || '').trim();
        pw = String(params.get('password') || '');
        dest = String(params.get('redirect') || '');
      }
      const user = appUsers.get(u);
      const wantJson = ctype.indexOf('application/json') >= 0;
      if (!user || user.password !== pw) {
        if (wantJson) return sendJson(res, 401, { error: 'Invalid username or password.' });
        return redirectTo(res, '/login?error=1');
      }
      if (!user.station) {
        if (wantJson) return sendJson(res, 400, { error: 'This user is not mapped to a station.' });
        return redirectTo(res, '/login?error=1');
      }
      const token = createAuthSession(u, user.station);
      res.setHeader('Set-Cookie', 'ws_token=' + encodeURIComponent(token) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + (AUTH_TTL_MS / 1000));
      if (wantJson) {
        return sendJson(res, 200, { ok: true, token: token, station: user.station, username: u });
      }
      return redirectTo(res, dest || ('/s/' + user.station));
    }

    if (p === '/api/logout' && req.method === 'POST') {
      const token = getAuthToken(req);
      if (token) authSessions.delete(token);
      res.setHeader('Set-Cookie', 'ws_token=; Path=/; HttpOnly; Max-Age=0');
      return sendJson(res, 200, { ok: true });
    }

    // Station-scoped pages require login, and the logged-in user's station
    // must match the station in the path.
    const pageMatch = p.match(/^\/(s|m)\/([A-Za-z0-9_-]+)\/?$/);
    if (pageMatch) {
      const station = pageMatch[2].toUpperCase();
      const auth = authFor(req);
      if (!auth) return redirectLogin(res, p + (url.search ? url.search : ''));
      if (auth.station !== station) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden: you are logged in for station ' + auth.station + ' but requested ' + station + '.'); return;
      }
      const page = pageMatch[1] === 's' ? '/sign.html' : '/monitor.html';
      return serveStatic(req, res, page);
    }

    if (p.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store');

      if (p === '/api/ping' && req.method === 'GET') {
        return sendJson(res, 200, { ok: true });
      }

      if (p === '/api/status' && req.method === 'GET') {
        const auth = authFor(req);
        if (!auth) return sendJson(res, 401, { error: 'Not authenticated.' });
        return sendJson(res, 200, { ok: true, station: auth.station, token: bc.tokenInfo() });
      }

      // The authenticated user's station is used for all signing endpoints.
      const auth = authFor(req);
      if (!auth) return sendJson(res, 401, { error: 'Not authenticated. Please log in.' });
      const station = auth.station;

      if (p === '/api/session' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}');
        if (body.transactionType && body.documentNo) {
          const tt = body.transactionType;
          const dn = body.documentNo;
          const sesh = makeSession(station, tt, dn, await cachedTransaction(tt, dn));
          return sendJson(res, 200, sessionPublic(sesh));
        }
        const s = await ensureActiveSession(station);
        if (s) return sendJson(res, 200, sessionPublic(s));
        return sendJson(res, 404, { error: 'No pending document for this station. Dispatch one from Business Central using "Take Vendor Signature".' });
      }

      if (p === '/api/session/current' && req.method === 'GET') {
        await ensureActiveSession(station);
        const sesh = sessions.get(station);
        if (!sesh) return sendJson(res, 404, { error: 'no active session' });
        return sendJson(res, 200, sessionPublic(sesh));
      }

      const sesh = sessions.get(station);
      if (!sesh) return sendJson(res, 404, { error: 'no active session' });

      if (p === '/api/session/stroke' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}');
        if (!Array.isArray(body.points) || body.points.length === 0) return sendJson(res, 400, { error: 'points required' });
        if (sesh.status !== 'signed') sesh.status = 'signing';
        sesh.strokes.push(body.points);
        sendEvent(sesh, 'stroke', { index: sesh.strokes.length - 1, points: body.points });
        return sendJson(res, 200, { ok: true });
      }

      if (p === '/api/session/events' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive'
        });
        res.write('retry: 1000\n');
        const push = (name, data) => {
          res.write('event: ' + name + '\ndata: ' + JSON.stringify(data) + '\n\n');
        };
        push('snapshot', { status: sesh.status, strokes: sesh.strokes, savedAt: sesh.savedAt, error: sesh.error });
        sesh.subscribers.add(push);
        req.on('close', () => sesh.subscribers.delete(push));
        return;
      }

      if (p === '/api/session/save' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}');
        if (!body.base64) return sendJson(res, 400, { error: 'base64 required' });
        sesh.status = 'saving';
        sendEvent(sesh, 'status', { status: 'saving' });
        try {
          await bc.saveSignature(sesh.transactionType, sesh.documentNo, body.base64);
          sesh.status = 'signed';
          sesh.savedAt = new Date().toISOString();

          // Build the full signed PDF (report + signature) and upload it as an
          // attachment to the same treasury transaction.
          const pdfResult = { fileName: '', pdfUploaded: false, pdfError: null };
          try {
            const pdfBase64 = await buildSignedPdf(sesh.record, body.base64);
            pdfResult.fileName = makeFileName();
            await bc.uploadDocument(sesh.transactionType, sesh.documentNo, pdfResult.fileName, pdfBase64);
            pdfResult.pdfUploaded = true;
          } catch (pdfErr) {
            pdfResult.pdfError = String(pdfErr.message || pdfErr);
            console.error('[pdf] upload failed:', pdfResult.pdfError);
          }
          if (pdfResult.pdfUploaded) sendEvent(sesh, 'pdfSaved', { fileName: pdfResult.fileName });

          try { await bc.completeDispatch(sesh.transactionType, sesh.documentNo); } catch (e) {}
          sendEvent(sesh, 'saved', { savedAt: sesh.savedAt });
          return sendJson(res, 200, {
            ok: true, savedAt: sesh.savedAt,
            fileName: pdfResult.fileName, pdfUploaded: pdfResult.pdfUploaded, pdfError: pdfResult.pdfError
          });
        } catch (err) {
          sesh.status = 'signing';
          sesh.error = String(err.message || err);
          sendEvent(sesh, 'error', { message: sesh.error });
          return sendJson(res, 500, { error: sesh.error });
        }
      }

      if (p === '/api/session' && req.method === 'DELETE') {
        sessions.delete(station);
        return sendJson(res, 200, { ok: true });
      }

      return sendJson(res, 404, { error: 'unknown api path' });
    }

    serveStatic(req, res, p);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      sendJson(res, 500, { error: String(err.message || err) });
    }
  }
};

function redirectTo(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function redirectLogin(res, dest) {
  res.writeHead(302, { Location: '/login' + (dest ? '?redirect=' + encodeURIComponent(dest) : '') });
  res.end();
}

// Generate an attachment file name, always *.pdf (e.g. treasuredoc-20260827-a1b2c3.pdf).
function makeFileName() {
  const ts = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rnd = crypto.randomBytes(3).toString('hex');
  return 'treasuredoc-' + ts + '-' + rnd + '.pdf';
}

const server = http.createServer(handler);

if (!process.env.VERCEL) {
  server.listen(config.port, '0.0.0.0', () => {
    console.log('Signing server running on port ' + config.port);
    console.log('  Login:  /login');
    console.log('  Monitor: /m/<STATION>');
    console.log('  Kiosk:   /s/<STATION>');
    console.log('  App users loaded: ' + appUsers.size + (appUsers.size ? ' (' + Array.from(appUsers.keys()).join(', ') + ')' : ' - SET APP_USERS env!'));
    if (appUsers.size === 0) {
      console.warn('  WARNING: No APP_USERS configured. Login will fail. Set APP_USERS="user1:pass1|STATION1,user2:pass2|STATION2" in env (no quotes).');
    }
  });
} else {
  console.log('Running on Vercel - serverless mode, app users: ' + appUsers.size);
}

// Export handler for Vercel serverless - must be a function (req,res)
module.exports = handler;
module.exports.default = handler;
module.exports.server = server;
