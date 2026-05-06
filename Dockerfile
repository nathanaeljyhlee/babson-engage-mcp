FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY dist/ ./dist/

ENV PORT=8080
EXPOSE 8080

USER node
CMD ["node", "dist/server-http.js"]
