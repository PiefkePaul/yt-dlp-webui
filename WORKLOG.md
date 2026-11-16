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

## Checkpoint — Gitea-Hauptbranch integriert
- Gitea main b4f9608 enthält zusätzliche SoundCloud-/Metadatenfunktionen und Unit-Tests gegenüber lokalem Altstand; vollständig übernommen. Konflikte in server.js, package.json und Smoke-Test gelöst; Qualitätsfix in buildYtArgs portiert.
- PR #4 erstellt; erster CI-Lauf prüfte noch den Altstand. Neuprüfung erfolgt nach Merge des Hauptbranches.

## Checkpoint — vollständige Tests und Runner-Fix
- 65 Unit-/Helper-Tests, Smoke-Test, Demo-Build, Release-Build und API-Mock-Tests lokal erfolgreich.
- Gitea-Lauf #6 scheiterte vor Tests am defekten setup-node-Action-Cache (fehlende .licenses/npm/agent-base.dep.yml). Node-Jobs nutzen jetzt reproduzierbar node:22-bookworm als Job-Container statt setup-node.
- Wiki: vier Projektseiten angelegt, drei Betriebsseiten ausgefüllt, Projektindex ergänzt.
