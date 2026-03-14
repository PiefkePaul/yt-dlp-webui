FROM node:20-bookworm-slim

ARG YTDLP_VERSION=2026.03.13

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl python3 zip \
    && rm -rf /var/lib/apt/lists/*

RUN curl -L "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp" -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && yt-dlp --version \
    && ffmpeg -version | head -n 1

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

EXPOSE 3000
CMD ["npm", "start"]
