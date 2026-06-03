# PFLICHTENHEFT -- yt-dlp-webui

> **Source of Truth.** Vor jeder Session lesen. Nach jeder Implementierung aktualisieren.

## Projekt-Beschreibung

Web-UI für yt-dlp: Downloads von YouTube, SoundCloud (inkl. Go+-Tracks) und anderen Quellen.
Backend: Node.js/Express. Frontend: Vanilla JS + HTML.

## Tech-Stack

- Node.js + Express
- yt-dlp + FFmpeg + Deno (Runtime-Deps)
- Vanilla JS Frontend (kein Framework)
- AES-256-GCM Encryption (Node built-in `crypto`)

## Modul-Status

| Modul | Status | Beschreibung |
|---|---|---|
| Server-Grundstruktur | ✅ Fertig | Express, Jobs, yt-dlp-Spawn, FFmpeg-Konvertierung |
| YouTube-Download | ✅ Fertig | inkl. MP3/MP4, Playlist, QSV-Support |
| SC-Download (öffentlich) | ✅ Fertig | Preflight-Check, Blockierung bei Preview-only |
| SC Token-Verifikation | ✅ Fertig | `/api/sc-verify`, Go+-Erkennung, yt-dlp-Duration-Check |
| SC Cookie-File (oauth_token) | ✅ Fertig | `writeTempCookieFile`, Netscape-Format |
| SC Session-Cookie Fix | ✅ Fertig | `fetchScSession` + AES-256-GCM Encryption |
| Client-Side Credential Encryption | ✅ Fertig | AES-256-GCM, localStorage nur Ciphertext |
| SC Go+-Download | ❌ Nicht unterstützt | FairPlay DRM, proaktive Erkennung aktiv, Phase 2 geplant |
| Frontend Settings-Modal | ✅ Fertig | Modal-Overlay, Token-Input, Verify, SC-Banner |

## Datenmodelle

### Job-Objekt (in-memory, nie persistiert)
```
id, url, format, quality, requiresConversion, status, stage, progress,
createdAt, completedAt, expiresAt, targetDir, log[], rawLog[],
downloadName, downloadPath, error, cleanupTimer,
conversionDurationSec, conversionKind, ffmpegMode
```
**Nie im Job gespeichert:** scToken, sessionCookie, encryptedToken, encryptedSession

### localStorage (Frontend)
```
sc_oauth_token_enc   — AES-256-GCM-verschlüsselter oauth_token
sc_session_enc       — AES-256-GCM-verschlüsselter _soundcloud_session-Wert
```

### Cookie-Datei (temporär, Netscape-Format)
```
.soundcloud.com  TRUE  /  TRUE  2147483647        oauth_token          <token>
.soundcloud.com  TRUE  /  TRUE  <now+604800>       _soundcloud_session  <value>
```
Permissions: 0o600. Wird **am Anfang** des `child.on('close',...)`-Handlers gelöscht —
als erstes, vor jeder weiteren Job-Verarbeitung — auf Erfolgs- UND Fehlerpfad.

## API / Schnittstellen

### `POST /api/sc-verify`
Request: `{ token: string }`  
Response: `{ valid, username?, goPlus?, error?, encryptedToken?, encryptedSession? }`

### `POST /api/download`
Request: `{ url, format, quality, encryptedToken?, encryptedSession? }`  
Response (Start): `{ id, encryptedSession? }` — `encryptedSession` nur wenn Server frisch gefetchte Session zurückgibt.  
Frontend speichert neuen `encryptedSession` aus der **Start-Response** (nicht aus Polling).

### `GET /api/status/:id`
Response: `{ id, status, stage, progress, error, log, rawLog, downloadName, downloadUrl, createdAt, completedAt, expiresAt }`

### `GET /api/file/:id`
Response: Datei-Download

## Offene Tasks

- [ ] Phase 2: Eigener SC-Downloader (direkter API-Zugriff, Go+-Support)

## Bekannte Probleme / Blocker

| Problem | Ursache | Lösung |
|---------|---------|--------|
| SC Go+-Download nicht möglich | Apple FairPlay DRM (`cbc-encrypted-hls`/`ctr-encrypted-hls`), yt-dlp kann nicht entschlüsseln | Phase 2: Eigener SC-Downloader geplant |

## Aenderungshistorie

| Datum | Aenderung |
|---|---|
| 2026-06-02 | Initiales Setup via bootstrap.ps1 |
| 2026-06-03 | PFLICHTENHEFT befüllt nach Brainstorming-Session; Design-Spec erstellt und nach Self-Review präzisiert |
| 2026-06-03 | Phase 1 abgeschlossen: DRM-Erkennung (`checkScTrackFormats`), Settings-Modal, Release v1.1.0 |
