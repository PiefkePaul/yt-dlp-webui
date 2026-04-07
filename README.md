# yt-dlp Web UI

Kleine Weboberflaeche fuer yt-dlp mit Link-Eingabe, Formatwahl, Qualitaetswahl, Statusanzeige und Download-Button nach Abschluss.

## Ziel des Containers

Der Container stellt einen temporaeren Download-Service im Browser bereit:

- Link einfuegen
- MP3 oder MP4 waehlen
- Download im Container ausfuehren lassen
- fertige Datei direkt ueber das Webinterface herunterladen

Die erzeugten Dateien werden nicht dauerhaft archiviert. Jeder Download bleibt nur fuer eine begrenzte Zeit verfuegbar und wird danach automatisch aus dem temporaeren Speicher entfernt.

## Start

```bash
docker compose up -d --build
```

Danach im Browser oeffnen:

```text
http://localhost:3000
```

## Container automatisch nach GitHub und Docker Hub veroeffentlichen

Im Repo liegt jetzt ein GitHub-Actions-Workflow unter `.github/workflows/publish-container.yml`.

Bei jedem Push auf `main` oder `master` sowie bei Tags wie `v1.0.0` wird das Docker-Image automatisch gebaut und in beide Registries gepusht:

- `ghcr.io/<github-user-or-org>/yt-dlp-webui`
- `docker.io/<dockerhub-user>/yt-dlp-webui`

Damit Docker Hub funktioniert, musst du in deinem GitHub-Repository diese Secrets setzen:

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`

Empfehlung fuer Docker Hub:

1. In Docker Hub ein Access Token erzeugen.
2. Das Token als `DOCKERHUB_TOKEN` in GitHub hinterlegen.
3. Deinen Docker-Hub-Benutzernamen als `DOCKERHUB_USERNAME` speichern.

Danach reicht ein normaler Git-Push auf den Standard-Branch oder ein Versions-Tag, und das Image wird automatisch in beide Registries veroeffentlicht.

## Runtime-Versionen automatisch aktualisieren

Zusaetzlich gibt es jetzt einen zweiten Workflow unter `.github/workflows/update-runtime-versions.yml`.

Der Workflow laeuft jeden Montag um `05:17 UTC` und macht Folgendes automatisch:

- holt die neuesten Releases von `yt-dlp` und `Deno`
- aktualisiert `Dockerfile` und `docker-compose.yml`
- committet und pusht die Versionsaenderung nur dann, wenn sich wirklich etwas geaendert hat
- baut danach direkt das neue Container-Image und pusht es nach GitHub Container Registry und Docker Hub

Du kannst den Workflow in GitHub auch jederzeit manuell ueber `workflow_dispatch` starten. Optional gibt es dort auch `force_publish`, falls du das aktuelle Image ohne Versionsaenderung noch einmal neu veroeffentlichen willst.

## Temporaeres Verhalten

- Downloads landen pro Job in `/app/tmp/<job-id>`
- nach Abschluss ist die Datei nur befristet ueber die Weboberflaeche verfuegbar
- standardmaessig werden Jobs nach 30 Minuten geloescht
- die Aufbewahrungsdauer kann ueber `JOB_TTL_MS` angepasst werden
- beim Container-Start werden alte temporaere Job-Dateien automatisch bereinigt

## Wichtiger Fix fuer YouTube

Diese Version verwendet nicht das Debian-Paket, sondern laedt beim Build eine aktuelle `yt-dlp`-Version direkt von den offiziellen Releases. Das ist fuer YouTube wichtig, weil die Seite ihre Gegenmassnahmen staendig aendert.

## Optionale Cookies fuer YouTube

Manche Server-/Docker-IP-Adressen werden von YouTube aggressiver eingeschraenkt. Dann hilft oft eine `cookies.txt`.

1. Lege eine Datei unter `./cookies/youtube.txt` ab.
2. Aktiviere in `docker-compose.yml` diese Umgebungsvariable:

```yaml
environment:
  YTDLP_COOKIES_FILE: /app/cookies/youtube.txt
```

Die Cookies-Datei muss im Netscape/Mozilla-Format vorliegen.

## Hinweis zur MP3-Erzeugung

MP3 wird in dieser Version nicht mehr durch den yt-dlp-Postprozessor erzeugt, sondern nach dem Download explizit mit FFmpeg konvertiert. Das ist robuster, wenn yt-dlp zwar Audio laden kann, aber der interne Postprocessing-Schritt zickt.
