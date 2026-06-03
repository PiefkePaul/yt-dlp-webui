# yt-dlp-webui -- Projekt-Regeln

<!-- ============================================================ -->
<!-- GLOBAL TEMPLATE — eingebettet in jede Projekt-CLAUDE.md      -->
<!-- Nicht manuell bearbeiten — update via: dev update -Scope template -->
<!-- ============================================================ -->

## 🏗 Block 1: System-Infrastruktur (immer verfügbar)

```
NAS:            192.168.178.254
                SSH: User=Paul, Pass=aus .env (NAS_SSH_PASS)
                ⚠ Docker-Befehle auf der NAS benötigen sudo
Camoufox MCP:   https://camoufox.scholz-cloud.de/mcp
Docker Host:    lokal + Portainer (NAS)
NAS-Zugriff von Windows (UNC): NAS_SHARE_UNC, NAS_SHARE_DOCKER, NAS_SHARE_DATA (aus .env)
NAS-Zugriff via SSH (Pfade auf NAS): NAS_SSH_BASE_PATH=/volume1, NAS_SSH_DOCKER_PATH, NAS_SSH_DATA_PATH (aus .env)
Authentifizierung: NAS_SSH_USER, NAS_SSH_PASS, NAS_SHARE_USER, NAS_SHARE_PASS (alle aus .env)
```
→ Niemals hardcoden — immer .env-Referenz verwenden.

---

## 🚫 Block 2: Universelle Entwicklungsregeln (nicht verhandelbar)

**Nie:**
- Passwörter, API-Keys, IPs, Pfade, Ports, URLs hardcoden → immer `.env` / Config-Datei
- Workarounds → Stopp, Analyse mit CocoIndex, Brainstorming mit User, echte Lösung
- Code ohne vorherigen Plan + explizite User-Bestätigung implementieren
- `PFLICHTENHEFT.md` selbstständig ändern (auch Codex nicht)
- Over-Engineering / YAGNI-Verstöße
- Toten Code, Copy-Paste-Logik, undokumentierte Funktionen

**Immer:**
- Plan vor Code: `ccc search` → Brainstorming → Plan → User-OK → Implementierung
- Eine Datei = eine klar definierte Verantwortung
- Klare Funktions-Signaturen, Single Responsibility
- User bei Architekturentscheidungen einbeziehen

---

## 🔐 Block 3: Security & GitHub-Push-Regeln

**Vor JEDEM `git push` — Pflicht-Checkliste:**
1. `git diff --cached` scannen auf verbotene Muster:
   - `password=`, `api_key=`, `secret=`, `token=`, Bearer-Token-Strings
   - Hardcodierte IPs: `192.168.`, `10.0.`, `172.16.`
   - Absolute lokale Pfade: `C:\`, `D:\`, `/home/`, `/root/`
   - `.env`-Dateien gestaged?
2. Niemals gestaged: `.env`, `data/`, `__pycache__/`, `*.log`, `*.db`, `.venv/`, `node_modules/`
3. `git status` — keine unerwarteten Dateien
4. **Nie vor Abnahme pushen** (außer explizit vom User gewünscht)
5. **Nie direkt auf `main` arbeiten** bei neuen Features

**Pflicht-.gitignore-Einträge** (von bootstrap generiert — nie entfernen):
```
.env
.env.local
data/
*.log
*.db
*.sqlite
__pycache__/
.venv/
node_modules/
.mypy_cache/
.ruff_cache/
dist/
build/
```

---

## 🏷 Block 4: Namenskonventionen

| Kontext | Konvention | Beispiel |
|---|---|---|
| Python-Dateien | `snake_case` | `user_service.py` |
| JS/TS-Dateien | `kebab-case` | `user-service.ts` |
| Python-Variablen | `snake_case` | `user_id` |
| JS/TS-Variablen | `camelCase` | `userId` |
| Konstanten | `UPPER_SNAKE_CASE` | `MAX_RETRY_COUNT` |
| Env-Variablen | `UPPER_SNAKE_CASE` | `NAS_IP` |
| Docker Container | `{projekt}_{service}` | `healthai_api` |
| Docker Volumes | `{projekt}_{name}_data` | `healthai_postgres_data` |
| Git-Branch | `{type}/{name}` | `feature/user-auth` |
| Git-Tag | semver | `v1.2.3` |

---

## 📝 Block 5: Git-Commit-Standards

**Conventional Commits — Pflichtformat:**
```
type(scope): kurze beschreibung im Präsens, Deutsch oder Englisch

Typen: feat | fix | docs | refactor | test | chore | ci | perf
Scope: betroffenes Modul/Komponente (optional)
```

**Regeln:**
- Kein Force-Push auf `main`
- Neue Features immer auf eigenem Branch (`feature/...`), nie direkt auf `main`
- Nie vor Abnahme pushen (außer explizit gewünscht)
- Bei Docker-Projekten: GitHub Actions baut automatisch Beta/Release-Images (→ Block 6)

---

## 🐳 Block 6: Docker-Standards

- `docker-compose.yml` für Multi-Service (kein manuelles `docker run`)
- Image-Versionen immer pinnen (kein `:latest` in Produktion)
- Health-Checks für alle Services Pflicht
- Named Volumes (nie anonymous)

**Port-Registry — Pflicht bei jeder Port-Vergabe:**
1. `dev ports-scan` ausführen (lokal + NAS) bevor Ports zugewiesen werden
2. `C:\Users\PaulScholz\scripts\ports.json` prüfen — zwei getrennte Tabellen:
   - `local`: Ports auf diesem PC
   - `nas`: Ports auf der NAS (192.168.178.254) — separater Port-Raum!
3. Nach Vergabe: `ports.json` sofort aktualisieren
4. Bei Port-Änderungen: `ports.json` sofort aktualisieren

**GitHub Actions (automatisch bei Docker-Projekten):**
- Feature/Fix-Branch → `beta-{short-sha}` Image → Docker Hub
- `main`-Branch → `latest` + `main-{short-sha}` → Docker Hub
- Git-Tag `v*.*.*` → versioniertes Release (`1.2.3`, `1.2`, `latest`) → Docker Hub
- Private Repos → kein Docker Hub Push, nur lokaler Build-Check

---

## 📋 Block 7: Dokumentationsstandards

**`PFLICHTENHEFT.md` = einzige Source of Truth**
- Vor jeder Session lesen
- Nach jeder Implementierung Status aktualisieren
- Status-Marker: `📋` Geplant · `🔄` In Arbeit · `🧪` Testing · `✅` Fertig · `❌` Abgebrochen

**Docstring-Pflicht** bei jeder Funktion/Methode:
```python
"""Was diese Funktion tut.
Args:    param1 (Typ): Beschreibung
Returns: Typ: Beschreibung
Depends: service_x, module_y
"""
```

**`session_state.md`** — am Ende jeder Session befüllen:
- Erledigte Tasks dieser Session
- Nächster konkreter Schritt
- Offene Blocker oder offene Fragen

---

## 🔧 Block 8: Tool-Hierarchie (verbindlich)

| Prio | Tool | Wann einsetzen |
|---|---|---|
| 1 | **Read** | Dateipfad exakt bekannt |
| 2 | **Serena LSP** | Symbole, Definitionen, Referenzen, Typen, Refactoring |
| 3 | **CocoIndex** `ccc search` | Semantisch: Konzepte, "Was tut X?", Zusammenhänge |
| 4 | **Grep** | Exakte String-/Pattern-Suche |
| 5 | **Glob** | Dateinamen-Muster, Verzeichnisstruktur |
| 6 | **Agent:Explore** | Offene explorative Suche über viele Quellen |

**CocoIndex Nutzung:**
- Projekt-Suche: `ccc search --path "D:\Development\{PROJEKT_NAME}" <query>`
- Global suchen: `ccc search <query>`

**Serena PFLICHT** bei: Symbol-Lookup, "Wo ist X definiert?", Typ-Prüfung, Refactoring.
**Serena NICHT** für: semantische Konzeptsuche → dafür CocoIndex.

---

## ⏱ Block 9: Session-Protokoll

**Session-Start (Reihenfolge):**
1. `PFLICHTENHEFT.md` lesen
2. `session_state.md` lesen — was war der letzte Stand?
3. `ccc describe .` — Index-Freshness prüfen

**Session-Ende (Reihenfolge):**
1. Docstrings + Inline-Kommentare fertigstellen
2. `PFLICHTENHEFT.md` Status-Marker aktualisieren
3. `session_state.md` befüllen (erledigt / nächster Schritt / Blocker)
4. `ccc index` — CocoIndex aktualisieren
5. `git commit` (mit Pflicht-Checkliste aus Block 3)
6. `ScheduleWakeup 1200` bei Sessions > 30 Minuten aktiver Arbeit

---

## 🤖 Block 10: Codex-Regeln

**Codex einsetzen für:**
- Einzelne, klar spezifizierte Funktionen nach fertigem Plan
- Isolierte Code-Reviews einer Komponente
- Test-Boilerplate nach Spezifikation
- Kleine abgegrenzte Refactorings (eine Datei, klare Anforderung)

**Codex NICHT für:**
- Architekturentscheidungen oder Planungsarbeit
- Implementierungen die mehrere Module betreffen
- Alles was Brainstorming mit dem User erfordert

**Jede Codex-Anweisung muss enthalten:**
1. Verweis auf `PFLICHTENHEFT.md` (einzige Source of Truth)
2. Exakte Funktion(en) die implementiert werden
3. Relevante Datenmodelle (Pfade + Typen)
4. Erwartete Tests

**Codex ändert `PFLICHTENHEFT.md` niemals selbst.** Bei Problemen: dokumentieren, an Claude zurückgeben.

---

## 🌐 Block 11: MCP-Server Registry

| MCP | Zweck | Wann einsetzen |
|---|---|---|
| `cocoindex-code` | Semantische Code-Suche | **Jedes Projekt** |
| `serena` | LSP, Symbol-Navigation | **Jedes Projekt** |
| `context7` | Library-Dokumentation | **Jedes Projekt** bei Lib-Fragen |
| `ssh-mcp-server` | NAS/Server-Befehle (sudo für Docker!) | Bei NAS-Interaktion |
| `portainer` | Docker-Management | Bei Docker-Projekten |
| `camoufox` | Browser-Automation | Bei Web-Scraping |
| `MCP_DOCKER` | MCP-Discovery, neue MCPs suchen | Bei neuen MCP-Suchen |
| `github` | Repo-Operationen | Bei GitHub-Workflows |
| `playwright` | E2E-Tests, Browser-Automation | Bei Web-Projekten |
| `supabase` | DB-Management | Bei Supabase-Projekten |

---

## 📦 Block 12: Globale Registry-Pflichten

**Bei jeder Session:**
- `projects.json` lesen: aktueller Projekt-Status, offene Tasks
- Bei Port-Vergabe: `ports.json` prüfen (lokal **und** NAS separat!)
- Bei Port-Änderungen: `ports.json` sofort aktualisieren
- Bei neuen Dateien: `.gitignore` auf Vollständigkeit prüfen

`projects.json`: `C:\Users\PaulScholz\scripts\projects.json`
`ports.json`: `C:\Users\PaulScholz\scripts\ports.json`

<!-- ============================================================ -->
<!-- ENDE GLOBAL TEMPLATE                                          -->
<!-- ============================================================ -->


---

<!-- ============================================================ -->
<!-- PROJEKT-SPEZIFISCH                                            -->
<!-- ============================================================ -->

## Projekt-Info

- **Name:** yt-dlp-webui
- **Stack:** node
- **Sprachen (Serena):** javascript
- **Primary CocoIndex Scope:** D:\Development\yt-dlp-webui

## CocoIndex Setup

- CLI: C:\Users\PaulScholz\.local\bin\ccc.exe
- Globaler Index: D:\Development\_global_ccc
- Projekt-Suche: ccc search --path "D:\Development\yt-dlp-webui" ^<query^>
- Reindex: ccc index (aus D:\Development\_global_ccc)
- Scheduled Task: yt-dlp-webui-CCC-Reindex (stuendlich, Fallback)

## MCP-Server (dieses Projekt)

Konfiguriert in .claude\settings.local.json:
- cocoindex-code
- serena
- context7
- playwright

## First-Run Status

Nach erstmaligem Setup: first_run in .claude\settings.local.json auf false setzen.
