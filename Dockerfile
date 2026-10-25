# Dev environment — the production artifact is the static GitHub Pages bundle,
# so a single-stage Node image with the Vite dev server is all we need.
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
# Install with the image's default user, then hand /app to the unprivileged
# runtime user (Vite writes its dependency cache into node_modules/.vite).
RUN npm ci && chown -R node:node /app

COPY --chown=node:node . .

EXPOSE 5173

# The dev server serves the site under its configured base path.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:5173/deepseek-peakprice/ || exit 1

# Never run the dev server as root.
USER node

CMD ["npm", "run", "dev"]
