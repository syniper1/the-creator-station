# ---------- Build client ----------
FROM node:20-slim AS client-build
WORKDIR /app
COPY client/package*.json ./client/
RUN cd client && npm install
COPY client ./client
RUN cd client && npm run build

# ---------- Server runtime ----------
FROM node:20-slim AS runtime
WORKDIR /app

# ffmpeg for mp4 rendering
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates       && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY src ./src
COPY --from=client-build /app/client/dist ./public

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
