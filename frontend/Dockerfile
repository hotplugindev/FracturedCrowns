# ============================================================
# Fractured Crowns — Frontend Dockerfile
# Multi-stage build: dev with Vite, prod with nginx
# ============================================================

# ---- Stage 1: Base ----
FROM node:20-alpine AS base

WORKDIR /app

COPY package.json package-lock.json* ./

# ---- Stage 2: Development ----
FROM base AS development

RUN npm install

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# ---- Stage 3: Build ----
FROM base AS build

RUN npm install

COPY . .

RUN npm run build

# ---- Stage 4: Production (nginx) ----
FROM nginx:1.25-alpine AS production

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built frontend assets
COPY --from=build /app/dist /usr/share/nginx/html

# Add non-root user for security
RUN addgroup -g 1001 -S frontend && \
    adduser -S fractured -u 1001 -G frontend && \
    chown -R fractured:frontend /usr/share/nginx/html && \
    chown -R fractured:frontend /var/cache/nginx && \
    chown -R fractured:frontend /var/log/nginx && \
    touch /var/run/nginx.pid && \
    chown -R fractured:frontend /var/run/nginx.pid

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://localhost:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
