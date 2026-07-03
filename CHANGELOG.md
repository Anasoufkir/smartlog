# Changelog

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/). Les entrées antérieures à cet audit sont reconstituées à partir de l'historique Git réel (pas de tags de version dans le dépôt avant ce jour).

## [1.1.0] — 2026-07-03 — Audit d'exactitude et de sécurité

### Fixed
- **Sécurité (élévation de privilèges)** : `/read-log` et `/live-tail` exigent désormais un rôle `admin` — un compte auto-inscrit (`user`) pouvait auparavant lire n'importe quel fichier local du serveur.
- **Sécurité (injection de commande)** : le chemin de fichier transmis aux commandes SSH `cat`/`tail -f` est désormais échappé (voir `shellQuote` dans `local-log-service.js`).
- **Live tail cassé en production** : `js/livetail.js` appelait `http://localhost:3000` en dur au lieu d'une URL relative, contrairement au reste de l'app — la fonctionnalité échouait derrière le reverse-proxy Nginx documenté dans le guide de déploiement.
- `package.json` annonçait la licence `ISC` alors que `LICENSE` et le README indiquent MIT.
- Vulnérabilité modérée `qs` (GHSA-q8mj-m7cp-5q26) corrigée via `npm audit fix`.
- Nettoyage de code mort trouvé en configurant et en faisant passer ESLint pour la première fois sur le projet (variables et fonction jamais utilisées, échappements de regex inutiles).

### Added
- `eslint.config.js` + script `npm run lint` — aucun outil de lint n'existait auparavant.
- `Dockerfile`, `docker-compose.yml`, `.dockerignore` pour un déploiement conteneurisé alternatif au guide PM2/Nginx existant.
- `ARCHITECTURE.md`, `SECURITY.md`, `.env.example`.
- Documentation des fonctionnalités livrées mais jamais décrites dans le README : format JSON (Docker/K8s/Winston/Bunyan/Pino), live tail, règles d'alerte, détection d'anomalies, presets de filtres, rapport statistique non-IA, endpoint `/ingest`.
- Section Roadmap honnête dans le README (absence de tests automatisés, inscription ouverte par défaut, etc.).

## [1.0.0] — Fonctionnalités livrées avant cet audit

Reconstitué à partir de l'historique Git (22 commits, non tagués individuellement) :

### Added
- Authentification (sessions persistées sur disque, panel admin, gestion des rôles) et parsing multi-format (Odoo, PostgreSQL, syslog, JSON) avec détection automatique.
- Lecture de fichiers distants via SSH, avec sélecteur de fichier pour la clé privée et persistance de son contenu en session.
- Rapport IA (Claude Opus) : score de santé, incidents, recommandations, chronologie, export PDF.
- Neuf fonctionnalités ajoutées en un lot : logs JSON, recherche par regex, presets de filtres, rapport statistique, live tail, annotations persistantes, règles d'alerte, endpoint d'ingestion, détection d'anomalies.
- Vue comparative entre deux fichiers de logs, colonne timestamp triable, export CSV/JSON.

### Fixed
- Sessions perdues au redémarrage serveur (passage à un stockage persistant + token en `localStorage`).
- URLs API en dur (`localhost:3000`) remplacées par des URLs relatives sur la majorité des modules pour permettre un déploiement derrière un reverse-proxy (`livetail.js` avait été manqué — voir Unreleased ci-dessus).
- Parsing JSON de la réponse IA fiabilisé (extraction en cascade + affichage de la réponse brute en cas d'échec).
