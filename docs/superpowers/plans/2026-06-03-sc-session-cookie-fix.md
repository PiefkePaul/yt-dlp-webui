# SC Session-Cookie Fix + Credential Encryption — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix SoundCloud Go+ downloads by fetching `_soundcloud_session` via SC Auth API, and encrypt all user credentials sent to the client using AES-256-GCM.

**Architecture:** Server adds `fetchScSession` (SC Auth API → session cookie), `encryptForClient`/`decryptFromClient` (AES-256-GCM, key only on server). `/api/sc-verify` fetches + encrypts session and token once, returns ciphertext. `/api/download` accepts ciphertext, decrypts server-side, falls back to fresh session fetch if needed. Frontend stores only ciphertext in localStorage, never plaintext.

**Tech Stack:** Node.js built-in `crypto` (AES-256-GCM), Node.js built-in `fetch`, Node.js built-in `node:test` test runner, Express.

**Spec:** `docs/superpowers/specs/2026-06-03-sc-session-cookie-fix-design.md`

---

## File Map

| File | Action | Verantwortung |
|------|--------|--------------|
| `server.js` | Modify | fetchScSession, encryptForClient, decryptFromClient, writeTempCookieFile+sessionCookie, /api/download, /api/sc-verify |
| `public/app.js` | Modify | encrypted localStorage, Settings-UX, Download-Request-Body, Session-Refresh |
| `test/unit.test.js` | Create | Unit-Tests für server.js pure functions |
| `.env.example` | Modify | SC_CLIENT_ID + SESSION_ENCRYPTION_KEY ergänzen |
| `.env.template` | Modify | SC_CLIENT_ID + SESSION_ENCRYPTION_KEY ergänzen |
| `package.json` | Modify | test-Script ergänzen |
| `scripts/smoke-test.js` | Modify | Export-Checks für neue Funktionen |

---

### Task 1: Test-Infrastruktur + .env-Dateien

**Files:**
- Modify: `package.json`
- Create: `test/unit.test.js`
- Modify: `.env.example`
- Modify: `.env.template`

- [ ] **Step 1: test-Script in package.json ergänzen**

In `package.json` das `"scripts"`-Objekt:

```json
"scripts": {
  "start": "node server.js",
  "test": "node --test",
  "check": "node --check server.js && node --check public/app.js && node --check scripts/build-pages.js && node --check scripts/build-release.js && node --check scripts/smoke-test.js",
  "smoke": "node scripts/smoke-test.js",
  "pages:build": "node scripts/build-pages.js",
  "release:build": "node scripts/build-release.js",
  "verify": "npm run check && npm run smoke && npm run pages:build"
},
```

- [ ] **Step 2: Testdatei-Skeleton erstellen**

Erstelle `test/unit.test.js`:

```js
process.env.SESSION_ENCRYPTION_KEY = 'd29ea4ebf361d8ff1d4b1d08eb452dc5';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fsp = require('fs/promises');
const os = require('os');

const {
  encryptForClient,
  decryptFromClient,
  fetchScSession,
  writeTempCookieFile
} = require('../server');
```

- [ ] **Step 3: Leere Testsuite laufen lassen**

```
npm test
```

Erwartet: `pass 0`, kein Fehler.

- [ ] **Step 4: .env.example ergänzen**

Am Ende von `.env.example` anfügen:

```
# SoundCloud Auth API — Web-Client-ID (Fallback; yt-dlp Standard)
# Überschreiben wenn SC diese ID sperrt
SC_CLIENT_ID=i53MAi5VcJrq7u38ZL1SOZtDi17ds1A0

# AES-256-GCM Key für Client-seitige Credential-Verschlüsselung (Pflicht)
# Generieren: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SESSION_ENCRYPTION_KEY=
```

- [ ] **Step 5: .env.template identisch ergänzen**

Gleichen Block am Ende von `.env.template` anfügen.

- [ ] **Step 6: Commit**

```
git add package.json test/unit.test.js .env.example .env.template
git commit -m "chore: Test-Infrastruktur und .env-Vars für SC Session-Cookie Fix"
```

---

### Task 2: `encryptForClient` / `decryptFromClient` (AES-256-GCM)

**Files:**
- Modify: `server.js` (require-Block Zeile 7, Konstanten nach Zeile 27, neue Funktionen vor `detectSource`)
- Modify: `test/unit.test.js`

- [ ] **Step 1: Failing Tests schreiben**

Ergänze `test/unit.test.js` nach den require-Zeilen:

```js
test('encryptForClient/decryptFromClient — Roundtrip', (t) => {
  const plaintext = 'test-oauth-token-123';
  const encrypted = encryptForClient(plaintext);
  assert.equal(typeof encrypted, 'string');
  assert.equal(encrypted.split(':').length, 3);
  assert.equal(decryptFromClient(encrypted), plaintext);
});

test('decryptFromClient — manipulierter Ciphertext gibt null zurück', (t) => {
  const encrypted = encryptForClient('some-value');
  const tampered = encrypted.slice(0, -4) + 'XXXX';
  assert.equal(decryptFromClient(tampered), null);
});

test('decryptFromClient — ungültige Inputs geben null zurück', (t) => {
  assert.equal(decryptFromClient(''), null);
  assert.equal(decryptFromClient(null), null);
  assert.equal(decryptFromClient('kein:format'), null);
  assert.equal(decryptFromClient(undefined), null);
});

test('encryptForClient — gleicher Input erzeugt unterschiedlichen Ciphertext (IV-Randomness)', (t) => {
  const a = encryptForClient('value');
  const b = encryptForClient('value');
  assert.notEqual(a, b);
});
```

- [ ] **Step 2: Tests laufen lassen — erwarte 4 Fehler**

```
npm test
```

Erwartet: 4 failing (encryptForClient/decryptFromClient nicht definiert).

- [ ] **Step 3: crypto-Destrukturierung in server.js ergänzen**

`server.js` hat bereits `const crypto = require('crypto');` (Zeile 5). Direkt nach dieser Zeile einfügen:

```js
const { randomBytes, createCipheriv, createDecipheriv } = crypto;
```

- [ ] **Step 4: Konstanten SC_CLIENT_ID + SESSION_ENCRYPTION_KEY_HEX in server.js**

Nach `const SC_TEST_TRACK_URL = ...` (thematisch zusammengehörend) einfügen:

```js
const SC_CLIENT_ID = process.env.SC_CLIENT_ID || 'i53MAi5VcJrq7u38ZL1SOZtDi17ds1A0';
const SESSION_ENCRYPTION_KEY_HEX = (process.env.SESSION_ENCRYPTION_KEY || '').trim();
```

- [ ] **Step 5: getEncryptionKeyBuffer, encryptForClient, decryptFromClient in server.js**

Nach der `resolvePathValue`-Funktion (nach ca. Zeile 91), vor `detectSource` einfügen:

```js
function getEncryptionKeyBuffer() {
  if (!SESSION_ENCRYPTION_KEY_HEX || SESSION_ENCRYPTION_KEY_HEX.length !== 64) {
    throw new Error(
      'SESSION_ENCRYPTION_KEY fehlt oder ungültig in .env\n' +
      'Key generieren: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return Buffer.from(SESSION_ENCRYPTION_KEY_HEX, 'hex');
}

function encryptForClient(plaintext) {
  const key = getEncryptionKeyBuffer();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptFromClient(encrypted) {
  try {
    if (!encrypted || typeof encrypted !== 'string') return null;
    const parts = encrypted.split(':');
    if (parts.length !== 3) return null;
    const [ivB64, tagB64, cipherB64] = parts;
    const key = getEncryptionKeyBuffer();
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const ciphertext = Buffer.from(cipherB64, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
```

- [ ] **Step 6: encryptForClient + decryptFromClient zu module.exports hinzufügen**

In `module.exports` am Ende von server.js:

```js
module.exports = {
  app,
  startServer,
  buildPublicClientConfig,
  verifyRequiredBinaries,
  detectSource,
  buildScArgs,
  buildYtArgs,
  writeTempCookieFile,
  encryptForClient,
  decryptFromClient
};
```

- [ ] **Step 7: Tests laufen lassen — erwarte 4 passing**

```
npm test
```

Erwartet: 4 passing.

- [ ] **Step 8: Syntax-Check**

```
npm run check
```

Erwartet: exit 0, keine Ausgabe.

- [ ] **Step 9: Commit**

```
git add server.js test/unit.test.js
git commit -m "feat(crypto): encryptForClient/decryptFromClient AES-256-GCM"
```

---

### Task 3: `fetchScSession`

**Files:**
- Modify: `server.js` (neue Funktion nach `decryptFromClient`, vor `detectSource`)
- Modify: `test/unit.test.js`

- [ ] **Step 1: Failing Tests schreiben**

Ergänze `test/unit.test.js`:

```js
test('fetchScSession — gibt sessionCookie-String zurück bei Erfolg', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    headers: {
      getSetCookie: () => [
        'connect_session=1; Path=/; Domain=.soundcloud.com',
        '_soundcloud_session="abc123xyz"; Max-Age=604800; Path=/; Secure; HttpOnly',
        'soundcloud_session_hint=1; Path=/'
      ]
    }
  });
  const result = await fetchScSession('test-token');
  assert.equal(result, 'abc123xyz');
  global.fetch = originalFetch;
});

test('fetchScSession — gibt null zurück wenn _soundcloud_session fehlt', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    headers: { getSetCookie: () => ['connect_session=1; Path=/'] }
  });
  const result = await fetchScSession('test-token');
  assert.equal(result, null);
  global.fetch = originalFetch;
});

test('fetchScSession — gibt null zurück bei Netzwerkfehler', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('network error'); };
  const result = await fetchScSession('test-token');
  assert.equal(result, null);
  global.fetch = originalFetch;
});

test('fetchScSession — gibt null zurück bei non-200 Antwort', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 401,
    headers: { getSetCookie: () => [] }
  });
  const result = await fetchScSession('test-token');
  assert.equal(result, null);
  global.fetch = originalFetch;
});
```

- [ ] **Step 2: Tests laufen lassen — erwarte 4 Fehler**

```
npm test
```

Erwartet: 4 neue failing (fetchScSession nicht definiert).

- [ ] **Step 3: fetchScSession in server.js hinzufügen**

Nach `decryptFromClient`, vor `detectSource`:

```js
async function fetchScSession(oauthToken) {
  try {
    const url = `https://api-auth.soundcloud.com/connect/session?client_id=${SC_CLIENT_ID}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: { access_token: oauthToken } })
    });
    if (!response.ok) return null;
    const cookies = response.headers.getSetCookie();
    const entry = cookies.find((c) => c.startsWith('_soundcloud_session='));
    if (!entry) return null;
    const raw = entry.split(';')[0].replace('_soundcloud_session=', '');
    return raw.startsWith('"') ? raw.slice(1, -1) : raw;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: fetchScSession zu module.exports hinzufügen**

```js
module.exports = {
  app, startServer, buildPublicClientConfig, verifyRequiredBinaries,
  detectSource, buildScArgs, buildYtArgs,
  writeTempCookieFile, fetchScSession, encryptForClient, decryptFromClient
};
```

- [ ] **Step 5: Tests laufen lassen — alle passing**

```
npm test
```

- [ ] **Step 6: Syntax-Check**

```
npm run check
```

- [ ] **Step 7: Commit**

```
git add server.js test/unit.test.js
git commit -m "feat(sc): fetchScSession holt _soundcloud_session-Cookie von SC Auth API"
```

---

### Task 4: `writeTempCookieFile` + 0o600 + Startup-Check + Cookie-Sofortlöschung

**Files:**
- Modify: `server.js` (`writeTempCookieFile`, `startServer`, `child.on('close')` im Download-Handler)
- Modify: `test/unit.test.js`

- [ ] **Step 1: Failing Tests schreiben**

Ergänze `test/unit.test.js`:

```js
test('writeTempCookieFile — nur oauth_token wenn kein sessionCookie', async (t) => {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'test-cookies-'));
  try {
    const cookiePath = await writeTempCookieFile(tmpDir, 'my-token');
    const content = await fsp.readFile(cookiePath, 'utf8');
    const lines = content.trim().split('\n');
    assert.equal(lines.length, 2);
    assert.ok(content.includes('oauth_token\tmy-token'));
    assert.ok(!content.includes('_soundcloud_session'));
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
});

test('writeTempCookieFile — beide Cookies wenn sessionCookie übergeben', async (t) => {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'test-cookies-'));
  try {
    const cookiePath = await writeTempCookieFile(tmpDir, 'my-token', 'my-session-abc');
    const content = await fsp.readFile(cookiePath, 'utf8');
    const lines = content.trim().split('\n');
    assert.equal(lines.length, 3);
    assert.ok(content.includes('oauth_token\tmy-token'));
    assert.ok(content.includes('_soundcloud_session\tmy-session-abc'));
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Tests laufen lassen — 2. Test schlägt fehl**

```
npm test
```

Erwartet: `writeTempCookieFile — beide Cookies` schlägt fehl.

- [ ] **Step 3: writeTempCookieFile in server.js ersetzen**

Ersetze die bestehende `writeTempCookieFile`-Funktion vollständig:

```js
async function writeTempCookieFile(dirPath, token, sessionCookie = null) {
  const cookiePath = path.join(dirPath, 'sc.cookies');
  const expire = Math.floor(Date.now() / 1000) + 604800;
  const lines = [
    '# Netscape HTTP Cookie File',
    `.soundcloud.com\tTRUE\t/\tTRUE\t2147483647\toauth_token\t${token}`
  ];
  if (sessionCookie) {
    lines.push(`.soundcloud.com\tTRUE\t/\tTRUE\t${expire}\t_soundcloud_session\t${sessionCookie}`);
  }
  await fsp.writeFile(cookiePath, lines.join('\n'), { encoding: 'utf8', mode: 0o600 });
  return cookiePath;
}
```

- [ ] **Step 4: SESSION_ENCRYPTION_KEY-Check in startServer() ergänzen**

In `startServer()` als erste Zeile im Funktionskörper einfügen:

```js
async function startServer(options = {}) {
  getEncryptionKeyBuffer(); // wirft wenn SESSION_ENCRYPTION_KEY fehlt oder ungültig

  runtimeState.tmpDir = resolvePathValue(options.tmpDir || runtimeState.tmpDir);
  // ... Rest unverändert
```

- [ ] **Step 5: Cookie-Sofortlöschung am Anfang des child.on('close')-Handlers**

Im `/api/download`-Handler: `child.on('close', async (code) => {` direkt nach der öffnenden Klammer einfügen:

```js
  child.on('close', async (code) => {
    // Cookie-Datei sofort löschen — als erstes, vor jeder weiteren Verarbeitung
    if (cookiePath) {
      await fsp.rm(cookiePath, { force: true }).catch(() => {});
    }

    try {
      if (code !== 0) {
```

- [ ] **Step 6: Tests laufen lassen — alle passing**

```
npm test
```

- [ ] **Step 7: Syntax-Check + Smoke**

```
npm run check && npm run smoke
```

- [ ] **Step 8: Commit**

```
git add server.js test/unit.test.js
git commit -m "feat(sc): writeTempCookieFile + sessionCookie, 0o600, Startup-Check, Cookie-Cleanup"
```

---

### Task 5: `/api/download` — encryptedToken/encryptedSession

**Files:**
- Modify: `server.js` (Route-Handler-Anfang und `res.json`-Aufruf)

Hinweis: Die Cookie-Sofortlöschung aus Task 4 (im `child.on('close')`-Handler) bleibt unverändert erhalten.

- [ ] **Step 1: Route-Handler-Signatur und SC-Handling-Block ersetzen**

Ersetze im `/api/download` Handler den Anfang (von `const { url, format...` bis zum `const args = buildArgs(...)` Call):

```js
app.post('/api/download', async (req, res) => {
  const { url, format = 'mp3', quality = 'best', encryptedToken, encryptedSession } = req.body || {};

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Bitte einen gueltigen Link angeben.' });
  }

  const id = crypto.randomUUID();
  const targetDir = path.join(runtimeState.tmpDir, id);
  await fsp.mkdir(targetDir, { recursive: true });

  const job = {
    id,
    url,
    format,
    quality,
    requiresConversion: format === 'mp3' || (format === 'mp4' && detectSource(url) !== 'soundcloud'),
    status: 'running',
    stage: 'queued',
    progress: 0,
    createdAt: new Date().toISOString(),
    completedAt: null,
    expiresAt: null,
    targetDir,
    log: [],
    rawLog: [],
    downloadName: null,
    downloadPath: null,
    error: null,
    cleanupTimer: null,
    conversionDurationSec: null,
    conversionKind: null,
    ffmpegMode: null
  };

  jobs.set(id, job);
  appendEvent(job, 'Job gestartet.');
  updateProgress(job, 1, 'queued');

  let cookiePath = null;
  let freshEncryptedSession = null;

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
      let sessionCookie = decryptFromClient(encryptedSession) || null;
      if (!sessionCookie) {
        appendEvent(job, 'SC-Session wird geholt...');
        sessionCookie = await fetchScSession(oauthToken);
        if (!sessionCookie) {
          appendEvent(job, 'Session-Cookie nicht verfügbar, Download wird trotzdem versucht...');
        } else {
          freshEncryptedSession = encryptForClient(sessionCookie);
        }
      }
      try {
        cookiePath = await writeTempCookieFile(targetDir, oauthToken, sessionCookie);
      } catch {
        job.status = 'error';
        job.stage = 'error';
        updateProgress(job, 0, 'error');
        job.error = 'Cookie-Datei konnte nicht erstellt werden.';
        appendEvent(job, 'Interner Fehler beim Token-Handling.');
        scheduleJobCleanup(job);
        return res.json({ id });
      }
    } else {
      appendEvent(job, 'Prüfe ob Track öffentlich zugänglich...');
      const isPreview = await checkScPreview(url);
      if (isPreview) {
        job.status = 'error';
        job.stage = 'error';
        updateProgress(job, 0, 'error');
        job.error = 'Dieser Track benötigt einen SoundCloud-Token — ohne Token wird nur eine 30s-Vorschau ausgeliefert.';
        appendEvent(job, 'Token benötigt.');
        scheduleJobCleanup(job);
        return res.json({ id });
      }
    }
  }

  const args = buildArgs({ url, format, quality, targetDir, cookiePath });
  const child = spawn('yt-dlp', args);
```

- [ ] **Step 2: `res.json({ id })` am Ende des Handlers anpassen**

Den abschließenden `res.json({ id });` am Ende des Handlers ersetzen:

```js
  res.json({ id, ...(freshEncryptedSession ? { encryptedSession: freshEncryptedSession } : {}) });
});
```

- [ ] **Step 3: Syntax-Check + Smoke**

```
npm run check && npm run smoke
```

Erwartet: `Smoke test passed.`

- [ ] **Step 4: Commit**

```
git add server.js
git commit -m "feat(api): /api/download auf encryptedToken/encryptedSession umgestellt"
```

---

### Task 6: `/api/sc-verify` — Session fetchen + verschlüsselt zurückgeben

**Files:**
- Modify: `server.js` (sc-verify Route)

- [ ] **Step 1: sc-verify Route ersetzen**

Ersetze die gesamte `/api/sc-verify` Route:

```js
app.post('/api/sc-verify', async (req, res) => {
  const { token } = req.body || {};

  if (!token || typeof token !== 'string' || !token.trim()) {
    return res.status(400).json({ valid: false, error: 'Kein Token angegeben.' });
  }

  const trimmedToken = token.trim();

  // Schritt 1: SC REST API /me
  let username;
  let goPlus = false;
  try {
    const scRes = await fetch('https://api-v2.soundcloud.com/me', {
      headers: { 'Authorization': `OAuth ${trimmedToken}` }
    });

    if (!scRes.ok) {
      return res.json({ valid: false, error: 'Token ungültig oder abgelaufen.' });
    }

    const data = await scRes.json();
    username = data.username || data.permalink || 'Unbekannt';
    const consumerProductId = ((data.consumer_subscription || {}).product || {}).id || '';
    goPlus = consumerProductId.includes('high-tier') || consumerProductId.includes('go');
  } catch {
    return res.json({ valid: false, error: 'SC-API nicht erreichbar.' });
  }

  // Schritt 2: Session-Cookie einmalig holen (für yt-dlp-Check und Response)
  const sessionCookie = await fetchScSession(trimmedToken);

  // Schritt 3: yt-dlp Duration-Check (nur wenn TEST_URL konfiguriert)
  if (SC_TEST_TRACK_URL) {
    let verifyTmpDir;
    try {
      verifyTmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'sc-verify-'));
      const tempCookiePath = await writeTempCookieFile(verifyTmpDir, trimmedToken, sessionCookie);

      const result = await runProcessCapture('yt-dlp', [
        '--dump-json', '--no-playlist', '--no-warnings',
        '--cookies', tempCookiePath,
        SC_TEST_TRACK_URL
      ]);

      const info = JSON.parse(result.stdout.trim());
      if (typeof info.duration === 'number' && info.duration <= 35) {
        return res.json({
          valid: false,
          error: 'Token gültig, aber kein Zugriff auf Go+-Tracks — nur 30s-Preview verfügbar.'
        });
      }
    } catch {
      // yt-dlp-Check fehlgeschlagen → /me war erfolgreich, trotzdem valid
    } finally {
      if (verifyTmpDir) {
        await fsp.rm(verifyTmpDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  // Schritt 4: Token + Session verschlüsseln und zurückgeben
  const encryptedToken = encryptForClient(trimmedToken);
  const encryptedSession = sessionCookie ? encryptForClient(sessionCookie) : undefined;

  return res.json({
    valid: true,
    username,
    goPlus,
    encryptedToken,
    ...(encryptedSession !== undefined ? { encryptedSession } : {})
  });
});
```

- [ ] **Step 2: Syntax-Check + Smoke**

```
npm run check && npm run smoke
```

- [ ] **Step 3: Commit**

```
git add server.js
git commit -m "feat(api): /api/sc-verify gibt verschlüsselte Credentials zurück"
```

---

### Task 7: `public/app.js` — verschlüsselte Credentials + Download-Flow

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: loadScToken / saveScToken ersetzen**

Ersetze die Funktionen `loadScToken` und `saveScToken` (Zeilen 72–82):

```js
function loadEncryptedCredentials() {
  return {
    encryptedToken: localStorage.getItem('sc_oauth_token_enc') || '',
    encryptedSession: localStorage.getItem('sc_session_enc') || ''
  };
}

function saveEncryptedCredentials(encryptedToken, encryptedSession) {
  localStorage.setItem('sc_oauth_token_enc', encryptedToken);
  if (encryptedSession) {
    localStorage.setItem('sc_session_enc', encryptedSession);
  }
}

function clearEncryptedCredentials() {
  localStorage.removeItem('sc_oauth_token_enc');
  localStorage.removeItem('sc_session_enc');
}

function hasStoredCredentials() {
  return Boolean(localStorage.getItem('sc_oauth_token_enc'));
}
```

- [ ] **Step 2: updateUiForSource — hasToken-Erkennung**

Zeile `const hasToken = Boolean(loadScToken());` ersetzen durch:

```js
const hasToken = hasStoredCredentials();
```

- [ ] **Step 3: settingsToggle click-Handler — masked Anzeige**

`scTokenInput.value = loadScToken();` im settingsToggle-Handler ersetzen durch:

```js
scTokenInput.value = '';
scTokenInput.placeholder = hasStoredCredentials() ? '••••••••••••••' : 'OAuth Token eingeben';
```

- [ ] **Step 4: scBannerTokenBtn click-Handler — masked Anzeige**

`scTokenInput.value = loadScToken();` im scBannerTokenBtn-Handler (ca. Zeile 240) identisch ersetzen:

```js
scTokenInput.value = '';
scTokenInput.placeholder = hasStoredCredentials() ? '••••••••••••••' : 'OAuth Token eingeben';
```

- [ ] **Step 5: scTokenSave → "Token entfernen"-Handler**

Den `scTokenSave`-click-Handler (Zeilen 246–253) vollständig ersetzen:

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

- [ ] **Step 6: scTokenVerify — verschlüsselte Werte aus Response speichern**

Den `if (data.valid)` Block im Verify-Handler (ca. Zeilen 278–285) ersetzen:

```js
if (data.valid) {
  const goLabel = data.goPlus ? ' · SC Go+: ✓' : '';
  scVerifyResult.textContent = `✓ Token gültig · Nutzer: ${data.username}${goLabel}`;
  scVerifyResult.className = 'verify-result ok';
  if (data.encryptedToken) {
    saveEncryptedCredentials(data.encryptedToken, data.encryptedSession || '');
    scTokenInput.value = '';
    scTokenInput.placeholder = '••••••••••••••';
    const isSC = detectSoundCloud(document.getElementById('url').value);
    updateUiForSource(isSC);
  }
} else {
```

- [ ] **Step 7: form.submit — encryptedToken/encryptedSession senden + Session-Refresh**

Den Block von `const urlInput = ...` bis `await pollStatus(data.id)` (Zeilen 321–338) ersetzen:

```js
const urlInput = document.getElementById('url').value;
const isSC = detectSoundCloud(urlInput);
const { encryptedToken, encryptedSession } = isSC ? loadEncryptedCredentials() : {};

const response = await fetch(createApiUrl('/api/download'), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: urlInput,
    format: formatSelect.value,
    quality: qualitySelect.value,
    ...(encryptedToken ? { encryptedToken } : {}),
    ...(encryptedSession ? { encryptedSession } : {})
  })
});

const data = await response.json();
if (!response.ok) throw new Error(data.error || 'Download konnte nicht gestartet werden.');

if (data.encryptedSession && encryptedToken) {
  localStorage.setItem('sc_session_enc', data.encryptedSession);
}

await pollStatus(data.id);
```

- [ ] **Step 8: Initialisierung am Ende der Bootstrap-Funktion**

Den Block (Zeilen 346–349):
```js
const savedToken = loadScToken();
if (savedToken) {
  scTokenInput.value = savedToken;
}
```
ersetzen durch:
```js
if (hasStoredCredentials()) {
  scTokenInput.placeholder = '••••••••••••••';
}
```

- [ ] **Step 9: Syntax-Check**

```
npm run check
```

Erwartet: exit 0.

- [ ] **Step 10: Commit**

```
git add public/app.js
git commit -m "feat(frontend): Credentials verschlüsselt in localStorage, Settings-UX aktualisiert"
```

---

### Task 8: Exports + Smoke-Test aktualisieren

**Files:**
- Modify: `server.js` (module.exports — finaler Stand)
- Modify: `scripts/smoke-test.js`

- [ ] **Step 1: module.exports in server.js auf finalen Stand prüfen**

Stelle sicher dass `module.exports` am Ende von server.js so lautet:

```js
module.exports = {
  app,
  startServer,
  buildPublicClientConfig,
  verifyRequiredBinaries,
  detectSource,
  buildScArgs,
  buildYtArgs,
  writeTempCookieFile,
  fetchScSession,
  encryptForClient,
  decryptFromClient
};
```

- [ ] **Step 2: Smoke-Test — neue Exports prüfen**

In `scripts/smoke-test.js` den require-Block oben erweitern:

```js
const {
  app,
  buildPublicClientConfig,
  fetchScSession,
  encryptForClient,
  decryptFromClient,
  writeTempCookieFile
} = require('../server');
```

In der `main()` Funktion am Anfang hinzufügen:

```js
if (typeof fetchScSession !== 'function') throw new Error('fetchScSession ist nicht exportiert.');
if (typeof encryptForClient !== 'function') throw new Error('encryptForClient ist nicht exportiert.');
if (typeof decryptFromClient !== 'function') throw new Error('decryptFromClient ist nicht exportiert.');
```

- [ ] **Step 3: Alle Tests + Smoke + Check**

```
npm test && npm run check && npm run smoke
```

Erwartet: alle Tests grün, `Smoke test passed.`

- [ ] **Step 4: Commit**

```
git add server.js scripts/smoke-test.js
git commit -m "chore: Exports und Smoke-Test für neue Funktionen aktualisiert"
```

---

### Task 9: Manuelles Test-Protokoll

**Vorbedingung:** `npm start` läuft, `.env` enthält `SESSION_ENCRYPTION_KEY=d29ea4ebf361d8ff1d4b1d08eb452dc5`.

- [ ] **Test 1 — sc-verify gibt verschlüsselte Werte zurück**

```bash
curl -s -X POST http://localhost:3000/api/sc-verify \
  -H "Content-Type: application/json" \
  -d '{"token":"2-309355-98721513-u1IAMEmKQUaBNV7"}' | jq .
```

Erwartet: `valid=true`, `username="Paul xIx"`, `goPlus=true`, `encryptedToken` (String mit 3 Base64-Blöcken getrennt durch `:`), `encryptedSession` vorhanden.
`encryptedToken` und `encryptedSession`-Werte notieren für Test 2.

- [ ] **Test 2 — Download mit verschlüsselten Werten läuft durch**

`<ENC_TOKEN>` und `<ENC_SESSION>` aus Test 1 einsetzen:

```bash
curl -s -X POST http://localhost:3000/api/download \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"https://soundcloud.com/vinivicimusic/karma-extended-mix\",\"format\":\"mp3\",\"quality\":\"320\",\"encryptedToken\":\"<ENC_TOKEN>\",\"encryptedSession\":\"<ENC_SESSION>\"}" | jq .
```

Job-ID notieren, dann pollen:

```bash
curl -s http://localhost:3000/api/status/<ID> | jq '{status,stage,downloadName}'
```

Erwartet: `status=done`, `downloadName=*.mp3`.

- [ ] **Test 3 — Preflight ohne Token blockt**

```bash
curl -s -X POST http://localhost:3000/api/download \
  -H "Content-Type: application/json" \
  -d '{"url":"https://soundcloud.com/vinivicimusic/karma-extended-mix","format":"mp3","quality":"320"}' | jq .
```

Pollen bis `status=error`. Erwartet: `error` enthält "Token benötigt".

- [ ] **Test 4 — Manipulierter Ciphertext wird abgelehnt**

```bash
curl -s -X POST http://localhost:3000/api/download \
  -H "Content-Type: application/json" \
  -d '{"url":"https://soundcloud.com/vinivicimusic/karma-extended-mix","format":"mp3","quality":"320","encryptedToken":"AAABBBCCC_invalid"}' | jq .
```

Pollen. Erwartet: `status=error`, `error` enthält "Token ungültig oder abgelaufen".

- [ ] **Abschluss — Projektdokumentation aktualisieren**

1. `PFLICHTENHEFT.md` — Modul-Status: `SC Session-Cookie Fix` und `Client-Side Credential Encryption` auf `✅ Fertig` setzen
2. `WORKLOG.md` — Option B als erledigt markieren
3. `session_state.md` — erledigte Tasks + nächster Schritt
4. CocoIndex aktualisieren: `ccc index` (aus `D:\Development\_global_ccc`)
5. Final-Commit:

```
git add PFLICHTENHEFT.md WORKLOG.md session_state.md
git commit -m "docs: Projektstatus und Session-Protokoll nach Implementierung aktualisiert"
```
