# Worklog — SC Session-Cookie Fix (Option B)

**Stand:** 2026-06-03  
**Branch:** main  
**HEAD / Rollback-Tag:** `624cda9` / `sc-integration-v1-rollback`

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

## Was funktioniert (Stand Rollback-Punkt)

| Feature | Status |
|---------|--------|
| `POST /api/sc-verify` — Token-Validierung via SC API v2 `/me` | ✅ |
| `POST /api/sc-verify` — Go+-Erkennung via `consumer_subscription.product.id` | ✅ |
| Preflight-Check — Download ohne Token bei Go+-Track → blockiert | ✅ |
| `SC_TEST_TRACK_URL` gesetzt auf `karma-extended-mix` | ✅ |
| `detectSource` erkennt `m.soundcloud.com`, `on.soundcloud.com` | ✅ |
| Frontend: Settings-Panel, SC-Banner, Token-Speicherung in localStorage | ✅ |
| **Tatsächlicher Download mit Token** | ❌ |

---

## Ursache des Download-Fehlers

yt-dlp sendet beim SC-Download nur:
```
Cookie: oauth_token=...; connect_session=1; soundcloud_session_hint=1
```

**Fehlend:** `_soundcloud_session` — wird von `api-auth.soundcloud.com/connect/session` gesetzt,
aber wegen fehlendem `Domain`-Attribut im Set-Cookie-Header nicht an `api-v2.soundcloud.com` weitergeleitet.
SC's Stream-API (`/media/.../stream/hls|progressive`) benötigt diesen Session-Cookie → 404.

**Wichtig:** yt-dlp's client_id (`i53MAi5VcJrq7u38ZL1SOZtDi17ds1A0`) ist identisch mit
SC's aktuellem Web-Client — das ist NICHT das Problem.

---

## Option B — Ziel der nächsten Session

**Ansatz:** Vor dem yt-dlp-Spawn einen Session-Exchange gegen SC's Auth-API machen,
`_soundcloud_session`-Cookie extrahieren und in die temp Cookie-Datei schreiben.

**Ablauf:**
1. `POST https://api-auth.soundcloud.com/connect/session?client_id=i53MAi5VcJrq7u38ZL1SOZtDi17ds1A0`
   - Body: `{"session": {"access_token": "<oauth_token>"}}`
   - Response-Header `set-cookie` → `_soundcloud_session=...` extrahieren
2. Cookie-Datei anreichern: zusätzlich zur `oauth_token`-Zeile die `_soundcloud_session`-Zeile einfügen
3. yt-dlp mit dieser erweiterten Cookie-Datei starten

**Scope:**
- `writeTempCookieFile` erweitern oder neue `enrichCookieFile`-Funktion
- Neuer Helper `fetchScSession(oauthToken)` → gibt `{ sessionCookie }` zurück
- Fehler bei Session-Fetch: graceful degradation (Warnung im Job-Log, Download trotzdem versuchen)
- Betrifft: `server.js` — ca. 30 Zeilen

**Test-Protokoll nach Implementierung:**
```bash
# 1. Verify funktioniert noch
curl -X POST http://localhost:3000/api/sc-verify -H "Content-Type: application/json" \
  -d '{"token":"2-309355-98721513-u1IAMEmKQUaBNV7"}'
# Erwartet: {"valid":true,"username":"Paul xIx","goPlus":true}

# 2. Download mit Token startet und läuft durch
curl -X POST http://localhost:3000/api/download -H "Content-Type: application/json" \
  -d '{"url":"https://soundcloud.com/vinivicimusic/karma-extended-mix","format":"mp3","quality":"320","scToken":"2-309355-98721513-u1IAMEmKQUaBNV7"}'
# Erwartet: status=done, downloadName=*.mp3

# 3. Preflight ohne Token blockt weiterhin
curl -X POST http://localhost:3000/api/download -H "Content-Type: application/json" \
  -d '{"url":"https://soundcloud.com/vinivicimusic/karma-extended-mix","format":"mp3","quality":"320"}'
# Erwartet: status=error, error enthält "Token benötigt"
```

**Fallback wenn B scheitert:**
→ Option A: `YTDLP_COOKIES_FILE` mit exportierten Browser-Cookies aus eingeloggtem SC-Tab
→ Option C: Kompletter SC-Download ohne yt-dlp via SC API v2 direkt

---

## SC Auth-API — bekannte Details

```
Endpoint: POST https://api-auth.soundcloud.com/connect/session
Query:    ?client_id=i53MAi5VcJrq7u38ZL1SOZtDi17ds1A0
Body:     Content-Type: application/json
          {"session": {"access_token": "<oauth_token>"}}
Response: 200 OK
Set-Cookie: connect_session=1; Path=/; Domain=.soundcloud.com; Secure
Set-Cookie: soundcloud_session_hint=1; Path=/; Domain=.soundcloud.com; Secure
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
Domain auf `.soundcloud.com` setzen (mit Punkt) damit yt-dlp es an api-v2.soundcloud.com sendet.
