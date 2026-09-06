# ---- build cliente ----
FROM node:24-alpine AS client-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json* ./
RUN npm install
COPY client/ ./
RUN npm run build

# ---- deps servidor ----
FROM node:24-alpine AS server-deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

# ---- runner ----
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data
COPY --from=server-deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY --from=client-build /app/client/dist ./client/dist
RUN mkdir -p /app/data
EXPOSE 3000
CMD ["node", "server/index.js"]
