# LogScope

> Un analyseur de logs multi-formats, 100% local, dans le navigateur.

LogScope est une plateforme web HTML/CSS/JS vanilla pour explorer les fichiers de logs. Chargez un fichier `.log`, il est parsé et analysé dans votre navigateur. Vous obtenez une interface complète pour filtrer, chercher, analyser la durée de vie des workers et visualiser la timeline des événements.

Le parsing reste local côté navigateur, mais le projet inclut aussi un petit serveur Node.js pour la lecture de fichiers distants (SSH inclus) et une authentification avec une base locale persistante (`data/users.json`).

---

## Prérequis

- **Node.js** ≥ 18 (testé sur v24.12.0)
- **npm** ≥ 9 (testé sur v11.6.2)

---

## Installation et démarrage

```bash
# Cloner / décompresser le projet
cd logscope

# Installer les dépendances
npm install

# Lancer le serveur
npm start
# puis ouvrir http://localhost:3000
```

Au premier lancement, le serveur crée automatiquement `data/users.json` avec un compte admin par défaut :

| Champ | Valeur |
|---|---|
| Utilisateur | `admin` |
| Mot de passe | `logscope123` |

Vous pouvez personnaliser ces valeurs avant le démarrage :

```bash
LOGSCOPE_ADMIN_USER=monadmin LOGSCOPE_ADMIN_PASS=motdepasse npm start
```

### Mode statique (sans serveur)

L'ouverture directe de `index.html` fonctionne pour l'interface de base, mais **la connexion, la lecture de fichiers distants et l'API auth nécessitent** `npm start`.

---

## Formats de logs supportés

LogScope détecte automatiquement le format parmi :

### Odoo
Format standard des logs Odoo :
```
2026-04-22 12:00:03,099 643418 INFO MASTER_BASE_DEMO_STD_V10 odoo.service.server: Worker (643418) exiting.
```
Niveaux reconnus : `CRITICAL`, `ERROR`, `WARNING`, `INFO`, `DEBUG`.

### PostgreSQL
Format Ubuntu 22.04 (`log_line_prefix = '%m [%p] %q%u@%d '`) :
```
2026-04-22 10:00:00.123 UTC [2401] postgres@production LOG:  connection authorized
2026-04-22 10:00:01.456 UTC [2402] app_user@staging ERROR:  syntax error at or near "SELEC"
```
Normalisation des niveaux PostgreSQL :

| PostgreSQL | Normalisé |
|---|---|
| `PANIC`, `FATAL` | CRITICAL |
| `ERROR` | ERROR |
| `WARNING` | WARNING |
| `NOTICE`, `INFO`, `LOG` | INFO |
| `DEBUG1-5`, `STATEMENT`, `DETAIL`, `HINT`, `CONTEXT` | DEBUG |

### Syslog / Ubuntu 22.04
Format BSD syslog (`/var/log/syslog`, `/var/log/auth.log`, etc.) :
```
Apr 22 08:00:26 ubuntu-srv-01 systemd[1]: Started Daily apt upgrade activities.
Apr 22 08:15:42 ubuntu-srv-01 sshd[3012]: Failed password for root from 192.168.1.5
```
Le niveau est inféré par mots-clés dans le message :
- `panic`, `emergency`, `critical`, `fatal` → **CRITICAL**
- `error`, `failed`, `denied`, `refused`, `exception`, `segfault` → **ERROR**
- `warning`, `deprecated`, `slow`, `timeout` → **WARNING**
- `debug`, `trace`, `verbose` → **DEBUG**
- par défaut → **INFO**

> L'année n'est pas présente dans les lignes syslog : LogScope utilise l'année courante et détecte un éventuel rollover si le mois recule dans le fichier.

---

## Fonctionnalités

- **Authentification** — page de connexion, inscription, sessions JWT-like (TTL 24h)
- **Panel admin** — gestion des utilisateurs (créer, modifier le rôle, réinitialiser le mot de passe, supprimer)
- **Glisser-déposer** de fichiers `.log` ou `.txt`
- **Détection automatique** du format (Odoo / PostgreSQL / Syslog) avec override manuel
- **Lecture distante via SSH** — path, host, user, clé privée, option sudo
- **Recherche plein texte** dans les messages et loggers, avec surlignage
- **Filtrage par plage de dates** (précision à la seconde)
- **Filtrage par PID** (partiel ou exact)
- **Filtrage par base de données / hôte** (s'adapte au format)
- **Filtrage par niveau** (CRITICAL / ERROR / WARNING / INFO / DEBUG)
- **Analyse des workers / connexions / processus** — durée de vie, statut actif/terminé
- **Timeline** — histogramme empilé des événements dans le temps
- **Export CSV et JSON** des résultats filtrés
- **Interface sombre et soignée**
- **Raccourcis clavier** — `/` pour focus la recherche, `Esc` pour fermer le détail

---

## API du serveur

Le serveur Express écoute sur le port **3000**.

### Auth

| Méthode | Route | Description |
|---|---|---|
| `POST` | `/auth/login` | `{ username, password }` → `{ token, user }` |
| `GET` | `/auth/session` | Vérifier la session (header `Authorization: Bearer <token>`) |
| `POST` | `/auth/logout` | Invalider la session |
| `POST` | `/auth/register` | Inscription libre (rôle `user`) |

### Admin (rôle admin requis)

| Méthode | Route | Description |
|---|---|---|
| `GET` | `/admin/users` | Lister tous les utilisateurs |
| `POST` | `/admin/users` | Créer un utilisateur `{ username, password, role }` |
| `PATCH` | `/admin/users/:id/role` | Modifier le rôle `{ role: "admin"\|"user" }` |
| `POST` | `/admin/users/:id/reset-password` | Réinitialiser le mot de passe `{ password }` |
| `DELETE` | `/admin/users/:id` | Supprimer un utilisateur |

### Lecture de logs

| Méthode | Route | Description |
|---|---|---|
| `POST` | `/read-log` | Lire un fichier local ou distant via SSH (auth requise) |

Corps pour un fichier **local** :
```json
{ "path": "/var/log/app.log" }
```
Corps pour un fichier **distant via SSH** :
```json
{
  "path": "/var/log/app.log",
  "host": "192.168.1.10",
  "port": 22,
  "user": "ubuntu",
  "keyPath": "/home/user/.ssh/id_rsa",
  "sudo": false
}
```

---

## Structure du projet

```
logscope/
├── index.html              # Point d'entrée
├── local-log-service.js    # Serveur Express (auth + SSH + static)
├── package.json
├── css/
│   └── styles.css          # Styles (variables CSS + composants)
├── js/
│   ├── constants.js        # Regex, niveaux, mappings de formats
│   ├── state.js            # État global de l'application
│   ├── utils.js            # Helpers (dates, formatage, debounce)
│   ├── parser.js           # Orchestrateur (dispatch vers le bon parseur)
│   ├── formats/
│   │   ├── odoo.js         # Parseur format Odoo
│   │   ├── postgres.js     # Parseur format PostgreSQL
│   │   ├── syslog.js       # Parseur format Syslog / Ubuntu
│   │   └── detector.js     # Détection automatique du format
│   ├── filters.js          # Logique de filtrage
│   ├── renderer.js         # Rendu des stats + table de logs
│   ├── workers.js          # Rendu des cartes worker/PID
│   ├── timeline.js         # Chart canvas
│   ├── export.js           # Export CSV / JSON
│   ├── ui.js               # Modal, loader, tabs, upload
│   ├── admin.js            # Panel admin (gestion utilisateurs)
│   ├── compare.js          # Comparaison de logs
│   └── app.js              # Entry point + binding des événements
├── samples/
│   ├── sample-odoo.log     # Fichier de test format Odoo
│   ├── sample-postgres.log # Fichier de test format PostgreSQL
│   └── sample-syslog.log   # Fichier de test format Syslog
├── data/                   # Créé automatiquement — base locale des utilisateurs
│   └── users.json
└── .gitignore
```

---

## Tester avec les fichiers d'exemple

Le dossier `samples/` contient un fichier de test pour chaque format. Glissez-en un dans l'interface pour voir LogScope en action — la détection automatique choisira le bon parseur.

---

## Architecture

LogScope utilise un namespace global `LogScope` attaché à `window`. Chaque fichier JS ajoute ses fonctions à cet objet, ce qui évite les conflits tout en restant simple. L'ordre de chargement des scripts est défini dans `index.html`.

**Flux de parsing** :
1. `parser.js` reçoit le texte brut
2. Si aucun format n'est forcé, `detector.js` échantillonne les 50 premières lignes et choisit le format dont la regex matche le plus
3. Le parseur du format choisi (`formats/{odoo,postgres,syslog}.js`) produit une structure normalisée
4. Tous les modules UI (renderer, workers, timeline...) consomment cette structure de façon indépendante du format

Chaque parseur retourne le même objet :
```javascript
{
  entries: [{ idx, timestamp, ts, pid, level, db, logger, message, raw, format, ... }],
  workers: { pid -> { first, last, levels, started, exited, ... } },
  loggers: Set,
  dbs: Set,
  levelCounts: { CRITICAL, ERROR, WARNING, INFO, DEBUG }
}
```

---

## Ajouter un nouveau format

1. Créer `js/formats/monformat.js` avec `LogScope.parseMonFormat(text)` qui retourne la structure ci-dessus
2. Ajouter la regex dans `js/constants.js` et un identifiant dans `LogScope.FORMATS`
3. Ajouter une branche dans `js/formats/detector.js`
4. Ajouter un `case` dans `js/parser.js`
5. Ajouter une `<option>` dans le `<select id="formatSelect">` de `index.html`

---

## Limites connues

- **Taille de fichier** : tout est chargé en mémoire. Au-delà de ~500 Mo, le navigateur peut ralentir
- **Sessions en mémoire** : les sessions sont perdues au redémarrage du serveur (les utilisateurs doivent se reconnecter)
- **Formats postgres variants** : la regex gère les `log_line_prefix` les plus courants mais pas toutes les configurations exotiques
- **Syslog sans année** : LogScope suppose l'année courante avec rollover si un mois plus ancien apparaît
- **Détection de niveau syslog** : basée sur des mots-clés anglais

---

## Licence

MIT — voir [LICENSE](LICENSE).
