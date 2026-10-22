# Build from the repository root:  docker build -f server/Dockerfile -t neon-reckoning-server .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared ./shared
COPY server ./server
COPY client/package.json ./client/package.json
RUN npm ci --workspace server --workspace shared --include-workspace-root \
 && npm run build -w server

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/server/dist ./dist
RUN echo '{"type":"module","dependencies":{"ws":"^8.18.0"}}' > package.json \
 && npm install --omit=dev --no-audit --no-fund
USER node
EXPOSE 2567
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT:-2567}/health || exit 1
CMD ["node", "dist/index.js"]
