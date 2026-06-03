# Design: SC Session-Cookie Fix + Client-Side Credential Encryption

**Datum:** 2026-06-03  
**Branch:** feature/sc-session-cookie-fix  
**Status:** Abgenommen

---

## Problem

yt-dlp schlägt beim Download von SoundCloud Go+-Tracks fehl (HTTP 404), weil der
`_soundcloud_session`-Cookie fehlt. SC's Stream-API benötigt diesen Cookie, der von
`api-auth.soundcloud.com/connect/session` gesetzt wird — aber ohne explizites `Domain`-Attribut
im `Set-Cookie`-Header, weshalb er nicht automatisch an `api-v2.soundcloud.com` weitergeleitet wird.

Zusätzlich werden Nutzer-Credentials (oauth_token) aktuell im Klartext in `localStorage` gespeichert.

---

## Scope

- `server.js` — neue Funktionen, angepasste Endpoints
- `public/app.js` — localStorage-Handling, Settings-UX, Request-Bodies
- `.env.example` / `.env.template` — neue Env-Vars

---

## Abschnitt 1: Neue Server-Komponenten

### Env-Vars

```
SC_CLIENT_ID=i53MAi5VcJrq7u38ZL1SOZtDi17ds1A0   # Fallback; per .env überschreibbar
SESSION_ENCRYPTION_KEY=<32-Byte-Hex>              # Pflicht; Server startet nicht ohne
```

Key generieren:
```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### `SC_CLIENT_ID` Konstante

```js
const SC_CLIENT_ID = process.env.SC_CLIENT_ID || 'i53MAi5VcJrq7u38ZL1SOZtDi17ds1A0';
```

Konfigurierbar, da SC diese ID für yt-dlp-Requests ggf. sperren kann. Der bekannte Wert
bleibt als Fallback, da er SC's eigenem Web-Client entspricht.

### `fetchScSession(oauthToken)` → `string | null`

- `POST https://api-auth.soundcloud.com/connect/session?client_id=${SC_CLIENT_ID}`
- Body: `{"session": {"access_token": "<oauthToken>"}}`
- Nutzt Node's eingebautes `fetch`
- Extrahiert `_soundcloud_session`-Wert aus `set-cookie`-Response-Header
- Gibt Cookie-Wert als String zurück — oder `null` bei jedem Fehler (nie throw)
- Loggt weder Token noch Cookie-Wert

### `writeTempCookieFile(dirPath, token, sessionCookie = null)` — erweitert

Optionaler dritter Parameter. Netscape-Format:
```
# Netscape HTTP Cookie File
.soundcloud.com	TRUE	/	TRUE	2147483647	oauth_token	<token>
.soundcloud.com	TRUE	/	TRUE	<now+604800>	_soundcloud_session	<sessionCookie>
```
Zweite Zeile nur wenn `sessionCookie` vorhanden.  
Datei-Permissions: `{ mode: 0o600 }` (lesbar nur für aktuellen Prozess).

### `encryptForClient(plaintext)` → `string`

AES-256-GCM mit zufälligem IV (12 Byte). Format: `<iv_b64>:<tag_b64>:<cipher_b64>`.

### `decryptFromClient(encrypted)` → `string | null`

Umkehrung von `encryptForClient`. Gibt `null` zurück bei: leerem Input, falschem Format,
ungültigem Auth-Tag (Manipulation erkannt), jedem anderen Fehler — nie throw.

### `SESSION_ENCRYPTION_KEY` Startup-Check

Fehlt der Key beim Start:
```
SESSION_ENCRYPTION_KEY fehlt in .env
Key generieren: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Server bricht den Start ab.

---

## Abschnitt 2: Data Flow — `/api/download`

**Request-Body (neu):**
```json
{
  "url": "...", "format": "mp3", "quality": "320",
  "encryptedToken": "<ciphertext>",
  "encryptedSession": "<ciphertext>"
}
```

**Server-Logik (SC-Branch):**
1. `decryptFromClient(encryptedToken)` → `oauthToken`
   - `null` → Job-Error: `"Token ungültig oder abgelaufen — bitte neu verifizieren."`
2. `decryptFromClient(encryptedSession)` → `sessionCookie` (kann `null` sein)
3. Wenn `sessionCookie === null`:
   - `appendEvent(job, 'SC-Session wird geholt...')`
   - `sessionCookie = await fetchScSession(oauthToken)`
   - Wenn immer noch `null`: `appendEvent(job, 'Session-Cookie nicht verfügbar, Download wird trotzdem versucht...')`
   - Neuen `sessionCookie` verschlüsseln → `encryptedSession` in Response
4. `writeTempCookieFile(targetDir, oauthToken, sessionCookie)`

**Response (Start):**
```json
{ "id": "<uuid>", "encryptedSession": "<ciphertext-oder-fehlt>" }
```
`encryptedSession` nur vorhanden wenn Server frisch gefetchte Session zurückgibt.

**Cookie-Datei-Cleanup:**
`sc.cookies` wird sofort nach `child.on('close', ...)` gelöscht — auf dem Erfolgs- UND
Fehlerpfad — nicht erst beim Job-TTL-Cleanup.

---

## Abschnitt 3: Data Flow — `/api/sc-verify`

Nach erfolgreicher Validierung:
1. `fetchScSession(trimmedToken)` → `sessionCookie`
2. `encryptForClient(trimmedToken)` → `encryptedToken`
3. Wenn `sessionCookie`: `encryptForClient(sessionCookie)` → `encryptedSession`

**Response (erweitert):**
```json
{
  "valid": true,
  "username": "Paul xIx",
  "goPlus": true,
  "encryptedToken": "<ciphertext>",
  "encryptedSession": "<ciphertext-oder-fehlt>"
}
```
`encryptedSession` fehlt wenn Session-Fetch fehlschlug — kein Fehler, `valid` bleibt `true`.

yt-dlp-Check in sc-verify: nutzt ebenfalls `fetchScSession` + erweitertes `writeTempCookieFile`.

---

## Abschnitt 4: Frontend-Änderungen (`public/app.js`)

### localStorage-Keys

| Alt | Neu |
|-----|-----|
| `sc_oauth_token` (Klartext) | `sc_oauth_token_enc` (Ciphertext) |
| — | `sc_session_enc` (Ciphertext) |

### Settings-Panel UX

- Gespeicherter Token wird als `"••••••••••••••"` angezeigt — nie Klartext
- "Speichern"-Button wird zu "Token entfernen" (löscht `sc_oauth_token_enc` + `sc_session_enc`)
- "Verifizieren"-Button: sendet Klartext-Input → speichert bei `valid=true` die
  `encryptedToken` + `encryptedSession` aus der Response in localStorage

### Download-Flow

- Schickt `encryptedToken` + `encryptedSession` statt `scToken`
- Wenn Response `encryptedSession` enthält → `localStorage.setItem('sc_session_enc', ...)`

---

## Abschnitt 5: Error Handling

| Situation | Verhalten |
|-----------|-----------|
| `fetchScSession` schlägt fehl | `null` zurück, nie throw |
| `decryptFromClient` manipulierter Ciphertext | `null` zurück, nie throw |
| `encryptedToken` → `null` | Job-Error: "Token ungültig oder abgelaufen — bitte neu verifizieren." |
| `encryptedSession` → `null` | Fallback: `fetchScSession`, graceful bei erneutem Fehler |
| `SESSION_ENCRYPTION_KEY` fehlt | Server-Start-Fehler mit Keygen-Anleitung |
| sc-verify Session-Fetch schlägt fehl | `encryptedSession` fehlt in Response, `valid` bleibt `true` |

---

## Abschnitt 6: Test-Protokoll

Vorbedingung: `SESSION_ENCRYPTION_KEY=d29ea4ebf361d8ff1d4b1d08eb452dc5` in `.env` (Test-Key).

**Test 1 — sc-verify gibt verschlüsselte Werte zurück:**
```bash
curl -s -X POST http://localhost:3000/api/sc-verify \
  -H "Content-Type: application/json" \
  -d '{"token":"2-309355-98721513-u1IAMEmKQUaBNV7"}' | jq .
# Erwartet: valid=true, username="Paul xIx", goPlus=true,
#           encryptedToken="<ciphertext>", encryptedSession="<ciphertext>"
```

**Test 2 — Download mit verschlüsselten Werten durchläuft komplett:**
```bash
curl -s -X POST http://localhost:3000/api/download \
  -H "Content-Type: application/json" \
  -d '{"url":"https://soundcloud.com/vinivicimusic/karma-extended-mix",
       "format":"mp3","quality":"320",
       "encryptedToken":"<from-test-1>","encryptedSession":"<from-test-1>"}' | jq .
# Erwartet: id=<uuid> → /api/status/<id> pollen bis status=done, downloadName=*.mp3
```

**Test 3 — Preflight ohne Token blockt weiterhin:**
```bash
curl -s -X POST http://localhost:3000/api/download \
  -H "Content-Type: application/json" \
  -d '{"url":"https://soundcloud.com/vinivicimusic/karma-extended-mix",
       "format":"mp3","quality":"320"}' | jq .
# Erwartet: status=error, error enthält "Token benötigt"
```

**Test 4 — Manipulierter Ciphertext wird abgelehnt:**
```bash
curl -s -X POST http://localhost:3000/api/download \
  -H "Content-Type: application/json" \
  -d '{"url":"https://soundcloud.com/vinivicimusic/karma-extended-mix",
       "format":"mp3","quality":"320",
       "encryptedToken":"AAABBBCCC_invalid"}' | jq .
# Erwartet: status=error, error enthält "Token ungültig oder abgelaufen"
```

---

## Module Exports (erweitert)

```js
module.exports = {
  app, startServer, buildPublicClientConfig, verifyRequiredBinaries,
  detectSource, buildScArgs, buildYtArgs,
  writeTempCookieFile, fetchScSession, encryptForClient, decryptFromClient
};
```
