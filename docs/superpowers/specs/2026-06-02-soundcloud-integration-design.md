# SoundCloud Integration — Design Spec

**Datum:** 2026-06-02  
**Status:** Approved  
**Scope:** SoundCloud-Support in yt-dlp-webui via bestehendem yt-dlp-Binary

---

## Ziel

SoundCloud-URLs neben YouTube unterstützen. Kein zusätzliches Binary (kein scdl). Token-Handling clientseitig persistent (localStorage), serverseitig temporär pro Job. Kein 30-Sekunden-Preview darf als Erfolg durchkommen.

---

## Architektur

**Ansatz:** URL-Routing innerhalb der bestehenden `buildArgs`-Funktion (Ansatz A). Ein einziger `/api/download`-Endpoint bleibt bestehen. Erkennung über Hostname `soundcloud.com`.

### Neue Hilfsfunktionen (server.js)

```
detectSource(url)                          → 'soundcloud' | 'other'
writeTempCookieFile(targetDir, token)      → string (Pfad zur .cookies-Datei)
buildScArgs({ url, format, quality, targetDir, cookiePath })
buildYtArgs({ url, format, quality, targetDir })   ← bisherige buildArgs-Logik
buildArgs({ url, format, quality, targetDir, scToken })  ← dispatcht nach detectSource()
```

### Token-Lebenszyklus

1. User gibt Token im Settings-Panel ein → `localStorage` Key: `sc_oauth_token`
2. Frontend erkennt SC-URL → liest Token aus localStorage → sendet als `scToken` im POST-Body
3. Server schreibt Netscape-Cookie-Datei nach `<targetDir>/<jobId>.cookies`
4. yt-dlp erhält `--cookies <cookiePath>`
5. `scheduleJobCleanup` löscht `targetDir` inkl. Cookie-Datei → kein separater Cleanup nötig

### Netscape-Cookie-Format

```
# Netscape HTTP Cookie File
.soundcloud.com	TRUE	/	TRUE	2147483647	oauth_token	<token>
```

---

## Backend

### SC-spezifische yt-dlp-Args

Folgende YT-spezifischen Args werden für SC **nicht** gesetzt:
- `--js-runtimes deno`
- `--remote-components ejs:github`
- `--extractor-args youtube:player_client=android,web`

Gemeinsame Args bleiben: `--yes-playlist`, `--newline`, `--restrict-filenames`, `-P`, `-o`.

Format-Mapping:
- `original` → `-f bestaudio` (kein ffmpeg, Datei as-is)
- `mp3` → `-f bestaudio` + nachgelagerte ffmpeg MP3-Konvertierung

**Preflight-Check (kein Token):** Wenn SC-URL + kein `scToken` im Request → Server führt `yt-dlp --dump-json --no-playlist <url>` aus (ohne Cookie). Gibt `duration ≤ 35` zurück → Job sofort mit Error "Dieser Track benötigt einen SoundCloud-Token" abbrechen, keine Datei herunterladen. Bei `duration > 35` (öffentlicher Track) → Download normal fortsetzen.

### Endpoint: POST /api/sc-verify

Body: `{ token: string }`

**Schritt 1 — SC REST API:**
```
GET https://api.soundcloud.com/me
Authorization: OAuth <token>
```
Liefert Username + Plan (`"Go+"`). Bei 401/403 → sofortiger Fail.

**Schritt 2 — yt-dlp Duration-Check:**
- `yt-dlp --dump-json --no-playlist --cookies <tempfile> <TEST_TRACK_URL>`
- `TEST_TRACK_URL`: konfigurierbarer Go+-Track via Env `SC_TEST_TRACK_URL`; Fallback-URL wird während der Implementierung auf einen bekannten Go+-only Track festgelegt und in der Codebasis kommentiert.
- Temp-Cookie-Datei liegt in `os.tmpdir()` (kein Job-`targetDir` vorhanden), wird in `finally` immer gelöscht.
- Prüft `duration > 35` aus dem JSON-Output
- `duration ≤ 35` → Preview erkannt → `{ valid: false, error: "Token ungültig oder kein Go+-Zugriff — nur 30s-Preview verfügbar" }`

Response:
```json
{ "valid": true, "username": "MusicFan92", "goPlus": true }
{ "valid": false, "error": "..." }
```

### Fehlerbehandlung

| Situation | Behandlung |
|-----------|------------|
| Track braucht Token, keiner gesetzt | Job → error: "Track nicht vollständig verfügbar — SoundCloud-Token benötigt" |
| Token ungültig / abgelaufen | Job → gleiche Meldung (duration ≤ 35s erkannt) |
| Go+-Track, kein Go+-Abo | Job → gleiche Meldung |
| Cookie-Datei nicht schreibbar | Job → sofortiger error vor yt-dlp-Start |
| SC-API nicht erreichbar bei /sc-verify | `{ valid: false, error: "SC-API nicht erreichbar" }` |

**SC-Output-Parsing:** `processYtdlpOutput` bleibt unverändert. YT-spezifische Strings werden für SC-Jobs einfach nicht gematcht — neutrale Stage-Updates (`download`, `convert`) greifen trotzdem.

---

## Frontend

### index.html — neue Elemente

- `⚙ Einstellungen`-Button oben rechts im Card-Header
- Settings-Panel `#settingsPanel` (hidden by default) innerhalb der Card:
  - Token-Input `#scTokenInput`
  - "Speichern"-Button → `saveScToken()`
  - "Token prüfen"-Button → `POST /api/sc-verify`
  - Ergebnis-Zeile `#scVerifyResult` (leer → prüfend → ✓/✗)
  - Datenschutz-Hinweis: "Nur im Browser gespeichert — nie dauerhaft an den Server übertragen"
- Kontextbanner `#scBanner` (hidden by default) unter dem Formular:
  - Text: "Kein SoundCloud-Token — private/altersgeschützte Tracks werden nicht geladen"
  - "Token setzen →"-Link öffnet Settings-Panel

### app.js — neue Logik

```
detectSoundCloud(url)        → hostname === 'soundcloud.com'
updateUiForSource(source)    → 'soundcloud': Format [Original, MP3], Qualität deaktiviert bei Original
                               'other': Standard [MP3, MP4] wiederherstellen
loadScToken()                → localStorage.getItem('sc_oauth_token') || ''
saveScToken(token)           → localStorage.setItem('sc_oauth_token', token)
```

- `input`-Event auf URL-Feld → `detectSoundCloud` → `updateUiForSource` → Banner zeigen/verstecken
- **Submit ohne Token:** SC-URL + kein Token → Banner wird hervorgehoben (Shake/Highlight), Download startet trotzdem — öffentliche Tracks funktionieren ohne Token. Kein hard-block.
- Submit normal: SC-URL + Token → `scToken` im POST-Body
- "Token prüfen" → `/api/sc-verify` → Ergebnis in `#scVerifyResult`

### Format-Qualitäts-Mapping SC

| Format | Qualitäts-Optionen |
|--------|-------------------|
| Original | — (Qualitäts-Dropdown disabled) |
| MP3 | 320 / 192 / 128 kbps |

### Playlist-Support

`--yes-playlist` bleibt in SC-Args → SC-Sets funktionieren automatisch. ZIP-Bundling bei Mehrfach-Dateien wie bei YT.

---

## Was sich nicht ändert

- Job-Datenstruktur
- `/api/status/:id`, `/api/file/:id`, `/health`
- ffmpeg-Konvertierungslogik
- Cleanup-Mechanismus
- Demo-Mode / CORS / Public-API-Config
