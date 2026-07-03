# LogScope

Analyseur de logs multi-formats avec interface web. Chargez un fichier de log, il est parsé et analysé directement dans le navigateur. Filtrez, cherchez, comparez deux fichiers, visualisez la timeline des événements, suivez un fichier en direct et générez un rapport structuré (statistique ou via Claude Opus).

Le projet inclut un serveur Node.js/Express pour l'authentification, la lecture de fichiers distants (SSH), le live tail, les annotations persistantes et l'analyse IA.

## Pourquoi ce projet

Sur une infra Odoo/PostgreSQL classique, diagnostiquer un incident veut souvent dire : se connecter en SSH sur 2-3 serveurs, `grep`/`less` dans des fichiers de plusieurs centaines de Mo, corréler manuellement des timestamps entre l'appli, la base et le système. LogScope regroupe ça dans une seule interface : détection automatique du format, filtres combinables, vue comparative entre deux fichiers, et une synthèse (statistique ou IA) pour aller droit à l'essentiel sans tout relire ligne par ligne.

---

## Prérequis

- Node.js >= 18
- npm >= 9
- (Production) Un VPS Linux avec Nginx, PM2 et Certbot — **ou** Docker

---

## Démarrage local

```bash
git clone https://github.com/Anasoufkir/smartlog.git
cd smartlog
npm install
npm start
```

Ouvrez ensuite `http://localhost:3000`. Au premier démarrage, un compte admin est créé automatiquement (voir ci-dessous).

### Configuration par variables d'environnement

Copiez `.env.example` vers `.env` (fichier jamais commité) et ajustez les valeurs :

```bash
cp .env.example .env
```

```
ANTHROPIC_API_KEY=sk-ant-...
LOGSCOPE_ADMIN_USER=votre_identifiant
LOGSCOPE_ADMIN_PASS=votre_mot_de_passe
```

Au premier démarrage, si `data/users.json` n'existe pas encore, le serveur crée un compte admin avec les valeurs définies dans `.env`. Si `.env` est absent, des valeurs par défaut faibles sont utilisées (`admin` / `logscope123`) — **changez-les immédiatement** via le panel admin avant toute exposition réseau. Voir [SECURITY.md](SECURITY.md).

---

## Déploiement en production

### Option A — Docker

```bash
cp .env.example .env   # renseignez LOGSCOPE_ADMIN_PASS au minimum
docker compose up -d --build
```

Le `Dockerfile`/`docker-compose.yml` tournent sur une image `node:22-alpine`, exposent le port 3000 et persistent `data/` (utilisateurs, sessions, annotations) dans un volume nommé. Mettez Nginx + Certbot devant si vous exposez l'app publiquement (voir Option B, étapes 4-5).

> Ces fichiers n'ont pas pu être testés dans l'environnement où cet audit a été réalisé (pas de daemon Docker disponible) — vérifiez `docker compose up --build` avant un déploiement critique.

### Option B — VPS (PM2 + Nginx)

#### 1. Préparer le serveur

```bash
# Installer Node.js via nvm (recommandé)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 22 && nvm use 22

# Installer PM2 globalement
npm install -g pm2
```

#### 2. Cloner et configurer l'application

```bash
git clone https://github.com/Anasoufkir/smartlog.git /opt/logscope
cd /opt/logscope
npm install --omit=dev
cp .env.example .env
nano .env
```

#### 3. Démarrer avec PM2

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

#### 4. Configurer Nginx

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

#### 5. Activer HTTPS avec Let's Encrypt

```bash
apt install certbot python3-certbot-nginx -y
certbot --nginx -d votre-domaine.com
```

Certbot configure le renouvellement automatique. Vérifiez avec :

```bash
certbot renew --dry-run
```

#### 6. Mettre à jour l'application

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

**JSON** (Docker, Kubernetes, Winston, Bunyan, Pino, ou tout JSON avec un champ timestamp/message)
```
{"level":"error","time":"2026-04-22T10:00:00.123Z","msg":"connection refused"}
```

La normalisation des niveaux PostgreSQL (`PANIC`, `FATAL` → CRITICAL ; `NOTICE`, `LOG` → INFO, etc.), l'inférence de niveau syslog par mots-clés et le mapping des niveaux numériques Pino/Bunyan (10-60) sont gérés automatiquement.

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
- Détection d'anomalies : repère les pics d'erreurs statistiquement anormaux (moyenne + 2 écarts-types) sur des fenêtres de temps glissantes
- Presets de filtres : sauvegarde de combinaisons de filtres nommées (stockage navigateur)
- Live tail : suivi en temps réel d'un fichier local ou distant (SSH) via Server-Sent Events — réservé aux administrateurs
- Règles d'alerte : seuils configurables (« plus de N erreurs de niveau X en Y minutes ») évalués au chargement et en live tail, stockés dans le navigateur

**Rapports**
- Rapport statistique instantané (100% local, sans appel serveur) : distribution des niveaux, top erreurs, durée couverte
- Rapport IA par Claude Opus sur la plage filtrée active : résumé exécutif, score de santé, incidents critiques, performances, tendances, recommandations, chronologie — nécessite une clé API Anthropic
- Export PDF pour les deux types de rapport (impression navigateur)
- L'analyse IA porte uniquement sur les entrées correspondant aux filtres actifs (date, niveau, PID...)

**Collaboration**
- Authentification avec sessions persistantes (survivent aux redémarrages serveur)
- Panel admin : créer, modifier le rôle, réinitialiser le mot de passe, supprimer des utilisateurs
- Annotations persistantes sur les entrées de log
- Lecture de fichiers distants via SSH — réservée aux administrateurs (voir [SECURITY.md](SECURITY.md))
- Ingestion push (`POST /ingest`) : endpoint API pour qu'un service externe pousse des lignes de log ; pas d'interface associée aujourd'hui (voir Roadmap)

**Export**
- CSV et JSON des résultats filtrés
- PDF des deux types de rapport

---

## API du serveur

Le serveur Express écoute sur le port **3000**. Toutes les routes nécessitent un header `Authorization: Bearer <token>` sauf `/auth/login` et `/auth/register`. `/read-log` et `/live-tail` nécessitent en plus un compte **admin**.

### Authentification

| Méthode | Route | Description |
|---|---|---|
| POST | `/auth/login` | `{ username, password }` → `{ token, user }` |
| GET | `/auth/session` | Vérifier la session courante |
| POST | `/auth/logout` | Invalider la session |
| POST | `/auth/register` | Inscription ouverte (rôle `user`) |

### Administration

| Méthode | Route | Description |
|---|---|---|
| GET | `/admin/users` | Lister tous les utilisateurs |
| POST | `/admin/users` | Créer `{ username, password, role }` |
| PATCH | `/admin/users/:id/role` | Modifier le rôle `{ role: "admin"\|"user" }` |
| POST | `/admin/users/:id/reset-password` | Réinitialiser le mot de passe `{ password }` |
| DELETE | `/admin/users/:id` | Supprimer un utilisateur |

### Logs et analyse

| Méthode | Route | Description |
|---|---|---|
| POST | `/read-log` | *(admin)* Lire un fichier local ou distant via SSH |
| GET | `/live-tail` | *(admin, SSE)* Suivre un fichier local ou distant en temps réel |
| POST | `/ai/analyze` | Analyser un échantillon de logs avec Claude Opus |
| POST | `/ingest` | Pousser des lignes de log (`{ lines: string[], source }`) vers un fichier journalier côté serveur |
| GET | `/api/annotations` | Lister les annotations d'un fichier `?hash=` |
| POST | `/api/annotations` | Créer ou mettre à jour une annotation |
| DELETE | `/api/annotations/:id` | Supprimer une annotation |

Corps pour lecture SSH (`/read-log`, `/live-tail` en query params) :
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
├── local-log-service.js        # Serveur Express (auth, SSH, IA, annotations, ingest)
├── Dockerfile / docker-compose.yml
├── eslint.config.js
├── package.json
├── .env.example                 # Modèle de configuration (copier vers .env)
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
│   │   ├── json.js
│   │   └── detector.js
│   ├── filters.js
│   ├── renderer.js
│   ├── workers.js
│   ├── timeline.js
│   ├── anomaly.js
│   ├── alerts.js
│   ├── presets.js
│   ├── livetail.js
│   ├── export.js
│   ├── ui.js
│   ├── admin.js
│   ├── annotations.js
│   ├── ai-report.js            # Rapport IA + export PDF
│   ├── report.js               # Rapport statistique (sans IA) + export PDF
│   ├── compare.js
│   └── app.js
├── samples/
│   ├── sample-odoo.log
│   ├── sample-postgres.log
│   └── sample-syslog.log
└── data/                       # Créé automatiquement
    ├── users.json
    ├── sessions.json
    ├── annotations.json
    └── ingest/
```

---

## Architecture

Voir [ARCHITECTURE.md](ARCHITECTURE.md) pour le détail du flux de parsing, du modèle de session et des choix de stockage.

Résumé : LogScope utilise un namespace global `window.LogScope`. Chaque fichier JS ajoute ses fonctions à cet objet sans bundler ni build step — l'ordre de chargement des scripts est défini dans `index.html`. Le serveur Express stocke ses données (utilisateurs, sessions, annotations) dans des fichiers JSON plats sous `data/`, sans base de données.

---

## Ajouter un nouveau format

1. Créer `js/formats/monformat.js` avec `LogScope.parseMonFormat(text)` retournant la structure documentée dans [ARCHITECTURE.md](ARCHITECTURE.md)
2. Ajouter la regex et l'identifiant dans `js/constants.js`
3. Ajouter une branche dans `js/formats/detector.js`
4. Ajouter un `case` dans `js/parser.js`
5. Ajouter une `<option>` dans le `<select id="formatSelect">` de `index.html`

---

## Développement

```bash
npm run lint    # ESLint sur js/ et local-log-service.js
```

Il n'existe pas encore de suite de tests automatisés — voir Roadmap.

---

## Limites connues

- **Taille de fichier** : tout est chargé en mémoire côté navigateur ; au-delà de 500 Mo le navigateur peut ralentir
- **Syslog sans année** : LogScope suppose l'année courante avec détection de rollover
- **Inférence de niveau syslog** : basée sur des mots-clés anglais
- **PostgreSQL** : les `log_line_prefix` non standard peuvent ne pas être reconnus
- **Rapport IA** : nécessite une clé API Anthropic valide dans `.env`
- **Stockage** : `data/*.json` est un stockage fichier plat, pas une base de données — adapté à une petite équipe sur une seule instance, pas conçu pour du multi-instance ou une forte volumétrie d'utilisateurs

---

## Roadmap (honnête)

Ce qui n'est **pas** fait aujourd'hui, par opposition à ce qui est présenté ci-dessus comme fonctionnel :

- **Aucun test automatisé** (`npm test` est un stub). Priorité si le projet doit grandir : tests unitaires sur les parseurs de format (`js/formats/*.js`) et sur les routes d'auth du serveur.
- **`/ingest` n'a pas d'interface** : l'endpoint existe côté serveur mais rien dans l'UI ne l'appelle ni n'affiche son contenu. Utilisable aujourd'hui uniquement via un appel API direct.
- **Inscription ouverte par défaut** : `/auth/register` permet à n'importe qui d'obtenir un compte `user`. C'est un choix assumé pour un usage interne/de confiance, mais à désactiver (ou protéger derrière un reverse-proxy) avant toute exposition publique — voir [SECURITY.md](SECURITY.md).
- **Docker non testé en environnement CI** : le `Dockerfile`/`docker-compose.yml` suivent les pratiques standard pour une image Node mais n'ont pas pu être validés par un build réel dans l'environnement où cette documentation a été écrite.
- **Pas de rotation/purge des sessions ou annotations** : `data/sessions.json` et `data/annotations.json` grossissent indéfiniment ; pas de tâche de nettoyage.

---

## Licence

MIT
