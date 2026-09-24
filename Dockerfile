# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOME=/home/app
ENV PYTHONUNBUFFERED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip zip ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && pip3 install --no-cache-dir --break-system-packages --no-compile yt-dlp curl_cffi

COPY dist ./dist
COPY scripts ./scripts

RUN echo '{ \
  "name":"bot", \
  "private":true, \
  "dependencies":{ \
    "dotenv":"^16.4.0", \
    "express":"^4.21.0", \
    "@trpc/server":"^11.6.0", \
    "cookie":"^1.0.0", \
    "jose":"^6.1.0", \
    "zod":"^3.24.0", \
    "superjson":"^1.13.0", \
    "nanoid":"^5.1.0", \
    "axios":"^1.12.0", \
    "drizzle-orm":"^0.44.0", \
    "mysql2":"^3.15.0", \
    "pg":"^8.13.0" \
  } \
}' > package.json \
  && npm install --omit=dev --legacy-peer-deps --maxsockets=2 \
  && rm package.json package-lock.json

RUN useradd --create-home --shell /bin/bash app \
  && chown -R app:app /app
USER app

EXPOSE 3000

CMD ["node", "dist/index.js"]
