# LogScope — image de production
#
# Le serveur est un simple process Node/Express (pas de build front-end :
# le JS/CSS servi est du vanilla JS statique). L'image se limite donc à
# installer les dépendances de prod et copier le code.

FROM node:22-alpine

WORKDIR /app

# Installer d'abord les dépendances pour profiter du cache Docker
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# data/ contient users.json, sessions.json, annotations.json — à monter
# en volume pour survivre aux redéploiements.
RUN mkdir -p data && chown -R node:node /app
USER node

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "require('http').get('http://localhost:3000/auth/session',res=>process.exit(res.statusCode?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "local-log-service.js"]
