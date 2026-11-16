# Worklog — yt-dlp-webui

## 2026-11-16 — Gitea-Issues
- Auftrag: alle offenen Issues bearbeiten, ausschließlich Gitea verwenden.
- Ausgangspunkt: main d1b2f49, Arbeitsbaum sauber; origin=gitea:Scholz/yt-dlp-webui.git.
- Offen: #1 Videoqualität (erzwungene YouTube-Clients); #3 Gitea Actions Migration.
- Vorhandener WIP-PR #2 wird vor Integration geprüft.
- Wiki-Skill gelesen; services/yt-dlp-webui-Seiten sind Platzhalter. Projektseiten fehlen.
- Deployment verifiziert per docker inspect: Compose-Projekt downloader, /volume1/docker/downloader/docker-compose.yaml; Container yt-dlp-webui.
- Nächster Schritt: Qualitätsfix mit Regressionstest, Workflows migrieren, lokal und auf Gitea testen, PR, Wiki aktualisieren.

## Checkpoint — Implementierung
- #1: Client-Zwang entfernt, Regressionstest für best/1080/720 ergänzt.
- #3: Gitea-Registry + Docker Hub nur Tag/manuell; Gitea-Release-API mit Tests; Demo als manuelles Artefakt; alten Runtime-Zeitplan entfernt.
- npm run verify erfolgreich; Release-Bundle/-Tests laufen. Keine Veröffentlichung/Deployment ausgelöst.
