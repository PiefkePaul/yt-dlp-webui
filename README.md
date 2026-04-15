# yt-dlp Download Server

A self-hostable download server for `yt-dlp` with a web interface, link inspection, queued jobs, live progress updates, MP3/MP4 output, temporary download links, and session-specific advanced options for many supported sites.

This repository is intentionally the actual server application. Docker is only an optional packaging layer for the same app, and GitHub Pages is only used as a static frontend preview.

## Features

- start downloads from many `yt-dlp` supported sites from the web interface
- inspect links before the actual download starts
- provide audio as MP3 or video as MP4
- queue jobs with a configurable concurrency limit
- show live progress and log output
- cancel queued or running jobs from the browser
- download finished files directly
- bundle playlist results as ZIP archives
- pass session-only cookies, headers, referer, video password, and extractor args through the browser UI
- pass a SoundCloud OAuth token for the current session
- detect likely SoundCloud preview-only / Go+ cases before download starts

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

### Ready-to-Use Server Package from GitHub Releases

Tagged versions also publish a ZIP package in GitHub Releases. This package contains the runnable server app including its Node dependencies. You only need to extract it, create a `.env` file, and start the server.

Still required on the target system:

- Node.js must be installed
- `yt-dlp`, `ffmpeg`, and `deno` must still be installed locally

## Configuration

An example configuration is available in `.env.example`.

Important variables:

- `PORT`: HTTP port used by the server
- `TMP_DIR`: temporary working directory for downloads
- `JOB_TTL_MS`: retention time for finished downloads in milliseconds
- `MAX_CONCURRENT_JOBS`: how many download jobs may run at the same time
- `INSPECT_ENTRY_LIMIT`: how many playlist entries should be shown in the browser preview
- `YTDLP_COOKIES_FILE`: optional global fallback path to a cookies file
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

## Advanced Per-Session Options

The browser UI now includes an "Erweitertes Menue fuer diese Session" section. These values are not persisted in `.env`; they are only applied to the current inspect/download request.

Available options in the UI:

- SoundCloud OAuth token
- video password
- referer
- raw `Cookie:` header
- pasted Netscape/Mozilla cookie text
- additional request headers
- additional `--extractor-args` lines

This keeps the default home-lab setup simple while still allowing site-specific overrides when needed.

## Cookies

If a source requires login data:

- you can either set a global fallback via `YTDLP_COOKIES_FILE`
- or paste cookies directly into the web UI for the current session
- cookie files must use Netscape/Mozilla cookie format

Example for a global fallback:

- create a file such as `cookies/default.txt`
- set `YTDLP_COOKIES_FILE=./cookies/default.txt`

When a per-session cookie file is pasted into the browser UI, that temporary file takes precedence over the global fallback for that request.

## SoundCloud Notes

- the app can pass a SoundCloud OAuth token to `yt-dlp` for the current session
- before a download starts, the app inspects SoundCloud metadata and looks for preview-only / premium signals
- if the inspected track looks like a preview-only / Go+ case, the download is blocked until a token is provided
- if a normal format is available but premium / HQ variants are also detected, the UI marks the token as recommended instead of mandatory

Implementation note:

- the current logic is intentionally focused on SoundCloud, because that is where preview-vs-Go+ behavior is especially visible in a home-lab UI
- for other supported sites, the generic per-session controls are meant to cover the common cases without building extractor-specific forms for every supported website

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

## GitHub Pages Demo

The frontend is prepared so it can later be hosted separately from the backend:

- API requests can target another domain through `PUBLIC_API_BASE_URL`
- the server can explicitly allow external frontends through `CORS_ALLOWED_ORIGINS`
- download links are built in a domain-safe way
- GitHub Pages currently shows only a static preview without active download functionality

Live demo:

- [GitHub Pages demo](https://piefkepaul.github.io/yt-dlp-webui/)

Important:

- GitHub Pages is not enough for the real backend
- production use still needs a host with process execution and writable temporary storage

## Home-Lab Notes

- by default, only one download job runs at a time
- additional jobs are kept in an in-memory queue
- queued or running jobs can be cancelled from the web interface
- job state stays in memory and is intentionally optimized for a single-node home-lab setup

## Distribution

- GitHub remains the source of truth for the server code
- Docker Hub contains the ready-to-use container image
- tagged versions additionally publish a ready-to-run server ZIP in GitHub Releases

## NPM Scripts

- `npm start`: starts the server
- `npm run check`: syntax checks for server, frontend, and helper scripts
- `npm run smoke`: short smoke test for the server
- `npm run test:integration`: runs the queue/inspect/cancel integration test with mocked binaries
- `npm run pages:build`: builds the static demo into `dist-pages/`
- `npm run release:build`: builds the release ZIP into `dist-release/`
- `npm run verify`: runs syntax checks, smoke test, integration test, and Pages build together

## Runtime Behavior

- downloads are stored per job in `tmp/<job-id>` or the configured `TMP_DIR`
- jobs are started through a simple in-memory queue with a configurable concurrency cap
- finished files remain available only for a limited time
- jobs are deleted after 30 minutes by default
- old temporary job files are cleaned up on startup

## Note About MP3 Creation

MP3 is no longer produced through the yt-dlp postprocessor. Instead, it is converted explicitly with FFmpeg after the download. That is more robust when yt-dlp can fetch the audio but its internal postprocessing step becomes unreliable.
