# --- build stage ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY . .
WORKDIR /app/apps/api
RUN npm ci
RUN npm run build  # outputs to /app/apps/api/dist

# --- runtime stage ---
FROM node:20-alpine
WORKDIR /srv
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=build /app/apps/api/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/apps/api/dist ./dist
EXPOSE 8080
CMD ["node", "dist/index.js"]