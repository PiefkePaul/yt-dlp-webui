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
