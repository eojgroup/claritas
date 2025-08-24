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

  location / {
    try_files $uri /index.html;
  }

  # Health checks
  location = /healthz { return 200; }
  location = /readyz  { return 200; }
}
NGINX
