# yt-dlp-webui -- Codex-Regeln

<!-- ============================================================ -->
<!-- CODEX GLOBAL TEMPLATE — eingebettet in jedes Projekt-CODEX.md -->
<!-- update via: dev update -Scope template                        -->
<!-- ============================================================ -->

## Pflicht vor jeder Implementierung

1. **`PFLICHTENHEFT.md` lesen** — einzige Source of Truth für alle Spezifikationen
2. **Nur implementieren was explizit spezifiziert ist** — kein YAGNI-Verstoß
3. **Kein Hardcoding** — alles aus `.env` oder zentralen Konstantenmodulen
4. **Type Hints / JSDoc überall** — keine impliziten `any`-Typen ohne Begründung

## Universelle Verbote (gelten immer)

- Passwörter, API-Keys, IPs, Pfade hardcoden → **STOPP, sofort abbrechen**
- `PFLICHTENHEFT.md` selbst ändern → **STOPP, an Claude zurückgeben**
- Workarounds implementieren → **STOPP, Problem dokumentieren, an Claude zurückgeben**
- Über Scope der Aufgabe hinausgehen → **STOPP**

## Falls etwas nicht umgesetzt werden kann

**Nicht improvisieren. Nicht selbst am PFLICHTENHEFT ändern.**

1. Problem exakt dokumentieren: Was geht nicht? Welcher Fehler / welche Einschränkung?
2. Vorschlag formulieren: Welche Änderung wäre nötig und warum?
3. An Claude zurückmelden — Claude übernimmt Prüfung und Entscheidung
4. Bei komplexen Fragen: Claude brainstormt mit dem User

**Codex-Eigeninitiative bei Abweichungen = Fehler.**

## Security-Regeln (absolut)

- Niemals `.env`-Datei anfassen oder Credentials hardcoden
- Kein Code der Passwörter loggt oder ausgibt
- Absolute Pfade (`C:\`, `D:\`, `/home/`) nur aus Konfiguration, nie als Literal

## Namenskonventionen

Siehe `PFLICHTENHEFT.md` für projektspezifische Konventionen. Global:
- Konstanten: `UPPER_SNAKE_CASE`
- Env-Variablen: `UPPER_SNAKE_CASE`
- Docker Container: `{projekt}_{service}`

<!-- ============================================================ -->
<!-- ENDE CODEX GLOBAL TEMPLATE                                    -->
<!-- ============================================================ -->


---

## Projekt-spezifische Technologie-Standards (node)

<!-- Ergaenze hier projektspezifische Standards nach dem ersten Brainstorming -->

## Shared-Model-Pfade

<!-- Nach erstem Setup hier die wichtigsten Modell-Pfade eintragen -->

## Source of Truth

PFLICHTENHEFT.md -- vor jeder Implementierung lesen.
