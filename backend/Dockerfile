# Backend image — Node + Chromium + Thai/CJK fonts for the Puppeteer-rendered
# PDFs. Replaces the flaky nixpacks build (which intermittently fails at the
# `nix-env -if nixpkgs.nix` bootstrap); Docker builds are deterministic.
# In Coolify: set this app's Build Pack = Dockerfile, Base Directory = backend.
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-thai-tlwg fonts-liberation fonts-noto fonts-noto-cjk \
      ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# pdfRenderer.findChrome() honours PUPPETEER_EXECUTABLE_PATH first.
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    PORT=3001

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

EXPOSE 3001
CMD ["node", "src/app.js"]
