import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const scrypt = promisify(scryptCallback);
const root = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DATABASE_PATH || join(root, 'data', 'cubely.db');
await mkdir(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec(`PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS competitions (id INTEGER PRIMARY KEY, title TEXT NOT NULL, event TEXT NOT NULL, scheduled_at TEXT, owner_id INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS participants (id INTEGER PRIMARY KEY, competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(competition_id, user_id));
CREATE TABLE IF NOT EXISTS matches (id INTEGER PRIMARY KEY, competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE, position INTEGER NOT NULL, player_a_id INTEGER NOT NULL REFERENCES participants(id), player_b_id INTEGER NOT NULL REFERENCES participants(id), status TEXT NOT NULL DEFAULT 'upcoming' CHECK(status IN ('upcoming','live','completed')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(competition_id, position));`);
try { db.exec('ALTER TABLE competitions ADD COLUMN order_published INTEGER NOT NULL DEFAULT 0'); } catch { /* Existing database. */ }

const mime = { '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const bad = (res, status, message) => json(res, status, { error: message });
const parseCookies = request => Object.fromEntries((request.headers.cookie || '').split(';').map(v => v.trim().split('=').map(decodeURIComponent)).filter(v => v[0]));
const hashToken = token => createHash('sha256').update(token).digest('hex');
const sessionDays = remember => remember ? 30 : 1;
async function passwordHash(password) { const salt = randomBytes(16).toString('hex'); return `${salt}:${(await scrypt(password, salt, 64)).toString('hex')}`; }
async function passwordValid(password, stored) { const [salt, value] = stored.split(':'); const candidate = (await scrypt(password, salt, 64)).toString('hex'); return timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(value, 'hex')); }
function originAllowed(request) { const origin = request.headers.origin; return !origin || origin === `http://${request.headers.host}` || origin === `https://${request.headers.host}`; }
function currentUser(request) { const token = parseCookies(request).cubely_session; if (!token) return null; const row = db.prepare(`SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at > CURRENT_TIMESTAMP`).get(hashToken(token)); return row || null; }
function setSession(res, userId, remember) { const token = randomBytes(32).toString('base64url'); const days = sessionDays(remember); db.prepare(`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, datetime('now', ?))`).run(userId, hashToken(token), `+${days} days`); const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''; res.setHeader('set-cookie', `cubely_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${days * 86400}${secure}`); }
function competitionSummary(userId) { return db.prepare(`SELECT c.id, c.title, c.event, c.scheduled_at, c.created_at, u.name AS organizer, COUNT(p.id) AS participant_count, EXISTS(SELECT 1 FROM matches m WHERE m.competition_id=c.id) AS has_order FROM competitions c JOIN users u ON u.id=c.owner_id LEFT JOIN participants p ON p.competition_id=c.id GROUP BY c.id ORDER BY c.created_at DESC`).all(); }
function competitionDetail(id, user) { const competition = db.prepare(`SELECT c.id,c.title,c.event,c.scheduled_at,c.owner_id,c.order_published,c.created_at,u.name AS organizer FROM competitions c JOIN users u ON u.id=c.owner_id WHERE c.id=?`).get(id); if (!competition) return null; const participants = db.prepare(`SELECT p.id,u.id AS user_id,u.name FROM participants p JOIN users u ON u.id=p.user_id WHERE p.competition_id=? ORDER BY p.created_at`).all(id);
 const allMatches = db.prepare(`SELECT m.id,m.position,m.status,m.player_a_id,m.player_b_id,a.name AS player_a,b.name AS player_b FROM matches m JOIN participants pa ON pa.id=m.player_a_id JOIN users a ON a.id=pa.user_id JOIN participants pb ON pb.id=m.player_b_id JOIN users b ON b.id=pb.user_id WHERE m.competition_id=? ORDER BY m.position`).all(id);
 const isOwner = !!user && user.id === competition.owner_id;
 return { competition: { ...competition, is_owner: isOwner, is_joined: !!user && participants.some(p => p.user_id === user.id) }, participants: isOwner ? participants : undefined, matches: isOwner || competition.order_published ? allMatches : [], order_state: allMatches.length ? (competition.order_published ? 'published' : 'draft') : 'empty' };
}
async function body(request) { let raw=''; for await (const chunk of request) { raw += chunk; if (raw.length > 1_000_000) throw Error('Payload trop volumineux'); } try { return raw ? JSON.parse(raw) : {}; } catch { throw Error('JSON invalide'); } }
function requireUser(request, res) { const user = currentUser(request); if (!user) { bad(res, 401, 'Connexion requise.'); return null; } return user; }
function requireOwner(id, user, res) { const c = db.prepare('SELECT owner_id FROM competitions WHERE id=?').get(id); if (!c) { bad(res, 404, 'Compétition introuvable.'); return false; } if (c.owner_id !== user.id) { bad(res, 403, 'Seul l’organisateur peut effectuer cette action.'); return false; } return true; }

async function api(request, res, path) {
 if (request.method === 'GET' && path === '/api/health') return json(res, 200, { ok: true, app: 'cubely' });
 if (request.method !== 'GET' && !originAllowed(request)) return bad(res, 403, 'Origine non autorisée.');
 if (request.method === 'GET' && path === '/api/auth/session') return json(res, 200, { user: currentUser(request) });
 if (request.method === 'POST' && path === '/api/auth/register') { const { name, email, password, remember } = await body(request); if (!name?.trim() || !/^\S+@\S+\.\S+$/.test(email || '') || !password || password.length < 10) return bad(res, 422, 'Nom, email valide et mot de passe de 10 caractères requis.'); try { const result = db.prepare('INSERT INTO users (name,email,password_hash) VALUES (?,?,?)').run(name.trim().slice(0,80), email.trim().toLowerCase(), await passwordHash(password)); setSession(res, Number(result.lastInsertRowid), !!remember); return json(res, 201, { user: currentUser(request) }); } catch { return bad(res, 409, 'Cet email est déjà utilisé.'); } }
 if (request.method === 'POST' && path === '/api/auth/login') { const { email, password, remember } = await body(request); const user = db.prepare('SELECT * FROM users WHERE email=?').get((email || '').trim().toLowerCase()); if (!user || !await passwordValid(password || '', user.password_hash)) return bad(res, 401, 'Email ou mot de passe incorrect.'); db.prepare(`DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP`).run(); setSession(res, user.id, !!remember); return json(res, 200, { user: currentUser(request) }); }
 if (request.method === 'POST' && path === '/api/auth/logout') { const token = parseCookies(request).cubely_session; if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token)); res.setHeader('set-cookie', 'cubely_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'); return json(res, 200, { ok: true }); }
 if (request.method === 'GET' && path === '/api/competitions') return json(res, 200, { competitions: competitionSummary() });
 if (request.method === 'POST' && path === '/api/competitions') { const user=requireUser(request,res); if(!user)return; const { title,event,scheduled_at }=await body(request); if(!title?.trim()||!event?.trim())return bad(res,422,'Nom et épreuve requis.'); const result=db.prepare('INSERT INTO competitions(title,event,scheduled_at,owner_id) VALUES(?,?,?,?)').run(title.trim().slice(0,120),event.trim().slice(0,80),scheduled_at||null,user.id); const id=Number(result.lastInsertRowid); db.prepare('INSERT INTO participants(competition_id,user_id) VALUES(?,?)').run(id,user.id); return json(res,201,competitionDetail(id,user)); }
 const match = path.match(/^\/api\/competitions\/(\d+)(?:\/(join|matches|publish))?$/);
 if (match) {
  const id=Number(match[1]), action=match[2], user=currentUser(request);
  if(request.method==='GET'&&!action){const detail=competitionDetail(id,user);return detail?json(res,200,detail):bad(res,404,'Compétition introuvable.');}
  if(request.method==='POST'&&action==='join'){if(!user)return bad(res,401,'Connexion requise.');try{db.prepare('INSERT INTO participants(competition_id,user_id) VALUES(?,?)').run(id,user.id);}catch{}return json(res,200,competitionDetail(id,user));}
  if(request.method==='PUT'&&action==='matches'){
   if(!user||!requireOwner(id,user,res))return; const {matches=[]}=await body(request); if(!Array.isArray(matches))return bad(res,422,'Ordre invalide.');
   const participantIds=new Set(db.prepare('SELECT id FROM participants WHERE competition_id=?').all(id).map(p=>p.id));
   if(matches.some((m,i)=>!participantIds.has(Number(m.player_a_id))||!participantIds.has(Number(m.player_b_id))||Number(m.player_a_id)===Number(m.player_b_id)||!Number.isInteger(m.position)||m.position!==i+1))return bad(res,422,'Chaque match doit associer deux participants différents, avec un ordre continu.');
   db.prepare('DELETE FROM matches WHERE competition_id=?').run(id); db.prepare('UPDATE competitions SET order_published=0 WHERE id=?').run(id);
   const insert=db.prepare('INSERT INTO matches(competition_id,position,player_a_id,player_b_id,status) VALUES(?,?,?,?,?)'); for(const m of matches)insert.run(id,m.position,m.player_a_id,m.player_b_id,m.status==='live'||m.status==='completed'?m.status:'upcoming'); return json(res,200,competitionDetail(id,user));
  }
  if(request.method==='POST'&&action==='publish'){if(!user||!requireOwner(id,user,res))return; const {match_id,status}=await body(request); if(status&&!['upcoming','live','completed'].includes(status))return bad(res,422,'Statut invalide.'); if(status==='live')db.prepare("UPDATE matches SET status='upcoming' WHERE competition_id=? AND status='live'").run(id); if(match_id)db.prepare('UPDATE matches SET status=? WHERE id=? AND competition_id=?').run(status||'upcoming',match_id,id); db.prepare('UPDATE competitions SET order_published=1 WHERE id=?').run(id); return json(res,200,competitionDetail(id,user));}
 }
 return bad(res,404,'Route introuvable.');
}

const handler=async(request,res)=>{try{const url=new URL(request.url,`http://${request.headers.host}`);if(url.pathname.startsWith('/api/'))return await api(request,res,url.pathname);const safe=normalize(url.pathname==='/'?'index.html':url.pathname).replace(/^([.][.][/\\])+/, '');const path=join(root,safe);if(!path.startsWith(root))return bad(res,403,'Accès refusé.');await stat(path);res.writeHead(200,{'content-type':mime[extname(path)]||'application/octet-stream'});res.end(await readFile(path));}catch(error){if(error?.code==='ENOENT')return bad(res,404,'Fichier introuvable.');console.error(error);return bad(res,500,'Erreur interne.')}};
export default handler;
if (process.argv[1] === fileURLToPath(import.meta.url)) createServer(handler).listen(Number(process.env.PORT)||3000,()=>console.log('Cubely démarré sur http://localhost:3000'));
