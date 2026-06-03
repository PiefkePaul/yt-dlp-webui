# Worklog — SC Session-Cookie Fix (Option B)

---

## Rollback

Falls Option B nicht funktioniert:

```bash
git checkout sc-integration-v1-rollback
# oder
git reset --hard 624cda9
```

Dann Docker neu starten:
```bash
cd docker && docker compose down && docker compose up -d
```

---

## Checkpoint: 2026-06-03 — Tasks 1–8 abgeschlossen

**Branch:** `feature/sc-session-cookie-fix`  
**HEAD:** `7ed8e8f`  
**Status:** Implementation vollständig, Unit-Tests grün, finale Code-Review abgeschlossen — offene Issues vor Task 9

### Ziel dieser Session

SC Go+-Downloads schlagen fehl, weil `_soundcloud_session`-Cookie fehlt.

Option B: Vor dem yt-dlp-Spawn `fetchScSession()` aufrufen, Cookie extrahieren und in
Netscape-Cookie-Datei schreiben. Zusätzlich AES-256-GCM-Encryption für Credentials im Frontend.

### Abgeschlossene Arbeit (Tasks 1–8)

| Task | Beschreibung | Status |
|------|--------------|--------|
| 1 | Test-Infrastruktur: `test/unit.test.js`, `package.json` test-script, `.env.example/.env.template` | ✅ |
| 2 | `encryptForClient` / `decryptFromClient` (AES-256-GCM) | ✅ |
| 3 | `fetchScSession(oauthToken)` → `string \| null` | ✅ |
| 4 | `writeTempCookieFile` — optionaler `sessionCookie`-Param, `0o600`, Startup-Check | ✅ |
| 5 | `/api/download` — auf `encryptedToken`/`encryptedSession` umgestellt, Cookie-Cleanup first | ✅ |
| 6 | `/api/sc-verify` — gibt `encryptedToken` + `encryptedSession` zurück | ✅ |
| 7 | `public/app.js` — verschlüsseltes localStorage, neue Settings-UX, Download-Flow | ✅ |
| 8 | Exports + Smoke-Test aktualisiert | ✅ |

### Geänderte Dateien

| Datei | Art |
|-------|-----|
| `server.js` | Geändert (crypto, fetchScSession, writeTempCookieFile, beide Endpoints, cleanup) |
| `public/app.js` | Geändert (localStorage-Encryption, Settings-UX, Download-Body) |
| `test/unit.test.js` | Neu (12 Tests: encrypt/decrypt, fetchScSession, writeTempCookieFile) |
| `scripts/smoke-test.js` | Geändert (Export-Checks für neue Funktionen) |
| `package.json` | Geändert (`"test": "node --test"` hinzugefügt) |
| `.env.example` | Geändert (`SC_CLIENT_ID`, `SESSION_ENCRYPTION_KEY`) |
| `.env.template` | Geändert (gleich wie .env.example) |
| `PFLICHTENHEFT.md` | Aktualisiert (Source of Truth) |
| `docs/superpowers/specs/2026-06-03-sc-session-cookie-fix-design.md` | Neu |
| `docs/superpowers/plans/2026-06-03-sc-session-cookie-fix.md` | Neu |

### Commit-Log (feature branch)

```
7ed8e8f chore: Exports und Smoke-Test für neue Funktionen aktualisiert
185fbfb feat(frontend): Credentials verschlüsselt in localStorage, Settings-UX aktualisiert
e838d4b feat(api): /api/sc-verify gibt verschlüsselte Credentials zurück
9827b71 feat(api): /api/download auf encryptedToken/encryptedSession umgestellt
8235514 feat(sc): writeTempCookieFile + sessionCookie, 0o600, Startup-Check, Cookie-Cleanup
bff7bba feat(sc): fetchScSession holt _soundcloud_session-Cookie von SC Auth API
7ffb6a1 feat(crypto): encryptForClient/decryptFromClient AES-256-GCM
bf316ca fix(test): SESSION_ENCRYPTION_KEY auf 64 Hex-Zeichen (256 Bit) korrigieren
4840ff2 chore: Test-Infrastruktur und .env-Vars für SC Session-Cookie Fix
```

---

## Offene Issues (aus finaler Code-Review)

### Important — müssen vor Task 9 gefixt werden

**Issue #1 — `SC_TEST_TRACK_URL` guard ist Dead Code**  
`server.js`: `SC_TEST_TRACK_URL` hat einen hardcodierten Fallback, daher ist `if (SC_TEST_TRACK_URL)` immer true.
Lösung: Fallback entfernen ODER Guard entfernen und Kommentar ergänzen, dass die Var immer gesetzt ist.

**Issue #2 — `saveEncryptedCredentials` löscht stale `sc_session_enc` nicht**  
`public/app.js`: Wenn `encryptedSession` falsy ist (Server hat keine Session zurückgegeben),
bleibt ein alter `sc_session_enc` in localStorage stehen und wird beim nächsten Download mitgeschickt.
Lösung: `localStorage.removeItem('sc_session_enc')` wenn `encryptedSession` falsy.

### Minor — können nach Task 9 gefixt werden

**Issue #3** — Session-refresh in `form.submit` nutzt direktes `localStorage.setItem` statt `saveEncryptedCredentials` (zwei Code-Pfade für denselben Key).

**Issue #4** — `writeTempCookieFile` hat kein Error-Handling um den `fs.writeFile`-Aufruf.

**Issue #5** — `getEncryptionKeyBuffer()` wirft im Fehlerfall nur beim Start, aber zur Laufzeit bei fehlender Key-Datei könnte es unbehandelte Fehler geben.

---

## Nächste Schritte

### Sofort (vor Task 9)

1. **Fix Issue #1** in `server.js`: `SC_TEST_TRACK_URL`-Guard
2. **Fix Issue #2** in `public/app.js`: stale `sc_session_enc` beim Speichern löschen
3. **(Optional) Fix Issue #3** in `public/app.js`: session-refresh unified via `saveEncryptedCredentials`

### Task 9 — Manuelles Test-Protokoll

Vorbedingung: `.env` mit `SESSION_ENCRYPTION_KEY=d29ea4ebf361d8ff1d4b1d08eb452dc5d29ea4ebf361d8ff1d4b1d08eb452dc5` (64 Hex-Chars)

```bash
# Vor Tests: Unit-Tests + Smoke-Test laufen lassen
npm test && npm run check && npm run smoke

# Test 1 — sc-verify gibt verschlüsselte Werte zurück
curl -s -X POST http://localhost:3000/api/sc-verify \
  -H "Content-Type: application/json" \
  -d '{"token":"2-309355-98721513-u1IAMEmKQUaBNV7"}' | jq .
# Erwartet: valid=true, username="Paul xIx", goPlus=true,
#           encryptedToken="<iv>:<tag>:<cipher>", encryptedSession="<iv>:<tag>:<cipher>"

# Test 2 — Download mit verschlüsselten Werten (encryptedToken/encryptedSession aus Test 1 einsetzen)
curl -s -X POST http://localhost:3000/api/download \
  -H "Content-Type: application/json" \
  -d '{"url":"https://soundcloud.com/vinivicimusic/karma-extended-mix",
       "format":"mp3","quality":"320",
       "encryptedToken":"<from-test-1>","encryptedSession":"<from-test-1>"}' | jq .
# Erwartet: { id: "<uuid>" } → GET /api/status/<id> bis status=done, downloadName=*.mp3

# Test 3 — Preflight ohne Token blockt weiterhin
curl -s -X POST http://localhost:3000/api/download \
  -H "Content-Type: application/json" \
  -d '{"url":"https://soundcloud.com/vinivicimusic/karma-extended-mix",
       "format":"mp3","quality":"320"}' | jq .
# Erwartet: status=error, error enthält "Token benötigt"

# Test 4 — Manipulierter Ciphertext wird abgelehnt
curl -s -X POST http://localhost:3000/api/download \
  -H "Content-Type: application/json" \
  -d '{"url":"https://soundcloud.com/vinivicimusic/karma-extended-mix",
       "format":"mp3","quality":"320",
       "encryptedToken":"AAABBBCCC_invalid"}' | jq .
# Erwartet: status=error, error enthält "Token ungültig oder abgelaufen"
```

### Nach Task 9

- `PFLICHTENHEFT.md`: SC Session-Cookie Fix + Client-Side Credential Encryption als ✅ Fertig markieren
- `superpowers:finishing-a-development-branch` Skill aufrufen zum Branch-Abschluss

---

## Hintergrund: Ursache des Download-Fehlers

yt-dlp sendet beim SC-Download nur:
```
Cookie: oauth_token=...; connect_session=1; soundcloud_session_hint=1
```

**Fehlend:** `_soundcloud_session` — wird von `api-auth.soundcloud.com/connect/session` gesetzt,
aber wegen fehlendem `Domain`-Attribut im Set-Cookie-Header nicht an `api-v2.soundcloud.com` weitergeleitet.
SC's Stream-API (`/media/.../stream/hls|progressive`) benötigt diesen Session-Cookie → 404.

## SC Auth-API — bekannte Details

```
Endpoint: POST https://api-auth.soundcloud.com/connect/session
Query:    ?client_id=i53MAi5VcJrq7u38ZL1SOZtDi17ds1A0
Body:     Content-Type: application/json
          {"session": {"access_token": "<oauth_token>"}}
Response: 200 OK
Set-Cookie: _soundcloud_session="<value>"; Max-Age=604800; Path=/; Secure; HttpOnly
           ↑ KEIN Domain-Attribut → nur für api-auth.soundcloud.com gültig (laut RFC)
           → muss manuell in Cookie-Datei für api-v2.soundcloud.com eingetragen werden
```

**Cookie-Datei-Format für yt-dlp (Netscape):**
```
# Netscape HTTP Cookie File
.soundcloud.com	TRUE	/	TRUE	2147483647	oauth_token	<token>
.soundcloud.com	TRUE	/	TRUE	<expire>	_soundcloud_session	<value>
```
