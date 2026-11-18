# --- build stage ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY . .
WORKDIR /app/apps/web
RUN npm ci
RUN npm run build

# --- runtime stage ---
FROM nginx:1.25-alpine
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
RUN rm -f /etc/nginx/conf.d/default.conf
COPY <<'NGINX' /etc/nginx/conf.d/default.conf
server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;
  add_header Strict-Transport-Security "max-age=31536000" always;
  # Revalidate the app entry point so browsers discover each release.
  add_header Cache-Control "no-cache";

  # Vite names these assets by content; repeat visits can reuse their bytes.
  location /assets/ {
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header Cache-Control "public, max-age=31536000, immutable";
    try_files $uri =404;
  }

  location / {
    try_files $uri /index.html;
  }

  # Health checks
  location = /healthz { return 200; }
  location = /readyz  { return 200; }
}
NGINX
