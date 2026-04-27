const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Client } = require('ssh2');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { readFile } = require('fs/promises');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const DB_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DB_DIR, 'users.json');
const STATIC_ROOT = __dirname;
const DEFAULT_USER = process.env.LOGSCOPE_ADMIN_USER || 'admin';
const DEFAULT_PASS = process.env.LOGSCOPE_ADMIN_PASS || 'logscope123';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const sessions = new Map();

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
    const { path: logPath, host, port, user, keyPath, sudo } = req.body;

    if (!logPath) return res.status(400).send('Le champ path est requis.');

    if (!host) {
      const content = await readFile(logPath, 'utf8');
      return res.send(content);
    }

    if (!user || !keyPath) {
      return res.status(400).send('host distant fourni mais user ou keyPath manquant.');
    }

    if (!fs.existsSync(keyPath)) {
      return res.status(400).send('La clé SSH locale est introuvable : ' + keyPath);
    }

    const conn = new Client();
    const privateKey = fs.readFileSync(keyPath, 'utf8');

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
      readyTimeout: 20000
    });
  } catch (err) {
    res.status(500).send('Erreur serveur : ' + err.message);
  }
});

app.listen(3000, '0.0.0.0', () => {
  console.log('Service LogScope démarré sur http://localhost:3000');
  console.log(`Connexion par défaut : ${DEFAULT_USER} / ${DEFAULT_PASS}`);
});
