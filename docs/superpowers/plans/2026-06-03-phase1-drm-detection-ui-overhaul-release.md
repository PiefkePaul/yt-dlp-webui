# Phase 1 — DRM-Erkennung, UI-Overhaul, Release v1.1.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SoundCloud DRM-Tracks proaktiv ablehnen, Settings-UI als Modal umbauen, Release v1.1.0 taggen.

**Architecture:** `checkScTrackFormats` prüft via SC API ob ein Track DRM-verschlüsselt ist (fail-open). Das Settings-Panel wird durch ein echtes Modal ersetzt. Die SC-Banner-Logik wird von `updateUiForSource` entkoppelt. Der Release entsteht via Git-Tag + CI/CD.

**Tech Stack:** Node.js (native `fetch`), Vanilla JS, HTML/CSS, Node test runner, git

---

## File Map

- Modify: `server.js` — neue Funktion `checkScTrackFormats`, Integration in `/api/download`, 404-Fallback, Export
- Modify: `test/unit.test.js` — 3 neue Tests für `checkScTrackFormats`
- Modify: `public/index.html` — Settings-Modal HTML + CSS, Button-Update
- Modify: `public/app.js` — Modal-Logik, Banner-Logik entkoppeln, Event-Handler
- Modify: `PFLICHTENHEFT.md` — Status aktualisieren

---

### Task 1: `checkScTrackFormats` — Tests schreiben (TDD)

**Files:**
- Modify: `test/unit.test.js`

- [ ] **Schritt 1: Import ergänzen**

In `test/unit.test.js` Zeile 9–14, `checkScTrackFormats` zum destructuring hinzufügen:

```js
const {
  encryptForClient,
  decryptFromClient,
  fetchScSession,
  writeTempCookieFile,
  checkScTrackFormats
} = require('../server');
```

- [ ] **Schritt 2: 3 Tests anhängen**

Am Ende von `test/unit.test.js` einfügen:

```js
test('checkScTrackFormats — DRM-only transcodings → canDownload: false', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      media: {
        transcodings: [
          { format: { protocol: 'cbc-encrypted-hls', mime_type: 'audio/ogg' } },
          { format: { protocol: 'ctr-encrypted-hls', mime_type: 'audio/ogg' } }
        ]
      }
    })
  });
  const result = await checkScTrackFormats('https://soundcloud.com/artist/track', 'test-token');
  assert.deepEqual(result, { canDownload: false, reason: 'drm' });
  global.fetch = originalFetch;
});

test('checkScTrackFormats — hls vorhanden → canDownload: true', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      media: {
        transcodings: [
          { format: { protocol: 'hls', mime_type: 'audio/ogg' } },
          { format: { protocol: 'cbc-encrypted-hls', mime_type: 'audio/ogg' } }
        ]
      }
    })
  });
  const result = await checkScTrackFormats('https://soundcloud.com/artist/track', 'test-token');
  assert.deepEqual(result, { canDownload: true });
  global.fetch = originalFetch;
});

test('checkScTrackFormats — API-Netzwerkfehler → canDownload: true (fail-open)', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('network error'); };
  const result = await checkScTrackFormats('https://soundcloud.com/artist/track', 'test-token');
  assert.deepEqual(result, { canDownload: true });
  global.fetch = originalFetch;
});
```

- [ ] **Schritt 3: Tests ausführen — sie müssen FEHLSCHLAGEN**

```
npm test
```

Erwartetes Ergebnis: `TypeError: checkScTrackFormats is not a function` (oder äquivalent) — Funktion existiert noch nicht.

- [ ] **Schritt 4: Commit der failing Tests**

```bash
git add test/unit.test.js
git commit -m "test: add failing tests for checkScTrackFormats (TDD)"
```

---

### Task 2: `checkScTrackFormats` implementieren + in `/api/download` integrieren

**Files:**
- Modify: `server.js:151–174` (nach `fetchScSession`, vor `checkScPreview`)
- Modify: `server.js:851` (nach Token-Validation, vor `let sessionCookie`)
- Modify: `server.js:908–914` (`child.on('close')` — Code ≠ 0 Block)
- Modify: `server.js:1237–1241` (`module.exports`)

- [ ] **Schritt 1: `checkScTrackFormats` in `server.js` einfügen**

Nach Zeile 150 (nach dem schließenden `}` von `fetchScSession`) und vor Zeile 152 (`function detectSource`) einfügen:

```js
async function checkScTrackFormats(trackUrl, oauthToken) {
  try {
    const resolveUrl = `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(trackUrl)}&client_id=${SC_CLIENT_ID}`;
    const response = await fetch(resolveUrl, {
      headers: { 'Authorization': `OAuth ${oauthToken}` }
    });
    if (!response.ok) return { canDownload: true };
    const track = await response.json();
    const transcodings = track?.media?.transcodings;
    if (!Array.isArray(transcodings) || transcodings.length === 0) return { canDownload: true };
    const hasUnencrypted = transcodings.some(
      (t) => t?.format?.protocol === 'hls' || t?.format?.protocol === 'progressive'
    );
    if (hasUnencrypted) return { canDownload: true };
    return { canDownload: false, reason: 'drm' };
  } catch {
    return { canDownload: true };
  }
}
```

- [ ] **Schritt 2: Tests ausführen — alle müssen BESTEHEN**

```
npm test
```

Erwartetes Ergebnis: 15 passing, 0 failing (12 vorherige + 3 neue).

- [ ] **Schritt 3: DRM-Check in `/api/download` SC-Branch integrieren**

In `server.js`, nach dem `if (!oauthToken)` Guard-Block (ca. Zeile 842–849) und vor `let sessionCookie = ...`, einfügen:

```js
      const drmCheck = await checkScTrackFormats(url, oauthToken);
      if (!drmCheck.canDownload) {
        job.status = 'error';
        job.stage = 'error';
        updateProgress(job, 0, 'error');
        job.error = 'Dieser Track ist DRM-geschützt und kann derzeit nicht heruntergeladen werden. Go+-Support ist in Vorbereitung.';
        appendEvent(job, 'DRM-geschützter Track erkannt.');
        scheduleJobCleanup(job);
        return res.json({ id });
      }
```

Der vollständige SC-Branch nach der Änderung (Kontext):

```js
  if (detectSource(url) === 'soundcloud') {
    if (encryptedToken && typeof encryptedToken === 'string') {
      const oauthToken = decryptFromClient(encryptedToken);
      if (!oauthToken) {
        job.status = 'error';
        job.stage = 'error';
        updateProgress(job, 0, 'error');
        job.error = 'Token ungültig oder abgelaufen — bitte neu verifizieren.';
        appendEvent(job, 'Token-Fehler.');
        scheduleJobCleanup(job);
        return res.json({ id });
      }
      const drmCheck = await checkScTrackFormats(url, oauthToken);
      if (!drmCheck.canDownload) {
        job.status = 'error';
        job.stage = 'error';
        updateProgress(job, 0, 'error');
        job.error = 'Dieser Track ist DRM-geschützt und kann derzeit nicht heruntergeladen werden. Go+-Support ist in Vorbereitung.';
        appendEvent(job, 'DRM-geschützter Track erkannt.');
        scheduleJobCleanup(job);
        return res.json({ id });
      }
      let sessionCookie = decryptFromClient(encryptedSession) || null;
      // ... rest unchanged
```

- [ ] **Schritt 4: 404-Fallback im `child.on('close')` Handler**

Den bestehenden `if (code !== 0)` Block (ca. Zeile 908–914) ersetzen:

**Vorher:**
```js
      if (code !== 0) {
        job.status = 'error';
        job.stage = 'error';
        job.error = 'yt-dlp wurde mit einem Fehler beendet.';
        appendEvent(job, 'Download fehlgeschlagen.');
        scheduleJobCleanup(job);
        return;
      }
```

**Nachher:**
```js
      if (code !== 0) {
        job.status = 'error';
        job.stage = 'error';
        const rawText = job.rawLog.join('\n');
        if (detectSource(url) === 'soundcloud' && rawText.includes('404')) {
          job.error = 'Download fehlgeschlagen — der Track könnte DRM-geschützt sein. Bitte erneut versuchen oder einen anderen Track wählen.';
        } else {
          job.error = 'yt-dlp wurde mit einem Fehler beendet.';
        }
        appendEvent(job, 'Download fehlgeschlagen.');
        scheduleJobCleanup(job);
        return;
      }
```

- [ ] **Schritt 5: `checkScTrackFormats` zu `module.exports` hinzufügen**

`server.js` Zeile 1237–1241, `checkScTrackFormats` ergänzen:

**Vorher:**
```js
module.exports = {
  app, startServer, buildPublicClientConfig, verifyRequiredBinaries,
  detectSource, buildScArgs, buildYtArgs,
  writeTempCookieFile, fetchScSession, encryptForClient, decryptFromClient
};
```

**Nachher:**
```js
module.exports = {
  app, startServer, buildPublicClientConfig, verifyRequiredBinaries,
  detectSource, buildScArgs, buildYtArgs,
  writeTempCookieFile, fetchScSession, encryptForClient, decryptFromClient,
  checkScTrackFormats
};
```

- [ ] **Schritt 6: Alle Tests nochmals ausführen**

```
npm test
```

Erwartetes Ergebnis: 15 passing, 0 failing.

- [ ] **Schritt 7: Syntax-Check**

```
npm run check
```

Erwartetes Ergebnis: kein Output (kein Fehler).

- [ ] **Schritt 8: Commit**

```bash
git add server.js test/unit.test.js
git commit -m "feat: add checkScTrackFormats with DRM detection and 404 fallback"
```

---

### Task 3: `index.html` — Settings-Modal HTML + CSS

**Files:**
- Modify: `public/index.html`

- [ ] **Schritt 1: `.settings-toggle` CSS aktualisieren**

Den bestehenden `.settings-toggle` Block (Zeilen 118–127) ersetzen:

**Vorher:**
```css
    .settings-toggle {
      background: var(--panel-2);
      border: 1px solid var(--border);
      color: var(--muted);
      font-size: 0.85rem;
      min-width: 0;
      padding: 8px 14px;
      flex-shrink: 0;
    }
    .settings-toggle:hover { color: var(--text); }
```

**Nachher:**
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

- [ ] **Schritt 2: `.settings-panel` CSS entfernen, Modal-CSS einfügen**

Den bestehenden `.settings-panel` Block (Zeilen 128–147) ersetzen:

**Vorher:**
```css
    .settings-panel {
      border: 1px solid var(--border);
      border-radius: 14px;
      background: rgba(15, 23, 42, 0.8);
      padding: 16px;
      display: grid;
      gap: 12px;
    }
    .settings-panel .label {
      font-size: 0.78rem;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
```

**Nachher:**
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
    .modal-overlay.hidden { display: none; }
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
    .label {
      font-size: 0.78rem;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
```

- [ ] **Schritt 3: Settings-Button-Text auf Nur-Icon kürzen**

Zeile 225 des `<body>`:

**Vorher:**
```html
      <button id="settingsToggle" type="button" class="settings-toggle">⚙ Einstellungen</button>
```

**Nachher:**
```html
      <button id="settingsToggle" type="button" class="settings-toggle" aria-label="Einstellungen">⚙</button>
```

- [ ] **Schritt 4: `#settingsPanel` Section durch Modal ersetzen**

Den bestehenden `<section id="settingsPanel" ...>` Block (Zeilen 228–244) ersetzen:

**Vorher:**
```html
    <section id="settingsPanel" class="settings-panel hidden">
      <div class="label">SoundCloud-Token</div>
      <p class="muted" style="margin:0;font-size:0.85rem;line-height:1.5">
        Benötigt für private, altersgeschützte oder Go+-Tracks.<br>
        Zu finden in den Browser-DevTools:<br>
        <code>Application → Local Storage → soundcloud.com → oauth_token</code>
      </p>
      <div class="settings-row">
        <input id="scTokenInput" type="password" placeholder="2-123456-789012345-ABCDEFGH..." />
        <button id="scTokenSave" type="button">Speichern</button>
        <button id="scTokenVerify" type="button" class="secondary" style="min-width:0">Prüfen</button>
      </div>
      <div id="scVerifyResult" class="verify-result"></div>
      <p class="muted" style="margin:0;font-size:0.78rem">
        Token wird nur im Browser gespeichert (localStorage) — nie dauerhaft auf dem Server.
      </p>
    </section>
```

**Nachher:**
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

- [ ] **Schritt 5: Syntax-Check**

```
npm run check
```

Erwartetes Ergebnis: kein Output (kein Fehler).

- [ ] **Schritt 6: Commit**

```bash
git add public/index.html
git commit -m "feat: replace settings panel with modal overlay"
```

---

### Task 4: `app.js` — Modal-Logik + SC-Banner entkoppeln

**Files:**
- Modify: `public/app.js`

- [ ] **Schritt 1: Element-Referenz `settingsPanel` → `settingsModal` + `settingsClose` hinzufügen**

Zeile 51 `const settingsPanel = ...` ersetzen und `settingsClose` ergänzen:

**Vorher (Zeilen 50–57):**
```js
  const settingsToggle = document.getElementById('settingsToggle');
  const settingsPanel = document.getElementById('settingsPanel');
  const scTokenInput = document.getElementById('scTokenInput');
  const scTokenSave = document.getElementById('scTokenSave');
  const scTokenVerify = document.getElementById('scTokenVerify');
  const scVerifyResult = document.getElementById('scVerifyResult');
  const scBanner = document.getElementById('scBanner');
  const scBannerTokenBtn = document.getElementById('scBannerTokenBtn');
```

**Nachher:**
```js
  const settingsToggle = document.getElementById('settingsToggle');
  const settingsModal = document.getElementById('settingsModal');
  const settingsClose = document.getElementById('settingsClose');
  const scTokenInput = document.getElementById('scTokenInput');
  const scTokenSave = document.getElementById('scTokenSave');
  const scTokenVerify = document.getElementById('scTokenVerify');
  const scVerifyResult = document.getElementById('scVerifyResult');
  const scBanner = document.getElementById('scBanner');
  const scBannerTokenBtn = document.getElementById('scBannerTokenBtn');
```

- [ ] **Schritt 2: Banner-Logik aus `updateUiForSource` entfernen + `updateScBanner` hinzufügen**

Den bestehenden `updateUiForSource`-Block (Zeilen 97–119) ersetzen:

**Vorher:**
```js
  function updateUiForSource(isSoundCloud) {
    const mp4Option = formatSelect.querySelector('option[value="mp4"]');
    const originalOption = formatSelect.querySelector('option[value="original"]');

    if (isSoundCloud) {
      if (mp4Option) mp4Option.style.display = 'none';
      if (originalOption) originalOption.style.display = '';
      if (formatSelect.value === 'mp4') {
        formatSelect.value = 'mp3';
        fillQualityOptions('mp3');
      }
      const hasToken = hasStoredCredentials();
      scBanner.classList.toggle('hidden', hasToken);
    } else {
      if (mp4Option) mp4Option.style.display = '';
      if (originalOption) originalOption.style.display = 'none';
      if (formatSelect.value === 'original') {
        formatSelect.value = 'mp3';
        fillQualityOptions('mp3');
      }
      scBanner.classList.add('hidden');
    }
  }
```

**Nachher:**
```js
  function updateUiForSource(isSoundCloud) {
    const mp4Option = formatSelect.querySelector('option[value="mp4"]');
    const originalOption = formatSelect.querySelector('option[value="original"]');

    if (isSoundCloud) {
      if (mp4Option) mp4Option.style.display = 'none';
      if (originalOption) originalOption.style.display = '';
      if (formatSelect.value === 'mp4') {
        formatSelect.value = 'mp3';
        fillQualityOptions('mp3');
      }
    } else {
      if (mp4Option) mp4Option.style.display = '';
      if (originalOption) originalOption.style.display = 'none';
      if (formatSelect.value === 'original') {
        formatSelect.value = 'mp3';
        fillQualityOptions('mp3');
      }
    }
  }

  function updateScBanner() {
    const url = document.getElementById('url').value;
    const needsBanner = detectSoundCloud(url) && !hasStoredCredentials();
    scBanner.classList.toggle('hidden', !needsBanner);
  }
```

- [ ] **Schritt 3: Modal-Funktionen einfügen**

Direkt nach der `updateScBanner`-Funktion einfügen:

```js
  function openSettingsModal() {
    settingsModal.classList.remove('hidden');
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

- [ ] **Schritt 4: Event-Handler des URL-Inputs aktualisieren**

Den bestehenden URL-input-Listener (Zeilen 238–240) ersetzen:

**Vorher:**
```js
  document.getElementById('url').addEventListener('input', (e) => {
    updateUiForSource(detectSoundCloud(e.target.value));
  });
```

**Nachher:**
```js
  document.getElementById('url').addEventListener('input', (e) => {
    const isSC = detectSoundCloud(e.target.value);
    updateUiForSource(isSC);
    updateScBanner();
  });
```

- [ ] **Schritt 5: Settings-Toggle und Banner-Button Event-Handler ersetzen**

Den bestehenden `settingsToggle`-Listener (Zeilen 242–250) ersetzen:

**Vorher:**
```js
  settingsToggle.addEventListener('click', () => {
    settingsPanel.classList.toggle('hidden');
    if (!settingsPanel.classList.contains('hidden')) {
      scTokenInput.value = '';
      scTokenInput.placeholder = hasStoredCredentials() ? '••••••••••••••' : 'OAuth Token eingeben';
      scVerifyResult.textContent = '';
      scVerifyResult.className = 'verify-result';
    }
  });
```

**Nachher:**
```js
  settingsToggle.addEventListener('click', openSettingsModal);
  settingsClose.addEventListener('click', closeSettingsModal);
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) closeSettingsModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSettingsModal();
  });
```

Den bestehenden `scBannerTokenBtn`-Listener (Zeilen 252–259) ersetzen:

**Vorher:**
```js
  scBannerTokenBtn.addEventListener('click', () => {
    settingsPanel.classList.remove('hidden');
    scTokenInput.value = '';
    scTokenInput.placeholder = hasStoredCredentials() ? '••••••••••••••' : 'OAuth Token eingeben';
    scVerifyResult.textContent = '';
    scVerifyResult.className = 'verify-result';
    scTokenInput.focus();
  });
```

**Nachher:**
```js
  scBannerTokenBtn.addEventListener('click', openSettingsModal);
```

- [ ] **Schritt 6: `scTokenSave`-Listener aktualisieren**

Den bestehenden `scTokenSave`-Listener (Zeilen 261–269) ersetzen:

**Vorher:**
```js
  scTokenSave.addEventListener('click', () => {
    clearEncryptedCredentials();
    scTokenInput.value = '';
    scTokenInput.placeholder = 'OAuth Token eingeben';
    const isSC = detectSoundCloud(document.getElementById('url').value);
    updateUiForSource(isSC);
    scVerifyResult.textContent = 'Token entfernt.';
    scVerifyResult.className = 'verify-result ok';
  });
```

**Nachher:**
```js
  scTokenSave.addEventListener('click', () => {
    clearEncryptedCredentials();
    scTokenInput.value = '';
    scTokenInput.placeholder = '2-123456-789012345-ABCDEFGH...';
    scTokenSave.textContent = 'Speichern';
    updateScBanner();
    scVerifyResult.textContent = 'Token entfernt.';
    scVerifyResult.className = 'verify-result ok';
  });
```

- [ ] **Schritt 7: `scTokenVerify`-Erfolgs-Handler aktualisieren**

Im `scTokenVerify`-Listener den `if (data.encryptedToken)` Block (ca. Zeilen 298–304) ersetzen:

**Vorher:**
```js
      if (data.encryptedToken) {
        saveEncryptedCredentials(data.encryptedToken, data.encryptedSession || '');
        scTokenInput.value = '';
        scTokenInput.placeholder = '••••••••••••••';
        const isSC = detectSoundCloud(document.getElementById('url').value);
        updateUiForSource(isSC);
      }
```

**Nachher:**
```js
      if (data.encryptedToken) {
        saveEncryptedCredentials(data.encryptedToken, data.encryptedSession || '');
        scTokenInput.value = '';
        scTokenInput.placeholder = '••••••••••••••';
        scTokenSave.textContent = 'Token entfernen';
        updateScBanner();
      }
```

- [ ] **Schritt 8: Syntax-Check**

```
npm run check
```

Erwartetes Ergebnis: kein Output (kein Fehler).

- [ ] **Schritt 9: Tests ausführen (Regression-Check)**

```
npm test
```

Erwartetes Ergebnis: 15 passing, 0 failing.

- [ ] **Schritt 10: Commit**

```bash
git add public/app.js
git commit -m "feat: replace settings panel with modal, decouple SC banner logic"
```

---

### Task 5: `PFLICHTENHEFT.md` aktualisieren

**Files:**
- Modify: `PFLICHTENHEFT.md`

- [ ] **Schritt 1: Modul-Status-Tabelle aktualisieren**

Die Tabelle in Abschnitt "Modul-Status" ersetzen:

**Vorher:**
```markdown
| SC Session-Cookie Fix | 🔄 In Arbeit | Option B: `fetchScSession` + Encryption |
| Client-Side Credential Encryption | 🔄 In Arbeit | AES-256-GCM, localStorage nur Ciphertext |
| Frontend Settings-Panel | ✅ Fertig (Basis) | Token-Input, Verify, SC-Banner |
| Frontend Encryption-Integration | 📋 Geplant | encrypted localStorage, neue Request-Bodies |
```

**Nachher:**
```markdown
| SC Session-Cookie Fix | ✅ Fertig | `fetchScSession` + AES-256-GCM Encryption |
| Client-Side Credential Encryption | ✅ Fertig | AES-256-GCM, localStorage nur Ciphertext |
| SC Go+-Download | ❌ Nicht unterstützt | FairPlay DRM, proaktive Erkennung aktiv, Phase 2 geplant |
| Frontend Settings-Modal | ✅ Fertig | Modal-Overlay, Token-Input, Verify, SC-Banner |
```

- [ ] **Schritt 2: "Offene Tasks" bereinigen**

Den gesamten Abschnitt "Offene Tasks" (alle `- [ ]` Zeilen) ersetzen:

**Nachher:**
```markdown
## Offene Tasks

- [ ] Phase 2: Eigener SC-Downloader (direkter API-Zugriff, Go+-Support)
```

- [ ] **Schritt 3: "Bekannte Probleme" aktualisieren**

Die Tabelle in "Bekannte Probleme / Blocker" ersetzen:

**Vorher:**
```markdown
| SC Go+-Download schlägt fehl (404) | `_soundcloud_session`-Cookie fehlt in yt-dlp-Request | Option B: `fetchScSession` + Cookie-Anreicherung |
| oauth_token im Klartext in localStorage | Kein Encryption-Layer | AES-256-GCM Server-seitig |
```

**Nachher:**
```markdown
| SC Go+-Download nicht möglich | Apple FairPlay DRM (`cbc-encrypted-hls`/`ctr-encrypted-hls`), yt-dlp kann nicht entschlüsseln | Phase 2: Eigener SC-Downloader geplant |
```

- [ ] **Schritt 4: Änderungshistorie ergänzen**

Neue Zeile in die Tabelle einfügen:

```markdown
| 2026-06-03 | Phase 1 abgeschlossen: DRM-Erkennung, Settings-Modal, Release v1.1.0 |
```

- [ ] **Schritt 5: Commit**

```bash
git add PFLICHTENHEFT.md
git commit -m "docs: update PFLICHTENHEFT for Phase 1 completion"
```

---

### Task 6: Release v1.1.0

**Files:**
- Keine Dateiänderungen — nur git-Operationen

- [ ] **Schritt 1: `package.json` Version bestätigen**

```bash
node -e "console.log(require('./package.json').version)"
```

Erwartetes Ergebnis: `1.1.0` (bereits korrekt gesetzt).

- [ ] **Schritt 2: Aktuellen Branch-Status prüfen**

```bash
git log --oneline -8
git status
```

Erwartetes Ergebnis: Alle Änderungen committed, Working Tree clean. Feature-Branch `feature/sc-session-cookie-fix` ist aktiv.

- [ ] **Schritt 3: Feature-Branch in `main` mergen**

```bash
git checkout main
git merge --no-ff feature/sc-session-cookie-fix -m "feat: Phase 1 — DRM detection, settings modal, release v1.1.0"
```

- [ ] **Schritt 4: Git-Tag `v1.1.0` erstellen**

```bash
git tag -a v1.1.0 -m "Release v1.1.0 — SC DRM detection, settings modal, credential encryption"
```

- [ ] **Schritt 5: Tag + Branch pushen**

```bash
git push origin main
git push origin v1.1.0
```

CI/CD (`.github/workflows/publish-container.yml`) wird durch den `v1.1.0`-Tag ausgelöst und pusht automatisch zu Docker Hub + GHCR.

- [ ] **Schritt 6: Feature-Branch lokal aufräumen (optional)**

```bash
git branch -d feature/sc-session-cookie-fix
```

---

## Smoke-Tests nach Abschluss

Diese Tests manuell gegen den laufenden Docker-Container durchführen:

1. **SC öffentlicher Track ohne Token** — Download startet ohne DRM-Block, kein Banner im Normalzustand
2. **SC-URL im Input ohne Token** — Banner `⚠ Kein Token` erscheint, verschwindet wenn URL gelöscht
3. **⚙-Button klicken** — Modal öffnet sich über der UI, Rest abgedunkelt
4. **ESC-Taste** — Modal schließt sich, kein Layout-Shift
5. **Token setzen via Modal** — Nach Verify verschwindet der SC-Banner
6. **Go+-Track mit Token** — Sofortiger Job-Error mit DRM-Meldung (kein yt-dlp-Spawn)
7. **YouTube-URL** — Kein SC-Banner, MP4-Option verfügbar, Modal-Toggle funktioniert
