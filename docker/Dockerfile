FROM node:20-bookworm-slim

ARG YTDLP_VERSION=2026.03.17
ARG DENO_VERSION=2.7.13

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl python3 unzip \
    && rm -rf /var/lib/apt/lists/*

RUN curl -L "https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/deno-x86_64-unknown-linux-gnu.zip" -o /tmp/deno.zip \
    && unzip /tmp/deno.zip -d /usr/local/bin \
    && chmod a+rx /usr/local/bin/deno \
    && rm /tmp/deno.zip \
    && deno --version

RUN curl -L "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp" -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && yt-dlp --version \
    && ffmpeg -version | head -n 1

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

EXPOSE 3000
CMD ["npm", "start"]
