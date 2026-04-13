# yt-dlp Web UI

Kleine Weboberflaeche fuer `yt-dlp` mit Link-Eingabe, Formatwahl, Qualitaetswahl, Statusanzeige und Download-Button nach Abschluss.

Das Projekt ist jetzt bewusst in drei Rollen aufgeteilt:

- Der Quellcode in diesem Repository ist die eigentliche Server-App.
- Docker ist nur noch die optionale Verpackung dieser App.
- GitHub Pages kann eine statische Vorschau des Frontends veroeffentlichen.

## Projektmodi

### 1. Server direkt hosten

Das ist der bevorzugte Entwicklungs- und Quellcode-Modus.

Der Server startet lokal mit Node.js und erwartet diese System-Binaries im `PATH`:

- `yt-dlp`
- `ffmpeg`
- `deno`

Beim Start prueft der Server diese Abhaengigkeiten jetzt aktiv und bricht mit einer klaren Fehlermeldung ab, wenn etwas fehlt.

### 2. Docker-Container nutzen

Docker bleibt voll unterstuetzt, installiert aber nur die benoetigten Laufzeit-Binaries fuer dich und startet danach dieselbe Server-App.

### 3. GitHub Pages als statische Demo

GitHub Pages veroeffentlicht eine statische Vorschau des Frontends. Diese Version ist absichtlich noch ohne Funktion und dient nur zum Zeigen der Oberflaeche, bis spaeter ein getrenntes Backend angebunden wird.

## Voraussetzungen fuer den Direktbetrieb

- Node.js 20 oder neuer
- `yt-dlp`
- `ffmpeg`
- `deno`

Empfohlener Ablauf:

```bash
cp .env.example .env
npm install
npm start
```

Danach im Browser:

```text
http://localhost:3000
```

## Konfiguration

Eine Beispielkonfiguration liegt in [.env.example](/Volumes/ssd-data/Docker/yt-dlp-webui/.env.example:1).

Wichtige Variablen:

- `PORT`: HTTP-Port des Servers
- `TMP_DIR`: temporaires Arbeitsverzeichnis fuer Downloads
- `JOB_TTL_MS`: Aufbewahrungsdauer fertiger Downloads in Millisekunden
- `YTDLP_COOKIES_FILE`: optionaler Pfad zu einer Cookies-Datei
- `PUBLIC_API_BASE_URL`: optionales API-Ziel fuer getrennte Frontend-/Backend-Deployments
- `CORS_ALLOWED_ORIGINS`: kommaseparierte Origins fuer externe Frontends oder `*`

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

## Direktbetrieb ohne Docker

1. Installiere die Voraussetzungen.
2. Lege optional eine `.env` anhand von `.env.example` an.
3. Fuehre `npm install` aus.
4. Starte den Server mit `npm start`.

Hinweis zu Cookies:

- Lege bei Bedarf eine Datei wie `cookies/youtube.txt` ab.
- Setze dann `YTDLP_COOKIES_FILE=./cookies/youtube.txt`.
- Die Datei muss im Netscape/Mozilla-Format vorliegen.

## Docker nur als Verpackung

Wenn du die App lieber komplett verpackt startest:

```bash
docker compose up -d --build
```

Danach im Browser:

```text
http://localhost:3000
```

Die Compose-Datei reicht die wichtigsten Laufzeitvariablen an den Container weiter. Damit bleibt das Verhalten zwischen Direktbetrieb und Docker moeglichst gleich.

Hinweis fuer Hardwarebeschleunigung:

- Auf Linux-Hosts musst du fuer echtes Intel-QSV-Encoding in der Regel GPU-Zugriff bzw. `/dev/dri` an den Container durchreichen.
- Wenn keine nutzbare GPU-Durchreichung moeglich ist, faellt MP4 automatisch auf `libx264` zurueck.

## Frontend / GitHub Pages

Das Frontend ist jetzt so vorbereitet, dass es spaeter auch getrennt vom Backend betrieben werden kann:

- API-Aufrufe koennen ueber `PUBLIC_API_BASE_URL` auf eine andere Domain zeigen.
- Der Server kann ueber `CORS_ALLOWED_ORIGINS` explizit externe Frontends erlauben.
- Download-Links werden domain-sicher aufgebaut.
- GitHub Pages veroeffentlicht aktuell eine statische Demo ohne aktive Download-Funktion.

Die Pages-Pipeline baut aus `public/` ein separates statisches Artefakt unter `dist-pages/`.

Wichtig:

- GitHub Pages selbst reicht nicht fuer das echte Backend.
- Fuer die produktive Funktion brauchst du spaeter einen Host mit Prozessausfuehrung und beschreibbarem Temp-Speicher.

## CI/CD

### CI fuer Branches und Pull Requests

Der Workflow [.github/workflows/ci.yml](/Volumes/ssd-data/Docker/yt-dlp-webui/.github/workflows/ci.yml:1) fuehrt auf Pushes und Pull Requests nur Verifikation aus:

- Syntax-Checks
- Smoke-Test des Servers
- Build der statischen Pages-Demo

### Container-Publishing fuer `main` und Releases

Der Workflow [.github/workflows/publish-container.yml](/Volumes/ssd-data/Docker/yt-dlp-webui/.github/workflows/publish-container.yml:1) baut und pusht Docker-Images nur bei:

- Push auf `main`
- Push auf `master`
- Tags wie `v1.0.0`
- manuellem `workflow_dispatch`

Ziel-Registries:

- `ghcr.io/<github-user-or-org>/yt-dlp-webui`
- `docker.io/<dockerhub-user>/yt-dlp-webui`

Fuer Docker Hub brauchst du diese Repository-Secrets:

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`

### Runtime-Versionen automatisch aktualisieren

Der Workflow [.github/workflows/update-runtime-versions.yml](/Volumes/ssd-data/Docker/yt-dlp-webui/.github/workflows/update-runtime-versions.yml:1) laeuft jeden Montag um `05:17 UTC` und aktualisiert:

- `Dockerfile`
- `docker-compose.yml`

Wenn sich etwas geaendert hat, committet und pusht der Workflow die neuen Versionen. Der normale Container-Publish auf `main` uebernimmt danach den eigentlichen Image-Build automatisch.

### GitHub Pages Demo deployen

Der Workflow [.github/workflows/deploy-pages.yml](/Volumes/ssd-data/Docker/yt-dlp-webui/.github/workflows/deploy-pages.yml:1) veroeffentlicht die statische Vorschau auf GitHub Pages.

Empfehlung fuer die Repository-Einstellungen:

1. In GitHub unter `Settings > Pages` als Quelle `GitHub Actions` verwenden.
2. Die erste erfolgreiche Ausfuehrung des Pages-Workflows abwarten.

## NPM-Skripte

- `npm start`: startet den Server
- `npm run check`: Syntax-Checks fuer Server, Frontend und Hilfsskripte
- `npm run smoke`: startet einen kurzen Smoke-Test des Servers
- `npm run pages:build`: baut die statische Pages-Demo nach `dist-pages/`
- `npm run verify`: fuehrt Check, Smoke-Test und Pages-Build zusammen aus

## Temporaeres Verhalten

- Downloads landen pro Job in `tmp/<job-id>` bzw. im konfigurierten `TMP_DIR`
- nach Abschluss ist die Datei nur befristet verfuegbar
- standardmaessig werden Jobs nach 30 Minuten geloescht
- beim Start werden alte temporaere Job-Dateien bereinigt

## Hinweis zur MP3-Erzeugung

MP3 wird nicht mehr durch den yt-dlp-Postprozessor erzeugt, sondern nach dem Download explizit mit FFmpeg konvertiert. Das ist robuster, wenn yt-dlp zwar Audio laden kann, aber der interne Postprocessing-Schritt zickt.
