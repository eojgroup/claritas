# --- build stage ---
FROM node:20-alpine AS build
WORKDIR /app
# Only API context for clean caching
COPY apps/api/package*.json ./
RUN npm ci
COPY apps/api/ .
RUN npm run build  # outputs to /app/dist

# --- runtime stage ---
FROM node:20-alpine
WORKDIR /srv
ENV NODE_ENV=production
ENV PORT=8080

# Sharp rasterizes the briefing map at send time; install a deterministic font
# so labels render correctly in the minimal Alpine runtime.
RUN apk add --no-cache fontconfig ttf-dejavu

# Install prod deps
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev

# Copy compiled output
COPY --from=build /app/dist ./dist

EXPOSE 8080
CMD ["node", "dist/index.js"]
