# Design: Phase 1 — SC DRM-Erkennung + UI-Overhaul + Release v1.1.0

**Datum:** 2026-06-03  
**Branch:** feature/sc-session-cookie-fix  
**Status:** Abgenommen

---

## Hintergrund

SoundCloud Go+-Tracks sind seit kurzem mit Apple FairPlay DRM geschützt (`SAMPLE-AES`, `skd://`-Key-URI). Die unverschlüsselten Formate (`hls`, `progressive`) geben 404 zurück. yt-dlp kann FairPlay-verschlüsselte Streams nicht entschlüsseln. Phase 2 wird einen eigenen SC-Downloader implementieren.

Phase 1 stellt sicher dass:
- Alles außer Go+-DRM-Tracks funktioniert
- DRM-Tracks proaktiv und verständlich abgelehnt werden
- Die UI die neuen Credential-Flows (AES-256-GCM Encryption aus dem vorherigen Feature) korrekt darstellt
- Ein sauberer Release v1.1.0 entsteht

---

## Scope

- `server.js` — neue Funktion `checkScTrackFormats`, Fehlerbehandlung in `/api/download`
- `public/index.html` — Settings-Modal, ⚙-Button
- `public/app.js` — Modal-Logik, SC-Banner-Logik
- `PFLICHTENHEFT.md` — aktualisieren
- `package.json` — Version bestätigen (bereits 1.1.0)

---

## Abschnitt 1: Server — `checkScTrackFormats`

### Neue Funktion

```js
async function checkScTrackFormats(trackUrl, oauthToken) {
  // Returns: { canDownload: true }
  //       or { canDownload: false, reason: 'drm' }
}
```

**Ablauf:**
1. `GET https://api-v2.soundcloud.com/resolve?url=<trackUrl>&client_id=${SC_CLIENT_ID}`
   - Header: `Authorization: OAuth <oauthToken>`
2. Response: Track-Objekt mit `media.transcodings[]`
3. Prüfe ob mindestens ein Transcoding mit `format.protocol === 'hls'` ODER `format.protocol === 'progressive'` vorhanden ist
4. **Nur DRM-Formate** (`cbc-encrypted-hls`, `ctr-encrypted-hls`) → `{ canDownload: false, reason: 'drm' }`
5. **Unverschlüsseltes Format gefunden** → `{ canDownload: true }`
6. **Jeder Fehler** (Netzwerk, Parsing, non-200, leere Transcodings) → `{ canDownload: true }` (fail-open)

**Wann aufgerufen:** In `/api/download`, SC-Branch, nach `decryptFromClient(encryptedToken)`, vor yt-dlp-Spawn.

### Fehlermeldungen

| Situation | Job-Error-Text |
|-----------|----------------|
| `canDownload: false, reason: 'drm'` | `"Dieser Track ist DRM-geschützt und kann derzeit nicht heruntergeladen werden. Go+-Support ist in Vorbereitung."` |
| yt-dlp Exit-Code ≠ 0 UND `rawLog` enthält `404` UND SC-Track | `"Download fehlgeschlagen — der Track könnte DRM-geschützt sein. Bitte erneut versuchen oder einen anderen Track wählen."` |

Der DRM-Fehlerfall beendet den Job sofort (`status: 'error'`) ohne yt-dlp zu spawnen.

### `checkScTrackFormats` im `module.exports`

```js
module.exports = {
  app, startServer, buildPublicClientConfig, verifyRequiredBinaries,
  detectSource, buildScArgs, buildYtArgs,
  writeTempCookieFile, fetchScSession, encryptForClient, decryptFromClient,
  checkScTrackFormats
};
```

---

## Abschnitt 2: UI — Settings-Modal

### `index.html` — Änderungen

**Settings-Button** (ersetzt den alten Balken-Button):
```html
<button id="settingsToggle" type="button" class="settings-toggle" aria-label="Einstellungen">⚙</button>
```

CSS:
```css
.settings-toggle {
  background: var(--panel-2);
  border: 1px solid var(--border);
  color: var(--muted);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 0.85rem;
  min-width: 0;
  width: auto;
  cursor: pointer;
  flex-shrink: 0;
}
.settings-toggle:hover { color: var(--text); }
```

**Settings-Modal** (ersetzt `#settingsPanel`):
```html
<div id="settingsModal" class="modal-overlay hidden" role="dialog" aria-modal="true">
  <div class="modal-box">
    <div class="modal-header">
      <span>⚙ Einstellungen</span>
      <button id="settingsClose" type="button" class="modal-close" aria-label="Schließen">✕</button>
    </div>
    <div class="label">SoundCloud-Token</div>
    <p class="muted" style="margin:0;font-size:0.82rem;line-height:1.5">
      Benötigt für private oder altersgeschützte Tracks.<br>
      <code>DevTools → Local Storage → soundcloud.com → oauth_token</code>
    </p>
    <div class="settings-row">
      <input id="scTokenInput" type="password" placeholder="2-123456-789012345-ABCDEFGH..." />
      <button id="scTokenSave" type="button">Speichern</button>
      <button id="scTokenVerify" type="button" class="secondary" style="min-width:0">Prüfen</button>
    </div>
    <div id="scVerifyResult" class="verify-result"></div>
    <p class="muted" style="margin:0;font-size:0.78rem">
      Token wird nur lokal im Browser gespeichert — nie dauerhaft auf dem Server.
    </p>
  </div>
</div>
```

CSS:
```css
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  backdrop-filter: blur(4px);
}
.modal-box {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 24px;
  width: min(420px, 90vw);
  display: grid;
  gap: 14px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 700;
  font-size: 1rem;
}
.modal-close {
  background: none;
  border: none;
  color: var(--muted);
  font-size: 1rem;
  cursor: pointer;
  min-width: 0;
  width: auto;
  padding: 2px 6px;
}
.modal-close:hover { color: var(--text); }
```

### `app.js` — Modal-Logik

```js
// Modal öffnen/schließen
settingsToggle.addEventListener('click', openSettingsModal);
settingsClose.addEventListener('click', closeSettingsModal);
settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) closeSettingsModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSettingsModal();
});

function openSettingsModal() {
  settingsModal.classList.remove('hidden');
  // Token-State initialisieren: wenn Token gesetzt → masked anzeigen
  if (hasStoredCredentials()) {
    scTokenInput.value = '';
    scTokenInput.placeholder = '••••••••••••••';
    scTokenSave.textContent = 'Token entfernen';
  } else {
    scTokenInput.placeholder = '2-123456-789012345-ABCDEFGH...';
    scTokenSave.textContent = 'Speichern';
  }
}

function closeSettingsModal() {
  settingsModal.classList.add('hidden');
  scTokenInput.value = '';
  scVerifyResult.textContent = '';
  scVerifyResult.className = 'verify-result';
}
```

---

## Abschnitt 3: UI — SC-Banner

### Verhalten

- **Erscheint** wenn URL-Input eine SoundCloud-URL enthält UND kein Token gesetzt ist (`!hasStoredCredentials()`)
- **Verschwindet** wenn URL gewechselt wird (nicht mehr SC) ODER Token gesetzt wird
- **"Token setzen →"** öffnet das Settings-Modal direkt

### `app.js` — Banner-Logik

```js
// URL-Input: Banner aktualisieren
document.getElementById('url').addEventListener('input', updateScBanner);

function updateScBanner() {
  const url = document.getElementById('url').value;
  const isSC = detectSoundCloud(url);
  const needsBanner = isSC && !hasStoredCredentials();
  scBanner.classList.toggle('hidden', !needsBanner);
}

// Banner-Button öffnet Modal
scBannerTokenBtn.addEventListener('click', openSettingsModal);
```

`updateScBanner()` wird auch aufgerufen nach:
- Erfolgreichem Token-Verify (Token wird gesetzt → Banner weg)
- Token-Entfernen (Token weg → Banner erscheint wenn SC-URL)

---

## Abschnitt 4: Release v1.1.0

1. `package.json` Version `1.1.0` bestätigen (bereits gesetzt)
2. Feature-Branch in `main` mergen
3. `PFLICHTENHEFT.md` aktualisieren:
   - SC Session-Cookie Fix: `✅ Fertig` (AES-256-GCM implementiert, fetchScSession vorhanden)
   - Client-Side Credential Encryption: `✅ Fertig`
   - SC Go+-Download: `❌ Nicht unterstützt` — FairPlay DRM, proaktive Erkennung, Phase 2 geplant
   - Bekannte Probleme aktualisieren
4. Git-Tag `v1.1.0` auf `main`
5. CI/CD pusht automatisch zu Docker Hub + GHCR

---

## Abschnitt 5: Tests

### Unit-Tests (ergänzen)

`test/unit.test.js`:
- `checkScTrackFormats` — DRM-only → `{ canDownload: false, reason: 'drm' }`
- `checkScTrackFormats` — hls vorhanden → `{ canDownload: true }`
- `checkScTrackFormats` — API-Fehler → `{ canDownload: true }` (fail-open)

### Manuelle Smoke-Tests

1. SC öffentlicher Track → Download startet (kein DRM-Block)
2. Go+-Track (Karma Extended Mix) → sofortiger Job-Error mit DRM-Meldung
3. SC-URL eingeben ohne Token → Banner erscheint
4. Settings-Modal öffnen/schließen → kein Layout-Shift, ESC schließt
5. Token setzen via Modal → Banner verschwindet

---

## Modul-Exports (final)

```js
module.exports = {
  app, startServer, buildPublicClientConfig, verifyRequiredBinaries,
  detectSource, buildScArgs, buildYtArgs,
  writeTempCookieFile, fetchScSession, encryptForClient, decryptFromClient,
  checkScTrackFormats
};
```
