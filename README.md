# LogScope

Analyseur de logs multi-formats avec interface web. Chargez un fichier `.log`, il est parsé et analysé dans le navigateur. Filtrez, cherchez, comparez, visualisez la timeline des événements et générez un rapport IA structuré via Claude Opus.

Le projet inclut un serveur Node.js/Express pour l'authentification, la lecture de fichiers distants (SSH), les annotations persistantes et l'analyse IA.

---

## Prérequis

- Node.js >= 18
- npm >= 9
- (Production) Un VPS Linux avec Nginx, PM2 et Certbot

---

## Démarrage local

```bash
git clone https://github.com/Anasoufkir/smartlog.git
cd smartlog
npm install
npm start
```

Ouvrez ensuite `http://localhost:3000`.

### Configuration par variables d'environnement

Créez un fichier `.env` à la racine du projet (jamais commité) :

```
ANTHROPIC_API_KEY=sk-ant-...
LOGSCOPE_ADMIN_USER=votre_identifiant
LOGSCOPE_ADMIN_PASS=votre_mot_de_passe
```

Au premier démarrage, si `data/users.json` n'existe pas encore, le serveur crée un compte admin avec les valeurs définies dans `.env`. Si `.env` est absent, des valeurs par défaut sont utilisées — changez-les immédiatement via le panel admin.

---

## Déploiement en production

### 1. Préparer le serveur

```bash
# Installer Node.js via nvm (recommandé)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 22 && nvm use 22

# Installer PM2 globalement
npm install -g pm2
```

### 2. Cloner et configurer l'application

```bash
git clone https://github.com/Anasoufkir/smartlog.git /opt/logscope
cd /opt/logscope
npm install --omit=dev
```

Créez le fichier d'environnement :

```bash
nano /opt/logscope/.env
```

Contenu minimal :

```
ANTHROPIC_API_KEY=sk-ant-...
LOGSCOPE_ADMIN_USER=votre_identifiant
LOGSCOPE_ADMIN_PASS=votre_mot_de_passe_securise
```

### 3. Démarrer avec PM2

```bash
cd /opt/logscope
pm2 start local-log-service.js --name logscope
pm2 save
pm2 startup   # Suivez les instructions affichées pour activer le démarrage automatique
```

Vérifier que l'application tourne :

```bash
pm2 status
pm2 logs logscope --lines 20
```

### 4. Configurer Nginx

```bash
apt install nginx -y
nano /etc/nginx/sites-available/logscope
```

Contenu du fichier :

```nginx
server {
    listen 80;
    server_name votre-domaine.com;

    client_max_body_size 20M;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        "upgrade";
        proxy_read_timeout 180s;
        proxy_send_timeout 180s;
    }
}
```

Activer le site :

```bash
ln -s /etc/nginx/sites-available/logscope /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### 5. Activer HTTPS avec Let's Encrypt

```bash
apt install certbot python3-certbot-nginx -y
certbot --nginx -d votre-domaine.com
```

Certbot configure le renouvellement automatique. Vérifiez avec :

```bash
certbot renew --dry-run
```

### 6. Mettre à jour l'application

```bash
cd /opt/logscope
git pull
npm install --omit=dev
pm2 restart logscope
```

---

## Formats de logs supportés

LogScope détecte automatiquement le format parmi :

**Odoo**
```
2026-04-22 12:00:03,099 643418 INFO BASE odoo.service.server: Worker (643418) exiting.
```

**PostgreSQL** (log_line_prefix `%m [%p] %q%u@%d`)
```
2026-04-22 10:00:00.123 UTC [2401] postgres@production LOG:  connection authorized
```

**Syslog / Ubuntu**
```
Apr 22 08:00:26 server systemd[1]: Started Daily apt upgrade activities.
```

La normalisation des niveaux PostgreSQL (`PANIC`, `FATAL` → CRITICAL ; `NOTICE`, `LOG` → INFO, etc.) et l'inférence de niveau syslog par mots-clés sont gérées automatiquement.

---

## Fonctionnalités

**Analyse**
- Chargement par glisser-déposer ou sélection de fichier
- Détection automatique du format avec override manuel
- Filtrage par date, niveau, PID, base de données, source, texte libre ou regex
- Colonne timestamp triable (croissant / décroissant)
- Analyse des workers / processus (durée de vie, statut, erreurs)
- Timeline histogramme empilé
- Vue comparative entre deux fichiers de logs

**Rapport IA**
- Analyse par Claude Opus de la plage filtrée active
- Rapport structuré : résumé exécutif, score de santé, incidents critiques, performances, tendances, recommandations, chronologie
- Export PDF du rapport
- L'analyse porte uniquement sur les entrées correspondant aux filtres actifs (date, niveau, PID...)

**Collaboration**
- Authentification avec sessions persistantes (survie aux redémarrages serveur)
- Panel admin : créer, modifier le rôle, réinitialiser le mot de passe, supprimer des utilisateurs
- Annotations persistantes sur les entrées de log
- Lecture de fichiers distants via SSH

**Export**
- CSV et JSON des résultats filtrés
- PDF du rapport IA

---

## API du serveur

Le serveur Express écoute sur le port **3000**. Toutes les routes nécessitent un header `Authorization: Bearer <token>` sauf `/auth/login` et `/auth/register`.

### Authentification

| Méthode | Route | Description |
|---|---|---|
| POST | `/auth/login` | `{ username, password }` → `{ token, user }` |
| GET | `/auth/session` | Vérifier la session courante |
| POST | `/auth/logout` | Invalider la session |
| POST | `/auth/register` | Inscription (rôle user) |

### Administration

| Méthode | Route | Description |
|---|---|---|
| GET | `/admin/users` | Lister tous les utilisateurs |
| POST | `/admin/users` | Créer `{ username, password, role }` |
| PATCH | `/admin/users/:id/role` | Modifier le rôle `{ role: "admin"|"user" }` |
| POST | `/admin/users/:id/reset-password` | Réinitialiser le mot de passe `{ password }` |
| DELETE | `/admin/users/:id` | Supprimer un utilisateur |

### Logs et analyse

| Méthode | Route | Description |
|---|---|---|
| POST | `/read-log` | Lire un fichier local ou distant via SSH |
| POST | `/ai/analyze` | Analyser un échantillon de logs avec Claude Opus |
| GET | `/api/annotations` | Lister les annotations d'un fichier `?hash=` |
| POST | `/api/annotations` | Créer ou mettre à jour une annotation |
| DELETE | `/api/annotations/:id` | Supprimer une annotation |

Corps pour lecture SSH :
```json
{
  "path": "/var/log/app.log",
  "host": "192.168.1.10",
  "port": 22,
  "user": "ubuntu",
  "keyPath": "/home/user/.ssh/id_rsa"
}
```

---

## Structure du projet

```
logscope/
├── index.html                  # Point d'entrée
├── local-log-service.js        # Serveur Express (auth, SSH, IA, annotations)
├── package.json
├── .env                        # Variables d'environnement (non commité)
├── css/
│   └── styles.css
├── js/
│   ├── constants.js            # Regex, niveaux, formats
│   ├── state.js                # État global
│   ├── utils.js                # Helpers
│   ├── parser.js               # Orchestrateur de parsing
│   ├── formats/
│   │   ├── odoo.js
│   │   ├── postgres.js
│   │   ├── syslog.js
│   │   └── detector.js
│   ├── filters.js
│   ├── renderer.js
│   ├── workers.js
│   ├── timeline.js
│   ├── export.js
│   ├── ui.js
│   ├── admin.js
│   ├── annotations.js
│   ├── ai-report.js            # Rapport IA + export PDF
│   ├── compare.js
│   └── app.js
├── samples/
│   ├── sample-odoo.log
│   ├── sample-postgres.log
│   └── sample-syslog.log
└── data/                       # Créé automatiquement
    ├── users.json
    ├── sessions.json
    └── annotations.json
```

---

## Architecture

LogScope utilise un namespace global `window.LogScope`. Chaque fichier JS ajoute ses fonctions à cet objet sans bundler. L'ordre de chargement des scripts est défini dans `index.html`.

Flux de parsing :
1. `parser.js` reçoit le texte brut
2. `detector.js` échantillonne les 50 premières lignes et choisit le format dont la regex matche le plus
3. Le parseur du format choisi produit une structure normalisée
4. Tous les modules UI (renderer, workers, timeline, ai-report...) consomment cette structure indépendamment du format

Structure retournée par chaque parseur :
```javascript
{
  entries:     [{ idx, timestamp, ts, pid, level, db, logger, message, raw, format }],
  workers:     { pid: { first, last, levels, started, exited, errorCount } },
  loggers:     Set,
  dbs:         Set,
  levelCounts: { CRITICAL, ERROR, WARNING, INFO, DEBUG }
}
```

---

## Ajouter un nouveau format

1. Créer `js/formats/monformat.js` avec `LogScope.parseMonFormat(text)` retournant la structure ci-dessus
2. Ajouter la regex et l'identifiant dans `js/constants.js`
3. Ajouter une branche dans `js/formats/detector.js`
4. Ajouter un `case` dans `js/parser.js`
5. Ajouter une `<option>` dans le `<select id="formatSelect">` de `index.html`

---

## Limites connues

- **Taille de fichier** : tout est chargé en mémoire ; au-delà de 500 Mo le navigateur peut ralentir
- **Syslog sans année** : LogScope suppose l'année courante avec détection de rollover
- **Inférence de niveau syslog** : basée sur des mots-clés anglais
- **PostgreSQL** : les `log_line_prefix` non standard peuvent ne pas être reconnus
- **Rapport IA** : nécessite une clé API Anthropic valide dans `.env`

---

## Licence

MIT
