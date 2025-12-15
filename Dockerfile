# =========================
# 1️⃣ Build React frontend
# =========================
FROM node:20-slim AS client-build

WORKDIR /app/client

# Copy client package files
COPY client/package*.json ./
RUN npm install

# Copy client source
COPY client/ ./

# Build React app
RUN npm run build


# =========================
# 2️⃣ Build backend server
# =========================
FROM node:20-slim

WORKDIR /app

# Copy backend package files
COPY package*.json ./
RUN npm install --omit=dev

# Copy backend source
COPY server.js ./

# Copy built frontend from previous stage
COPY --from=client-build /app/client/dist ./client/dist

# Cloud Run uses PORT
ENV PORT=8080
EXPOSE 8080

# Start server
CMD ["node", "server.js"]
