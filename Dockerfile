# Build the frontend and compile the server, then ship only what runs.
FROM node:22-alpine AS build
WORKDIR /app

# Dependencies first: this layer is reused whenever only source has changed.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Produces dist/ (frontend) and dist-server/ (compiled server).
RUN npm run build

# Reinstall without dev dependencies so the runtime stage copies a lean tree.
RUN npm ci --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Cloud Run overrides this; it is only a sane default for `docker run`.
ENV PORT=8080

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/package.json ./package.json

# The image ships with this unprivileged user; nothing here needs root.
USER node
EXPOSE 8080

# Exec form, and node directly rather than `npm start`: npm would sit in front
# as PID 1 and swallow the SIGTERM the server needs to shut down cleanly.
CMD ["node", "dist-server/index.js"]
