import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const port = Number(process.env.PORT || 8787);
const firebaseProjectId = process.env.FIREBASE_PROJECT_ID;
const supportAdminUid = process.env.SUPPORT_ADMIN_UID;
const allowedOrigins = (process.env.APP_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const dbPath = resolve(process.env.SUPPORT_DB_PATH || './data/support.sqlite');
const maxPayloadBytes = 21 * 1024 * 1024;
const maxAttachmentsBytes = 15 * 1024 * 1024;
const supportedStates = new Set(['new', 'progress', 'resolved']);
if (!firebaseProjectId || !supportAdminUid || allowedOrigins.length === 0) {
  throw new Error('Set FIREBASE_PROJECT_ID, SUPPORT_ADMIN_UID and APP_ORIGINS before starting the support API.');
}
mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author_uid TEXT NOT NULL,
    author_email TEXT,
    author_name TEXT,
    description TEXT NOT NULL,
    page TEXT,
    browser TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id),
    filename TEXT NOT NULL,
    mime TEXT NOT NULL,
    content BLOB NOT NULL
  );
  CREATE INDEX IF NOT EXISTS tickets_created_idx ON tickets(created_at DESC);
`);
const jwks = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));

async function authenticate(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) throw httpError(401, 'Accesso richiesto.');
  try {
    const { payload } = await jwtVerify(header.slice(7), jwks, {
      issuer: `https://securetoken.google.com/${firebaseProjectId}`,
      audience: firebaseProjectId,
      algorithms: ['RS256']
    });
    if (!payload.sub || typeof payload.sub !== 'string') throw new Error('Invalid user');
    return { uid: payload.sub, email: String(payload.email || ''), name: String(payload.name || ''), admin: payload.sub === supportAdminUid && String(payload.email || '').toLowerCase() === 'squadmanagersupport@gmail.com' };
  } catch { throw httpError(401, 'Sessione non valida. Accedi nuovamente.'); }
}
function httpError(status, message) { return Object.assign(new Error(message), { status }); }
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}
async function readJson(req) {
  const parts = []; let length = 0;
  for await (const part of req) {
    length += part.length;
    if (length > maxPayloadBytes) throw httpError(413, 'Allegati troppo grandi.');
    parts.push(part);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw httpError(400, 'Richiesta non valida.'); }
}
function serializeTicket(row) {
  return { id: row.id, authorEmail: row.author_email || '', authorName: row.author_name || '', description: row.description, page: row.page || '', browser: row.browser || '', status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, attachments: db.prepare('SELECT id,filename,mime,length(content) as size FROM attachments WHERE ticket_id=?').all(row.id).map(a => ({ id: a.id, name: a.filename, type: a.mime, size: a.size })) };
}
function listTickets() {
  return db.prepare('SELECT * FROM tickets ORDER BY created_at DESC LIMIT 500').all().map(serializeTicket);
}
function createTicket(body, user) {
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (!description || description.length > 2000) throw httpError(400, 'Descrizione non valida.');
  if (!Array.isArray(body.attachments) || body.attachments.length > 8) throw httpError(400, 'Allegati non validi.');
  let total = 0; const attachments = [];
  for (const file of body.attachments) {
    if (typeof file?.name !== 'string' || file.name.length > 180 || typeof file?.type !== 'string' || !/^(image|video)\/[a-z0-9.+-]+$/i.test(file.type) || typeof file?.base64 !== 'string') throw httpError(400, 'Allegato non valido.');
    const normalized = file.base64.replace(/\s/g, '');
    if (!/^[a-zA-Z0-9+/]*={0,2}$/.test(normalized)) throw httpError(400, 'Codifica allegato non valida.');
    const bytes = Buffer.from(normalized, 'base64');
    total += bytes.length;
    if (total > maxAttachmentsBytes) throw httpError(413, 'Gli allegati superano 15 MB.');
    attachments.push({ filename: file.name.replace(/[\r\n]/g, '_'), mime: file.type, content: bytes });
  }
  const now = new Date().toISOString();
  const insert = db.prepare('INSERT INTO tickets(author_uid,author_email,author_name,description,page,browser,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)');
  const insertAttachment = db.prepare('INSERT INTO attachments(ticket_id,filename,mime,content) VALUES(?,?,?,?)');
  db.exec('BEGIN');
  try {
    const result = insert.run(user.uid, user.email, user.name, description, String(body.page || '').slice(0, 80), String(body.browser || '').slice(0, 500), 'new', now, now);
    for (const attachment of attachments) insertAttachment.run(Number(result.lastInsertRowid), attachment.filename, attachment.mime, attachment.content);
    db.exec('COMMIT');
    return Number(result.lastInsertRowid);
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  } else if (origin) { json(res, 403, { error: 'Origine non autorizzata.' }); return; }
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname === '/health' && req.method === 'GET') return json(res, 200, { ok: true });
    if (!url.pathname.startsWith('/api/support/')) throw httpError(404, 'Non trovato.');
    const user = await authenticate(req);
    if (url.pathname === '/api/support/tickets' && req.method === 'POST') {
      if (user.admin) throw httpError(403, 'L’account di assistenza non può inviare segnalazioni.');
      const body = await readJson(req);
      const id = createTicket(body, user);
      return json(res, 201, { id });
    }
    if (!user.admin) throw httpError(403, 'Area riservata al supporto.');
    if (url.pathname === '/api/support/tickets' && req.method === 'GET') return json(res, 200, { tickets: listTickets() });
    const statusMatch = /^\/api\/support\/tickets\/(\d+)\/status$/.exec(url.pathname);
    if (statusMatch && req.method === 'PATCH') {
      const body = await readJson(req);
      if (!supportedStates.has(body.status)) throw httpError(400, 'Stato non valido.');
      const result = db.prepare('UPDATE tickets SET status=?,updated_at=? WHERE id=?').run(body.status, new Date().toISOString(), Number(statusMatch[1]));
      if (!result.changes) throw httpError(404, 'Segnalazione non trovata.');
      return json(res, 200, { ok: true });
    }
    const attachmentMatch = /^\/api\/support\/tickets\/(\d+)\/attachments\/(\d+)$/.exec(url.pathname);
    if (attachmentMatch && req.method === 'GET') {
      const row = db.prepare('SELECT filename,mime,content FROM attachments WHERE ticket_id=? AND id=?').get(Number(attachmentMatch[1]), Number(attachmentMatch[2]));
      if (!row) throw httpError(404, 'Allegato non trovato.');
      res.writeHead(200, { 'Content-Type': row.mime, 'Content-Disposition': 'attachment; filename="support-attachment"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(row.content); return;
    }
    throw httpError(404, 'Non trovato.');
  } catch (error) {
    console.error('Support API request failed:', error.message);
    json(res, error.status || 500, { error: error.status ? error.message : 'Errore interno del server.' });
  }
});
server.listen(port, '0.0.0.0', () => console.log(`Support API listening on port ${port}`));
