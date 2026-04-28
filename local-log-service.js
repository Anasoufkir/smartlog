const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Client } = require('ssh2');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { readFile } = require('fs/promises');
const Anthropic = require('@anthropic-ai/sdk');

// Load .env file
(function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const eq = line.indexOf('=');
    if (eq < 1) return;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (key && !process.env[key]) process.env[key] = val;
  });
})();

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

const DB_DIR        = path.join(__dirname, 'data');
const USERS_FILE    = path.join(DB_DIR, 'users.json');
const SESSIONS_FILE = path.join(DB_DIR, 'sessions.json');
const STATIC_ROOT   = __dirname;
const DEFAULT_USER  = process.env.LOGSCOPE_ADMIN_USER || 'admin';
const DEFAULT_PASS  = process.env.LOGSCOPE_ADMIN_PASS || 'logscope123';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const sessions = new Map();

// ── Session persistence ───────────────────────────────────────────────────────

function loadPersistedSessions() {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) return;
    const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    const now = Date.now();
    let loaded = 0;
    for (const [token, session] of Object.entries(data)) {
      if (session.expiresAt > now) { sessions.set(token, session); loaded++; }
    }
    if (loaded > 0) console.log(`[sessions] ${loaded} session(s) restaurée(s) depuis le disque.`);
  } catch { /* ignore corrupted file */ }
}

function persistSessions() {
  try {
    fs.mkdirSync(DB_DIR, { recursive: true });
    const data = {};
    for (const [token, session] of sessions.entries()) data[token] = session;
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data));
  } catch { /* non-fatal */ }
}

// Persist every 60 s and on clean shutdown
setInterval(persistSessions, 60_000).unref();
process.on('SIGTERM', () => { persistSessions(); process.exit(0); });
process.on('SIGINT',  () => { persistSessions(); process.exit(0); });

loadPersistedSessions();

// ── Utilitaires mot de passe ──────────────────────────────────────────────────

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
}

function createPasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, passwordHash: hashPassword(password, salt) };
}

// ── Persistance utilisateurs ──────────────────────────────────────────────────

function readUsers() {
  if (!fs.existsSync(USERS_FILE)) return [];
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function nextUserId() {
  const users = readUsers();
  return users.length === 0 ? 1 : Math.max(...users.map(u => u.id)) + 1;
}

function ensureAuthDatabase() {
  fs.mkdirSync(DB_DIR, { recursive: true });
  const existingUsers = readUsers();
  if (existingUsers.length === 0) {
    const record = createPasswordRecord(DEFAULT_PASS);
    writeUsers([{
      id: 1,
      username: DEFAULT_USER,
      role: 'admin',
      password_hash: record.passwordHash,
      salt: record.salt,
      created_at: new Date().toISOString(),
      last_login_at: null
    }]);
    console.log(`Utilisateur admin créé : ${DEFAULT_USER}`);
  } else {
    // Migration : ajouter role manquant aux anciens enregistrements
    let changed = false;
    const migrated = existingUsers.map((u, idx) => {
      if (!u.role) {
        changed = true;
        return { ...u, role: idx === 0 ? 'admin' : 'user' };
      }
      return u;
    });
    if (changed) writeUsers(migrated);
  }
}

function findUserByUsername(username) {
  return readUsers().find(u => u.username === username) || null;
}

function findUserById(id) {
  return readUsers().find(u => u.id === Number(id)) || null;
}

function touchLastLogin(userId) {
  const users = readUsers();
  writeUsers(users.map(u =>
    u.id === Number(userId) ? { ...u, last_login_at: new Date().toISOString() } : u
  ));
}

// ── Sessions ──────────────────────────────────────────────────────────────────

function issueSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    userId: user.id,
    username: user.username,
    role: user.role || 'user',
    expiresAt: Date.now() + SESSION_TTL_MS
  });
  return token;
}

function getSessionFromRequest(req) {
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const token = match[1];
  const session = sessions.get(token);
  if (!session) return null;

  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }

  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return { token, ...session };
}

function requireAuth(req, res, next) {
  const session = getSessionFromRequest(req);
  if (!session) return res.status(401).json({ error: 'Authentification requise.' });
  req.session = session;
  next();
}

function requireAdmin(req, res, next) {
  const session = getSessionFromRequest(req);
  if (!session) return res.status(401).json({ error: 'Authentification requise.' });
  if (session.role !== 'admin') return res.status(403).json({ error: 'Accès réservé aux administrateurs.' });
  req.session = session;
  next();
}

ensureAuthDatabase();
app.use(express.static(STATIC_ROOT));

// ── Auth ──────────────────────────────────────────────────────────────────────

app.post('/auth/login', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (!username || !password) {
    return res.status(400).json({ error: 'Utilisateur et mot de passe requis.' });
  }

  const user = findUserByUsername(username);
  if (!user) return res.status(401).json({ error: 'Utilisateur ou mot de passe invalide.' });

  const computedHash = hashPassword(password, user.salt);
  const expected = Buffer.from(user.password_hash, 'hex');
  const received = Buffer.from(computedHash, 'hex');
  const isValid = expected.length === received.length && crypto.timingSafeEqual(expected, received);

  if (!isValid) return res.status(401).json({ error: 'Utilisateur ou mot de passe invalide.' });

  touchLastLogin(user.id);
  const token = issueSession(user);
  return res.json({ token, user: { id: user.id, username: user.username, role: user.role || 'user' } });
});

app.get('/auth/session', (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session) return res.status(401).json({ authenticated: false });
  return res.json({
    authenticated: true,
    user: { id: session.userId, username: session.username, role: session.role }
  });
});

app.post('/auth/logout', (req, res) => {
  const session = getSessionFromRequest(req);
  if (session) sessions.delete(session.token);
  return res.json({ success: true });
});

// Inscription ouverte (rôle user uniquement)
app.post('/auth/register', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (!username || !password) {
    return res.status(400).json({ error: 'Identifiant et mot de passe requis.' });
  }
  if (!/^[a-zA-Z0-9_.\-]{3,32}$/.test(username)) {
    return res.status(400).json({ error: 'Identifiant invalide (3-32 caractères alphanumérique).' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });
  }
  if (findUserByUsername(username)) {
    return res.status(409).json({ error: 'Ce nom d\'utilisateur est déjà pris.' });
  }

  const record = createPasswordRecord(password);
  const newUser = {
    id: nextUserId(),
    username,
    role: 'user',
    password_hash: record.passwordHash,
    salt: record.salt,
    created_at: new Date().toISOString(),
    last_login_at: null
  };
  const users = readUsers();
  users.push(newUser);
  writeUsers(users);

  return res.status(201).json({ success: true, username });
});

// ── Admin : gestion des utilisateurs ─────────────────────────────────────────

// Lister tous les utilisateurs
app.get('/admin/users', requireAdmin, (req, res) => {
  const users = readUsers().map(({ password_hash, salt, ...safe }) => safe);
  return res.json(users);
});

// Créer un utilisateur
app.post('/admin/users', requireAdmin, (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const role = req.body?.role === 'admin' ? 'admin' : 'user';

  if (!username || !password) {
    return res.status(400).json({ error: 'Nom d\'utilisateur et mot de passe requis.' });
  }
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
    return res.status(400).json({ error: 'Nom d\'utilisateur invalide (3-32 caractères alphanumérique).' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });
  }

  if (findUserByUsername(username)) {
    return res.status(409).json({ error: 'Ce nom d\'utilisateur est déjà pris.' });
  }

  const record = createPasswordRecord(password);
  const newUser = {
    id: nextUserId(),
    username,
    role,
    password_hash: record.passwordHash,
    salt: record.salt,
    created_at: new Date().toISOString(),
    last_login_at: null
  };

  const users = readUsers();
  users.push(newUser);
  writeUsers(users);

  const { password_hash, salt, ...safe } = newUser;
  return res.status(201).json(safe);
});

// Modifier le rôle d'un utilisateur
app.patch('/admin/users/:id/role', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const role = req.body?.role === 'admin' ? 'admin' : 'user';

  if (id === req.session.userId && role !== 'admin') {
    return res.status(400).json({ error: 'Vous ne pouvez pas retirer votre propre rôle admin.' });
  }

  const users = readUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Utilisateur introuvable.' });

  users[idx] = { ...users[idx], role };
  writeUsers(users);

  // Mettre à jour les sessions actives
  for (const [token, session] of sessions.entries()) {
    if (session.userId === id) session.role = role;
  }

  const { password_hash, salt, ...safe } = users[idx];
  return res.json(safe);
});

// Réinitialiser le mot de passe
app.post('/admin/users/:id/reset-password', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const newPassword = String(req.body?.password || '');

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });
  }

  const users = readUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Utilisateur introuvable.' });

  const record = createPasswordRecord(newPassword);
  users[idx] = { ...users[idx], password_hash: record.passwordHash, salt: record.salt };
  writeUsers(users);

  return res.json({ success: true });
});

// Supprimer un utilisateur
app.delete('/admin/users/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);

  if (id === req.session.userId) {
    return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte.' });
  }

  const users = readUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Utilisateur introuvable.' });

  users.splice(idx, 1);
  writeUsers(users);

  // Invalider toutes les sessions de cet utilisateur
  for (const [token, session] of sessions.entries()) {
    if (session.userId === id) sessions.delete(token);
  }

  return res.json({ success: true });
});

// ── Lecture de logs ───────────────────────────────────────────────────────────

app.get('/read-log', (req, res) => {
  res.send('Endpoint /read-log attend une requête POST JSON. Exemple: {"path":"/var/log/app.log"}');
});

app.post('/read-log', requireAuth, async (req, res) => {
  try {
    const { path: logPath, host, port, user, keyPath, keyContent, sudo } = req.body;

    if (!logPath) return res.status(400).send('Le champ path est requis.');

    if (!host) {
      const content = await readFile(logPath, 'utf8');
      return res.send(content);
    }

    if (!user || (!keyPath && !keyContent)) {
      return res.status(400).send('host distant fourni mais user ou clé SSH manquant.');
    }

    let privateKey;
    if (keyContent) {
      privateKey = keyContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    } else {
      if (!fs.existsSync(keyPath)) {
        return res.status(400).send('La clé SSH locale est introuvable : ' + keyPath);
      }
      privateKey = fs.readFileSync(keyPath, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    }

    const conn = new Client();

    conn.on('ready', () => {
      const command = sudo ? `sudo cat ${logPath}` : `cat ${logPath}`;
      conn.exec(command, (err, stream) => {
        if (err) { conn.end(); return res.status(500).send('Erreur SSH : ' + err.message); }

        let output = '';
        let stderr = '';

        stream.on('close', (code) => {
          conn.end();
          if (code !== 0) return res.status(500).send(stderr || `Commande fermée avec code ${code}`);
          res.send(output);
        }).on('data', (data) => {
          output += data.toString();
        }).stderr.on('data', (data) => {
          stderr += data.toString();
        });
      });
    }).on('error', (err) => {
      res.status(500).send('Erreur de connexion SSH : ' + err.message);
    }).connect({
      host,
      port: Number(port || 22),
      username: user,
      privateKey,
      readyTimeout: 30000,
      keepaliveInterval: 5000
    });
  } catch (err) {
    res.status(500).send('Erreur serveur : ' + err.message);
  }
});

// ── Live tail (Server-Sent Events) ───────────────────────────────────────────

app.get('/live-tail', (req, res) => {
  // Auth via query param token (SSE can't set headers)
  const token = req.query.token || '';
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    return res.status(401).send('Non autorisé');
  }

  const logPath = req.query.path;
  if (!logPath) return res.status(400).send('Paramètre path requis');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const host       = req.query.host;
  const port       = Number(req.query.port || 22);
  const user       = req.query.user;
  const keyPath    = req.query.keyPath;
  const keyContent = req.query.keyContent;
  const sudo       = req.query.sudo === '1';

  if (host) {
    // SSH tail -f
    const rawKey = keyContent || (keyPath && fs.existsSync(keyPath) ? fs.readFileSync(keyPath, 'utf8') : null);
    const privateKey = rawKey ? rawKey.replace(/\r\n/g, '\n').replace(/\r/g, '\n') : null;
    if (!user || !privateKey) {
      send('error', { message: 'Clé SSH ou utilisateur manquant' });
      return res.end();
    }
    const conn = new Client();
    conn.on('ready', () => {
      send('connected', { path: logPath, mode: 'ssh' });
      const cmd = (sudo ? 'sudo ' : '') + `tail -f -n 0 ${logPath}`;
      conn.exec(cmd, (err, stream) => {
        if (err) { send('error', { message: err.message }); conn.end(); return; }
        stream.on('data', (chunk) => {
          chunk.toString().split(/\r?\n/).forEach(line => {
            if (line.trim()) send('line', { line });
          });
        });
        stream.on('close', () => conn.end());
      });
    }).on('error', (err) => {
      send('error', { message: err.message });
      res.end();
    }).connect({ host, port, username: user, privateKey, readyTimeout: 30000, keepaliveInterval: 5000 });

    req.on('close', () => conn.end());
  } else {
    // Local file watch
    if (!fs.existsSync(logPath)) {
      send('error', { message: 'Fichier introuvable : ' + logPath });
      return res.end();
    }
    send('connected', { path: logPath, mode: 'local' });
    let fileSize = fs.statSync(logPath).size;

    const watcher = fs.watchFile(logPath, { interval: 500 }, (curr) => {
      if (curr.size <= fileSize) return;
      const stream = fs.createReadStream(logPath, { start: fileSize, encoding: 'utf8' });
      let buf = '';
      stream.on('data', d => { buf += d; });
      stream.on('end', () => {
        fileSize = curr.size;
        buf.split(/\r?\n/).forEach(line => {
          if (line.trim()) send('line', { line });
        });
      });
    });

    const keepAlive = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => {
      fs.unwatchFile(logPath, watcher);
      clearInterval(keepAlive);
    });
  }
});

// ── Annotations ───────────────────────────────────────────────────────────────

const ANNOTATIONS_FILE = path.join(DB_DIR, 'annotations.json');

function readAnnotations() {
  if (!fs.existsSync(ANNOTATIONS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(ANNOTATIONS_FILE, 'utf8')); } catch { return []; }
}

function writeAnnotations(list) {
  fs.writeFileSync(ANNOTATIONS_FILE, JSON.stringify(list, null, 2));
}

app.get('/api/annotations', requireAuth, (req, res) => {
  const { hash } = req.query;
  if (!hash) return res.status(400).json({ error: 'hash requis' });
  const list = readAnnotations().filter(a => a.hash === hash);
  res.json(list);
});

app.post('/api/annotations', requireAuth, (req, res) => {
  const { hash, entryIdx, text, username } = req.body;
  if (!hash || entryIdx == null || !text) return res.status(400).json({ error: 'hash, entryIdx et text requis' });

  const list = readAnnotations();
  const existing = list.findIndex(a => a.hash === hash && a.entryIdx === Number(entryIdx));
  const ann = {
    id: existing >= 0 ? list[existing].id : Date.now(),
    hash, entryIdx: Number(entryIdx), text: String(text).slice(0, 1000),
    username: String(username || req.session.username || 'anonymous').slice(0, 64),
    createdAt: existing >= 0 ? list[existing].createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (existing >= 0) list[existing] = ann;
  else list.push(ann);
  writeAnnotations(list);
  res.json(ann);
});

app.delete('/api/annotations/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const list = readAnnotations().filter(a => a.id !== id);
  writeAnnotations(list);
  res.json({ success: true });
});

// ── Ingestion push ────────────────────────────────────────────────────────────

const INGEST_DIR = path.join(DB_DIR, 'ingest');

app.post('/ingest', requireAuth, (req, res) => {
  try {
    fs.mkdirSync(INGEST_DIR, { recursive: true });
    const { lines, source } = req.body;
    if (!lines || !Array.isArray(lines)) {
      return res.status(400).json({ error: '"lines" doit être un tableau de chaînes.' });
    }
    const date = new Date().toISOString().slice(0, 10);
    const file = path.join(INGEST_DIR, `${date}.log`);
    const content = lines.map(l => String(l)).join('\n') + '\n';
    fs.appendFileSync(file, content, 'utf8');
    console.log(`[ingest] ${lines.length} ligne(s) depuis ${source || 'inconnu'} → ${file}`);
    res.json({ ingested: lines.length, file });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Analyse IA ───────────────────────────────────────────────────────────────

app.post('/ai/analyze', requireAuth, async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'Clé API Anthropic non configurée (ANTHROPIC_API_KEY manquant).' });
  }

  const { stats, samples, filename } = req.body;
  if (!stats) return res.status(400).json({ error: 'Données de logs requises (stats).' });

  const client = new Anthropic({ apiKey });

  const systemPrompt = `Tu es un expert senior en analyse de logs de systèmes informatiques, spécialisé dans les applications Odoo ERP et les infrastructures Linux.
Tu analyses des fichiers de logs et génères des rapports structurés, clairs et immédiatement exploitables pour les équipes techniques et les responsables IT.

RÈGLE ABSOLUE : Tu dois TOUJOURS répondre avec un objet JSON valide et uniquement du JSON, sans texte avant ni après, sans bloc markdown.

Structure JSON attendue :
{
  "resume_executif": "string (2-3 phrases, état global du système, ton professionnel)",
  "score_sante": number (0 à 100, 100 = parfait, 0 = critique),
  "incidents_critiques": [
    {
      "titre": "string (court, impactant)",
      "description": "string (explication technique claire)",
      "impact": "CRITIQUE|MAJEUR|MINEUR",
      "timestamp": "string ou null",
      "recommandation": "string (action concrète à effectuer)"
    }
  ],
  "analyse_performances": {
    "observations": ["string (constat observé)"],
    "goulots": ["string (bottleneck identifié)"],
    "workers": "string (état des workers/processus)"
  },
  "tendances": ["string (tendance ou pattern observé dans les logs)"],
  "recommandations": [
    {
      "priorite": "HAUTE|MOYENNE|BASSE",
      "action": "string (action à effectuer, verbe d'action)",
      "detail": "string (explication et contexte)"
    }
  ],
  "chronologie": [
    {
      "moment": "string (timestamp ou période)",
      "evenement": "string (description de l'événement)",
      "niveau": "CRITICAL|ERROR|WARNING|INFO"
    }
  ]
}`;

  const userContent = `Analyse le fichier de logs suivant : "${filename || 'inconnu'}"

=== STATISTIQUES GLOBALES ===
${JSON.stringify(stats, null, 2)}

=== ÉCHANTILLONS DE LOGS ===
${samples || 'Aucun échantillon fourni'}

Génère le rapport JSON complet. Sois précis, pertinent et oriente chaque recommandation vers des actions concrètes.`;

  try {
    const message = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userContent }]
    });

    const textBlock = message.content.find(b => b.type === 'text');
    if (!textBlock) return res.status(500).json({ error: 'Réponse IA vide.' });

    let report;
    const rawText = textBlock.text.trim();
    console.log('[AI] Réponse brute (200 premiers chars):', rawText.slice(0, 200));

    // 1. Direct parse
    try { report = JSON.parse(rawText); } catch {}

    // 2. Extract from markdown code fence ```json ... ```
    if (!report) {
      const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (fenceMatch) { try { report = JSON.parse(fenceMatch[1].trim()); } catch {} }
    }

    // 3. Extract outermost JSON object { ... }
    if (!report) {
      const start = rawText.indexOf('{');
      const end = rawText.lastIndexOf('}');
      if (start !== -1 && end > start) {
        try { report = JSON.parse(rawText.slice(start, end + 1)); } catch {}
      }
    }

    if (!report) {
      console.error('[AI] Échec parsing. Réponse brute complète:', rawText);
      return res.status(500).json({ error: 'Impossible de parser la réponse IA.', raw: rawText.slice(0, 1000) });
    }

    res.json({ report, usage: message.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, '0.0.0.0', () => {
  console.log('Service LogScope démarré sur http://localhost:3000');
  console.log(`Connexion par défaut : ${DEFAULT_USER} / ${DEFAULT_PASS}`);
});
