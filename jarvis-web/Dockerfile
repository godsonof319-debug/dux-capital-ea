# JARVIS Web — production container
FROM node:20-alpine

WORKDIR /app

# Install production dependencies only.
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# App source.
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
