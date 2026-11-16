# yt-dlp Download Server

A self-hostable download server for `yt-dlp` with a web interface, live progress updates, MP3/MP4 output, and temporary download links for single videos and playlists.

This repository is intentionally the actual server application. Docker is only an optional packaging layer for the same app, and the static frontend preview is built separately.

## Features

- start single video and playlist downloads from the web interface
- provide audio as MP3 or video as MP4
- show live progress and log output
- download finished files directly
- bundle playlist results as ZIP archives

## Quick Start

### Run Directly on Your System

Requirements:

- Node.js 20 or newer
- `yt-dlp`
- `ffmpeg`
- `deno`

Start the server:

```bash
cp .env.example .env
npm install
npm start
```

The app will then be available at `http://localhost:3000`.

On startup, the server automatically checks whether `yt-dlp`, `ffmpeg`, and `deno` are available in your `PATH`. If something is missing, it exits with a clear error message.

### Ready-to-Use Server Package from Gitea Releases

Tagged versions also publish a ZIP package in Gitea Releases. This package contains the runnable server app including its Node dependencies. You only need to extract it, create a `.env` file, and start the server.

Still required on the target system:

- Node.js must be installed
- `yt-dlp`, `ffmpeg`, and `deno` must still be installed locally

## Configuration

An example configuration is available in `.env.example`.

Important variables:

- `PORT`: HTTP port used by the server
- `TMP_DIR`: temporary working directory for downloads
- `JOB_TTL_MS`: retention time for finished downloads in milliseconds
- `YTDLP_COOKIES_FILE`: optional path to a cookies file
- `PUBLIC_API_BASE_URL`: optional API base URL for separated frontend/backend deployments
- `CORS_ALLOWED_ORIGINS`: comma-separated origins for external frontends or `*`
- `PUBLIC_DEMO_MODE`: switches the frontend into demo-only mode
- `PUBLIC_DEMO_MESSAGE`: message shown in the static preview

FFmpeg / MP4 encoding:

- `FFMPEG_HWACCEL=auto` uses Quick Sync automatically when available
- `FFMPEG_HWACCEL=qsv` explicitly prefers Quick Sync
- `FFMPEG_HWACCEL=none` forces software encoding
- `FFMPEG_MP4_HW_ENCODER=h264_qsv` selects the hardware encoder
- `FFMPEG_QSV_PRESET=medium` controls the QSV preset
- `FFMPEG_QSV_GLOBAL_QUALITY=23` controls the target quality for QSV
- `FFMPEG_X264_PRESET=medium` and `FFMPEG_X264_CRF=23` control the software fallback
- `FFMPEG_AAC_BITRATE=192` controls the AAC bitrate for MP4

The `/health` endpoint exposes the detected `ffmpeg` configuration, including the active MP4 encoder.

## Cookies

If a source requires login data:

- create a file such as `cookies/youtube.txt`
- set `YTDLP_COOKIES_FILE=./cookies/youtube.txt`
- the file must use Netscape/Mozilla cookie format

## Docker Is Optional

The Docker files intentionally live under `docker/` so the repository stays focused on the server app itself.

Start with Docker:

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

The app will then also be available at `http://localhost:3000`.

Notes:

- Docker is only a packaging layer for the same server app
- behavior is meant to stay as close as possible to direct hosting
- for real Intel QSV encoding on Linux, you usually need to pass GPU access or `/dev/dri` into the container

## Static Demo and Distribution

The frontend can use a separate backend via `PUBLIC_API_BASE_URL` and `CORS_ALLOWED_ORIGINS`.
Run `npm run pages:build` to create `dist-pages/`, or manually run **Build Demo Archive** in Gitea Actions and download its `static-demo` artifact. Extract the archive into a static web server's document root. It is a preview only; downloads require the running Node server. Publishing to a host is manual.

- Repository and releases: https://git.scholz-cloud.de/Scholz/yt-dlp-webui
- Container: `git.scholz-cloud.de/piefkepaul/yt-dlp-webui:<tag>` (authentication required), with a Docker Hub copy.
- Tag pushes (`v*`) publish containers and Gitea release ZIPs. Manual release runs must select an existing version tag.
- Branch pushes and PRs run verification only. Merging never deploys the NAS service.
- Manual container runs publish the selected ref as the image tag; deploy an explicit version rather than a moving `latest` tag.
- The previous GitHub runtime updater has been removed. Update `YTDLP_VERSION` and `DENO_VERSION` in both `docker/Dockerfile` and `docker/docker-compose.yml` through a Gitea PR after checking upstream releases.
- GitHub is only a backup mirror; its Actions and Pages are no longer used.

## Video Quality

MP4 downloads use yt-dlp's default YouTube client selection. A requested resolution is an upper limit; the source must offer that resolution. Separate video/audio streams are downloaded and converted with FFmpeg. No legacy YouTube client is forced.

## NPM Scripts

- `npm start`: starts the server
- `npm run check`: syntax checks for server, frontend, and helper scripts
- `npm run smoke`: short smoke test for the server
- `npm run pages:build`: builds the static demo into `dist-pages/`
- `npm run release:build`: builds the release ZIP into `dist-release/`
- `npm run verify`: runs check, smoke test, and Pages build together

## Runtime Behavior

- downloads are stored per job in `tmp/<job-id>` or the configured `TMP_DIR`
- finished files remain available only for a limited time
- jobs are deleted after 30 minutes by default
- old temporary job files are cleaned up on startup

## Note About MP3 Creation

MP3 is no longer produced through the yt-dlp postprocessor. Instead, it is converted explicitly with FFmpeg after the download. That is more robust when yt-dlp can fetch the audio but its internal postprocessing step becomes unreliable.
