# Build Stage
FROM node:22.23.4-alpine AS builder

WORKDIR /app

# Use deterministic, lockfile-bound install. --ignore-scripts disables postinstall
# hooks of transitive dependencies; the only Vite/Vue runtime/build deps that have
# install scripts (esbuild, fsevents) work without them in a Linux build context.
COPY package*.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

# Production Stage
FROM nginx:1.27-alpine

# Copy built assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Add nginx config for routing
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Container-level health check — used by Docker to monitor liveness.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- --tries=1 --timeout=3 http://127.0.0.1:80/ > /dev/null 2>&1 || exit 1

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]
