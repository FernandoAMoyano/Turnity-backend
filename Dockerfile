# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1: builder
# Instala TODAS las dependencias (incl. devDependencies, necesarias para
# tsc/prisma generate), genera el cliente de Prisma y compila a dist/.
# ---------------------------------------------------------------------------
FROM node:20-alpine AS builder

# openssl/libstdc++/libc6-compat: requeridos por el motor de Prisma en Alpine
# (mismo paquete que ya usa Dockerfile.dev).
RUN apk add --no-cache openssl libstdc++ libc6-compat

WORKDIR /app

COPY package*.json ./
RUN npm ci

# .dockerignore excluye node_modules/dist/tests/coverage/logs/.git/.env, asi
# que este COPY no pisa lo instalado arriba ni arrastra artefactos locales.
COPY . .

RUN npx prisma generate

# Build de solo src/ (sin tests/ ni prisma/), ver tsconfig.build.json.
# Genera dist/server.js -- coincide con el "start" de package.json.
RUN npm run build:prod

# ---------------------------------------------------------------------------
# Stage 2: runtime
# Imagen final que corre 24/7. Sin devDependencies, sin tests, sin codigo
# fuente TS. Incluye el CLI de prisma (ahora en "dependencies") porque el
# Pre-Deploy Command de Render corre "npx prisma migrate deploy" dentro de
# esta misma imagen.
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runtime

RUN apk add --no-cache openssl libstdc++ libc6-compat

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

# Motor de Prisma ya generado en el builder (evita depender de que el
# postinstall de @prisma/client encuentre el schema en este punto).
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

COPY --from=builder /app/dist ./dist

# Solo schema + migrations: ni seed.ts ni seedGuard.ts viajan a produccion
# (el seed no debe poder correr ahi ni por accidente).
COPY --from=builder /app/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=builder /app/prisma/migrations ./prisma/migrations

# src/shared/logger/logger.ts crea/escribe en ./logs al importarse (siempre,
# salvo NODE_ENV=test). El resto de /app (node_modules, dist, prisma) el
# proceso solo lo LEE -- los permisos por defecto (root:root, 644/755) ya
# alcanzan para que el usuario no-root pueda leerlos, no hace falta un
# chown -R sobre todo node_modules (con miles de archivos, eso agregaba
# ~3-4 min al build). Solo logs/ necesita ser escribible por "node".
# Nota: en Render (filesystem efimero en el free tier) esos archivos se
# pierden en cada restart/redeploy; el log que persiste es el de stdout,
# que Render si captura.
RUN mkdir -p logs && chown node:node logs
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||3000)+'/health',res=>{process.exit(res.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "dist/server.js"]
