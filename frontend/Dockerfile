# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install deps first (layer-cached unless package.json changes)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build
# VITE_WS_BASE: empty = same-origin (browser → nginx → backend in-cluster via proxy_pass).
# Override only if you expose the backend separately.
ARG VITE_WS_BASE=
ENV VITE_WS_BASE=$VITE_WS_BASE

COPY . .
RUN npm run build

# ── Stage 2: serve ─────────────────────────────────────────────────────────────
FROM nginx:alpine

# Remove default config
RUN rm /etc/nginx/conf.d/default.conf

# Add our SPA-friendly config
COPY nginx.conf /etc/nginx/conf.d/cyberpunkterm.conf

# Copy the built app
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
