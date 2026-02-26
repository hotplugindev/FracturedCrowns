# ============================================================
# Fractured Crowns — Backend Dockerfile
# Multi-stage build for development and production
# ============================================================

# ---- Stage 1: Base ----
FROM node:20-alpine AS base

WORKDIR /app

COPY package.json package-lock.json* ./

# ---- Stage 2: Development ----
FROM base AS development

RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]

# ---- Stage 3: Build ----
FROM base AS build

RUN npm install

COPY . .

RUN npm run build

# ---- Stage 4: Production ----
FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./

RUN npm ci --only=production && \
    npm cache clean --force && \
    addgroup -g 1001 -S nodejs && \
    adduser -S fractured -u 1001 -G nodejs

COPY --from=build /app/dist ./dist

USER fractured

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://localhost:3000/api/health || exit 1

CMD ["node", "dist/server.js"]
