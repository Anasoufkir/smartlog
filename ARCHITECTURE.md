# Architecture

## Vue d'ensemble

LogScope est composé de deux parties qui communiquent par HTTP/SSE :

- **Frontend** : HTML/CSS/JS vanilla, aucun bundler, aucun framework. Chaque fichier sous `js/` ajoute ses fonctions à un namespace global unique `window.LogScope`. L'ordre de `<script>` dans `index.html` fait office de résolution de dépendances — un module qui utilise `LogScope.parseTimestamp` doit être chargé après `utils.js`.
- **Backend** (`local-log-service.js`) : un seul fichier Express qui sert les fichiers statiques, gère l'authentification, proxy les lectures SSH, appelle l'API Anthropic et persiste utilisateurs/sessions/annotations sur disque.

Il n'y a pas de base de données : `data/users.json`, `data/sessions.json` et `data/annotations.json` sont des fichiers JSON réécrits en entier à chaque modification (`fs.writeFileSync`). C'est un choix délibéré de simplicité pour un déploiement mono-instance ; ça ne scale pas horizontalement et n'a pas de garanties transactionnelles.

## Flux de parsing (frontend)

```
texte brut
   │
   ▼
parser.js ── detectFormat() (constants.js + formats/detector.js)
   │           échantillonne les 50 premières lignes non vides,
   │           teste chaque regex de format, choisit le meilleur score
   │           (≥ 30% de lignes matchées), JSON est testé en priorité
   │           (une ligne commençant par `{` qui parse et contient un
   │           champ timestamp/message plausible)
   ▼
formats/{odoo,postgres,syslog,json}.js
   │           parseXxx(text) → structure normalisée (voir ci-dessous)
   │           Si aucune entrée trouvée avec le format détecté, parser.js
   │           retente les autres formats avant d'abandonner.
   ▼
LogScope.state (state.js)
   │
   ▼
Modules de consommation, indépendants du format d'origine :
renderer.js, workers.js, timeline.js, filters.js, anomaly.js,
ai-report.js, report.js, compare.js, export.js
```

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

Chaque parseur existe en version synchrone (`parseXxx`, pour les petits fichiers) et asynchrone/chunkée (`parseXxxLinesAsync`, avec callback de progression) pour ne pas bloquer l'UI sur des fichiers volumineux.

## Modèle d'authentification (backend)

- Mots de passe : PBKDF2-SHA512, 120 000 itérations, sel aléatoire 16 octets par utilisateur (`hashPassword`/`createPasswordRecord`). Comparaison en temps constant (`crypto.timingSafeEqual`).
- Sessions : token aléatoire 32 octets (hex), stocké en mémoire (`Map`) et persisté sur disque toutes les 60 s + à l'arrêt propre (`SIGTERM`/`SIGINT`), pour survivre à un redémarrage du process (PM2, déploiement). TTL glissant de 7 jours, renouvelé à chaque requête authentifiée.
- Rôles : `admin` / `user`. `requireAuth` vérifie qu'une session valide existe ; `requireAdmin` vérifie en plus le rôle. Les routes de lecture de fichier serveur (`/read-log`, `/live-tail`) sont admin-only, voir [SECURITY.md](SECURITY.md) pour le raisonnement.
- Live tail (`GET /live-tail`) utilise un token en query param plutôt qu'un header, parce que l'API `EventSource` du navigateur ne permet pas de définir de headers custom.

## Live tail (SSE)

`/live-tail` ouvre soit un `fs.watchFile` (fichier local, poll 500 ms, ne lit que les octets ajoutés depuis la dernière taille connue) soit une commande SSH `tail -f` persistante. Le frontend (`livetail.js`) bufferise les lignes reçues et les flush par lots de 800 ms pour éviter un re-render à chaque ligne sur un flux à haut débit.

## Rapport IA

`ai-report.js` construit côté client des statistiques agrégées (`buildStats`) et un échantillon représentatif borné à 300 lignes (`buildSamples` : toutes les CRITICAL/ERROR jusqu'à 100, un échantillon de WARNING, un échantillon régulier du reste) — jamais le fichier complet, pour rester dans des limites de tokens raisonnables. Le serveur transmet ça à Claude Opus avec un prompt système forçant une sortie JSON stricte, puis tente trois stratégies de parsing en cascade (JSON direct, extraction d'un bloc ` ```json `, extraction du premier/dernier `{`/`}`) avant d'abandonner et de renvoyer la réponse brute pour debug.

## Pourquoi pas de framework front-end

Le projet est volontairement resté en JS vanilla + namespace global : pas de build step, un `index.html` qu'on peut ouvrir en local sans rien compiler, un déploiement qui se limite à `git pull` + redémarrage du process Node. Le compromis est l'absence de vérification de types et un couplage implicite via l'ordre de chargement des scripts — acceptable à l'échelle actuelle du projet (~20 modules), mais qui deviendrait un problème réel au-delà.
