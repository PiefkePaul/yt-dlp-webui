# yt-dlp Download-Server

Selbst hostbarer Download-Server fuer `yt-dlp` mit Weboberflaeche, Fortschrittsanzeige, MP3-/MP4-Ausgabe und temporaeren Download-Links fuer Einzelvideos und Playlists.

Dieses Repository ist bewusst die eigentliche Server-App. Docker ist nur die optionale Verpackung derselben Anwendung, und GitHub Pages dient lediglich als statische Vorschau des Frontends.

## Was die App kann

- Einzelvideos und Playlists ueber eine Weboberflaeche anstossen
- Audio als MP3 oder Video als MP4 bereitstellen
- Fortschritt und Log-Ausgabe live anzeigen
- fertige Dateien direkt herunterladen
- Playlists gesammelt als ZIP ausliefern

## Schnellstart

### Direkt auf dem System

Voraussetzungen:

- Node.js 20 oder neuer
- `yt-dlp`
- `ffmpeg`
- `deno`

Start:

```bash
cp .env.example .env
npm install
npm start
```

Danach ist die App unter `http://localhost:3000` erreichbar.

Beim Start prueft der Server automatisch, ob `yt-dlp`, `ffmpeg` und `deno` im `PATH` vorhanden sind. Wenn etwas fehlt, bricht er mit einer klaren Fehlermeldung ab.

### Fertiges Server-Paket aus GitHub Releases

Getaggte Versionen veroeffentlichen zusaetzlich ein ZIP-Paket in den GitHub Releases. Dieses Paket enthaelt die lauffaehige Server-App inklusive Node-Abhaengigkeiten. Du musst es nur entpacken, eine `.env` anlegen und den Server starten.

Wichtig bleibt trotzdem:

- Node.js muss auf dem Zielsystem vorhanden sein.
- `yt-dlp`, `ffmpeg` und `deno` muessen weiterhin lokal installiert sein.

## Konfiguration

Eine Beispielkonfiguration liegt in `.env.example`.

Wichtige Variablen:

- `PORT`: HTTP-Port des Servers
- `TMP_DIR`: temporaeres Arbeitsverzeichnis fuer Downloads
- `JOB_TTL_MS`: Aufbewahrungsdauer fertiger Downloads in Millisekunden
- `YTDLP_COOKIES_FILE`: optionaler Pfad zu einer Cookies-Datei
- `PUBLIC_API_BASE_URL`: optionale API-Basis fuer getrennte Frontend-/Backend-Deployments
- `CORS_ALLOWED_ORIGINS`: kommaseparierte Origins fuer externe Frontends oder `*`
- `PUBLIC_DEMO_MODE`: schaltet das Frontend in einen reinen Demo-Modus
- `PUBLIC_DEMO_MESSAGE`: Text fuer die statische Vorschau

FFmpeg / MP4-Encoding:

- `FFMPEG_HWACCEL=auto` nutzt Quick Sync automatisch, wenn verfuegbar
- `FFMPEG_HWACCEL=qsv` bevorzugt Quick Sync explizit
- `FFMPEG_HWACCEL=none` erzwingt Software-Encoding
- `FFMPEG_MP4_HW_ENCODER=h264_qsv` waehlt den Hardware-Encoder
- `FFMPEG_QSV_PRESET=medium` steuert das QSV-Preset
- `FFMPEG_QSV_GLOBAL_QUALITY=23` steuert die Zielqualitaet fuer QSV
- `FFMPEG_X264_PRESET=medium` und `FFMPEG_X264_CRF=23` steuern den Software-Fallback
- `FFMPEG_AAC_BITRATE=192` steuert die AAC-Bitrate fuer MP4

Der Endpunkt `/health` zeigt die erkannte `ffmpeg`-Konfiguration inklusive aktivem MP4-Encoder an.

## Cookies

Wenn fuer bestimmte Quellen eine Anmeldung noetig ist:

- lege zum Beispiel `cookies/youtube.txt` an
- setze `YTDLP_COOKIES_FILE=./cookies/youtube.txt`
- die Datei muss im Netscape/Mozilla-Format vorliegen

## Docker nur optional

Die Docker-Dateien liegen absichtlich gesammelt unter `docker/`, damit das Repository primaer die eigentliche Server-App abbildet.

Start mit Docker:

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

Danach ist die App ebenfalls unter `http://localhost:3000` erreichbar.

Hinweise:

- Docker bleibt nur eine Verpackung derselben Server-App.
- Das Verhalten soll moeglichst nah am Direktbetrieb bleiben.
- Fuer echtes Intel-QSV-Encoding musst du auf Linux in der Regel GPU-Zugriff beziehungsweise `/dev/dri` an den Container durchreichen.

## GitHub Pages Demo

Das Frontend ist so vorbereitet, dass es spaeter auch getrennt vom Backend betrieben werden kann:

- API-Aufrufe koennen ueber `PUBLIC_API_BASE_URL` auf eine andere Domain zeigen
- der Server kann ueber `CORS_ALLOWED_ORIGINS` externe Frontends gezielt erlauben
- Download-Links werden domain-sicher aufgebaut
- GitHub Pages zeigt aktuell nur eine statische Vorschau ohne aktive Download-Funktion

Wichtig:

- GitHub Pages reicht nicht fuer das echte Backend
- fuer die produktive Funktion brauchst du spaeter einen Host mit Prozessausfuehrung und beschreibbarem Temp-Speicher

## Bereitstellung

- GitHub bleibt die Quelle fuer den Server-Code
- Docker Hub enthaelt den fertig nutzbaren Container
- getaggte Versionen veroeffentlichen zusaetzlich ein serverfertiges ZIP in GitHub Releases

## NPM-Skripte

- `npm start`: startet den Server
- `npm run check`: Syntax-Checks fuer Server, Frontend und Hilfsskripte
- `npm run smoke`: kurzer Smoke-Test des Servers
- `npm run pages:build`: baut die statische Demo nach `dist-pages/`
- `npm run release:build`: baut das Release-ZIP nach `dist-release/`
- `npm run verify`: fuehrt Check, Smoke-Test und Pages-Build zusammen aus

## Laufzeitverhalten

- Downloads landen pro Job in `tmp/<job-id>` beziehungsweise im konfigurierten `TMP_DIR`
- nach Abschluss ist die Datei nur befristet verfuegbar
- standardmaessig werden Jobs nach 30 Minuten geloescht
- beim Start werden alte temporaere Job-Dateien bereinigt

## Hinweis zur MP3-Erzeugung

MP3 wird nicht mehr durch den yt-dlp-Postprozessor erzeugt, sondern nach dem Download explizit mit FFmpeg konvertiert. Das ist robuster, wenn yt-dlp zwar Audio laden kann, aber der interne Postprocessing-Schritt zickt.
