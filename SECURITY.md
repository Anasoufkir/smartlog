# Security

## Modèle de menace

LogScope est pensé pour un déploiement interne / de confiance (une équipe ops/dev qui a besoin de lire des logs serveur), pas pour une exposition publique multi-tenant. Deux conséquences directes du choix d'inscription ouverte (`POST /auth/register`, sans invitation) :

- N'importe qui atteignant l'instance peut créer un compte `user`.
- Les comptes `user` n'ont **pas** accès à `/admin/*`, `/read-log` ni `/live-tail` — uniquement à l'analyse de fichiers chargés côté navigateur (drag & drop), aux annotations et au rapport IA.

**Si vous exposez une instance à un public non fiable, désactivez `/auth/register`** (retirez la route, ou bloquez-la au niveau du reverse-proxy) plutôt que de compter sur la seule séparation de rôles.

## Correctifs appliqués lors de l'audit de sécurité (2026-07)

Ces problèmes ont été trouvés et corrigés dans le même changeset que cette documentation :

1. **Élévation de privilèges sur `/read-log` et `/live-tail`** — ces deux routes ne vérifiaient que `requireAuth` (n'importe quelle session valide), pas `requireAdmin`. Combiné à l'inscription ouverte, un visiteur pouvait s'auto-créer un compte `user` puis lire n'importe quel fichier local du serveur (confirmé avec `/etc/passwd` durant l'audit) via `POST /read-log`. **Corrigé** : les deux routes exigent maintenant un rôle `admin`.
2. **Injection de commande shell dans la lecture SSH** — le chemin de fichier (`logPath`) était interpolé sans échappement dans une commande shell exécutée sur l'hôte distant (`` `sudo cat ${logPath}` ``, `` `tail -f -n 0 ${logPath}` ``). Un chemin contenant des métacaractères shell (`; rm -rf /`, `` `...` ``, etc.) aurait exécuté des commandes arbitraires sur la machine distante. **Corrigé** : le chemin est maintenant échappé (`shellQuote`, quoting POSIX simple-quote) avant construction de la commande.
3. **`qs` (dépendance transitive)** — advisory modérée (DoS via `qs.stringify` sur des tableaux avec valeurs `null`/`undefined`, GHSA-q8mj-m7cp-5q26). **Corrigé** via `npm audit fix`.

## Ce qui reste un compromis assumé, pas un bug

- **Path traversal sur `/read-log`** : la route accepte n'importe quel chemin absolu, y compris en dehors de tout répertoire de logs. C'est voulu — c'est un outil d'administration serveur, pas un service multi-tenant — mais ça signifie que **tout compte admin a de facto un accès en lecture à l'ensemble du système de fichiers accessible au process Node**. Ne donnez le rôle admin qu'à des personnes de confiance.
- **Stockage des sessions/annotations en JSON plat** (`data/*.json`) : pas chiffré au repos. Si la machine héberge des données sensibles, chiffrez le disque au niveau OS/infra.
- **CORS ouvert** (`app.use(cors())` sans origine restreinte) : acceptable seulement parce que l'auth repose sur un Bearer token explicite (jamais envoyé automatiquement par le navigateur comme le serait un cookie), donc un site tiers ne peut pas rejouer la session d'un utilisateur via une requête cross-origin classique. À restreindre à l'origine de production si vous durcissez davantage.

## Bonnes pratiques en place

- Mots de passe hashés en PBKDF2-SHA512 (120 000 itérations) + sel aléatoire par utilisateur, jamais en clair.
- Comparaison de hash en temps constant (`crypto.timingSafeEqual`) pour éviter les attaques par timing sur le login.
- Tokens de session générés via `crypto.randomBytes` (32 octets), pas de JWT auto-décodable côté client contenant des données de confiance.
- Un utilisateur ne peut ni supprimer son propre compte ni se retirer son propre rôle admin (évite un verrouillage accidentel du dernier admin).

## Signaler une vulnérabilité

Projet personnel : ouvrez une issue GitHub en décrivant le problème. Pour un signalement sensible avant divulgation publique, contactez le mainteneur directement via son profil GitHub.
