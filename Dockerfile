# Dev environment — the production artifact is the static GitHub Pages bundle,
# so a single-stage Node image with the Vite dev server is all we need.
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev"]
