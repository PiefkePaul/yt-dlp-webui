# SoundCloud Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SoundCloud-URLs neben YouTube unterstützen — via bestehendem yt-dlp-Binary, OAuth-Token in localStorage, Preview-Schutz (kein 30s-False-Positive), Token-Verifikationsendpoint.

**Architecture:** URL-Routing innerhalb von `buildArgs` via `detectSource()`. SC-Token kommt als `scToken` im POST-Body, wird serverseitig in eine temporäre Netscape-Cookie-Datei geschrieben. Ohne Token läuft ein Preflight-Check (`--dump-json`) um Preview-Downloads abzufangen.

**Tech Stack:** Node.js v18+ (native `fetch`), Express, yt-dlp, ffmpeg, Vanilla JS (localStorage)

---

## Dateiübersicht

| Datei | Änderung | Verantwortung |
|-------|----------|---------------|
| `server.js` | Modify | detectSource, buildYtArgs, buildScArgs, writeTempCookieFile, checkScPreview, /api/sc-verify |
| `public/index.html` | Modify | Settings-Button, Settings-Panel, SC-Banner, neue CSS |
| `public/app.js` | Modify | detectSoundCloud, updateUiForSource, loadScToken, saveScToken, Token-Verify-Flow |
| `scripts/smoke-test.js` | Modify | Neue Route /api/sc-verify prüfen, SC-spezifische Smoke-Checks |
| `scripts/test-sc-helpers.js` | Create | Unit-Tests für detectSource, buildScArgs, writeTempCookieFile |

---

## Task 1: detectSource + Unit-Test-Grundgerüst

**Files:**
- Modify: `server.js` (nach Zeile 6, nach den `require`-Statements)
- Create: `scripts/test-sc-helpers.js`

- [ ] **Schritt 1: `os`-Import in server.js hinzufügen**

Am Anfang von `server.js`, nach Zeile 6 (`const { spawn } = require('child_process');`):

```javascript
const os = require('os');
```

- [ ] **Schritt 2: `detectSource` nach `resolvePathValue` (ca. Zeile 85) einfügen**

```javascript
function detectSource(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return hostname === 'soundcloud.com' ? 'soundcloud' : 'other';
  } catch {
    return 'other';
  }
}
```

- [ ] **Schritt 3: `detectSource` zu `module.exports` hinzufügen**

Am Ende von `server.js`, `module.exports`-Block anpassen:

```javascript
module.exports = {
  app,
  startServer,
  buildPublicClientConfig,
  verifyRequiredBinaries,
  detectSource
};
```

- [ ] **Schritt 4: Test-Datei erstellen**

`scripts/test-sc-helpers.js`:

```javascript
const assert = require('assert');
const { detectSource } = require('../server');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('detectSource:');
test('soundcloud.com → soundcloud', () => {
  assert.strictEqual(detectSource('https://soundcloud.com/artist/track'), 'soundcloud');
});
test('www.soundcloud.com → soundcloud', () => {
  assert.strictEqual(detectSource('https://www.soundcloud.com/artist/track'), 'soundcloud');
});
test('youtube.com → other', () => {
  assert.strictEqual(detectSource('https://www.youtube.com/watch?v=abc'), 'other');
});
test('ungültige URL → other', () => {
  assert.strictEqual(detectSource('kein-link'), 'other');
});
test('leerer String → other', () => {
  assert.strictEqual(detectSource(''), 'other');
});
```

- [ ] **Schritt 5: Test ausführen und sicherstellen dass er besteht**

```
node scripts/test-sc-helpers.js
```

Erwartete Ausgabe:
```
detectSource:
  ✓ soundcloud.com → soundcloud
  ✓ www.soundcloud.com → soundcloud
  ✓ youtube.com → other
  ✓ ungültige URL → other
  ✓ leerer String → other
```

- [ ] **Schritt 6: Commit**

```bash
git add server.js scripts/test-sc-helpers.js
git commit -m "feat: add detectSource for SoundCloud URL routing"
```

---

## Task 2: buildYtArgs + buildScArgs Refactor

**Files:**
- Modify: `server.js` (Bereich `buildArgs`, ca. Zeile 518–532)
- Modify: `scripts/test-sc-helpers.js`

Die bestehende `buildArgs`-Funktion wird in `buildYtArgs` umbenannt, eine neue `buildScArgs` wird hinzugefügt, und ein neues `buildArgs` dispatcht anhand `detectSource`.

- [ ] **Schritt 1: `buildArgs` (Zeile 518) umbenennen und `buildYtArgs` ergänzen**

Die aktuelle `buildArgs`-Funktion ersetzen mit:

```javascript
function buildYtArgs({ url, format, quality, targetDir }) {
  const common = [
    '--yes-playlist',
    '--newline',
    '--restrict-filenames',
    '--js-runtimes', 'deno',
    '--remote-components', 'ejs:github',
    '--extractor-args', 'youtube:player_client=android,web',
    '-P', targetDir,
    '-o', '%(title).200B [%(id)s].%(ext)s'
  ];

  const formatArgs = format === 'mp4' ? getVideoArgs(quality) : getAudioArgs();
  return [...common, ...getCookieArgs(), ...formatArgs, url];
}

function buildScArgs({ url, format, targetDir, cookiePath }) {
  const common = [
    '--yes-playlist',
    '--newline',
    '--restrict-filenames',
    '-P', targetDir,
    '-o', '%(title).200B [%(id)s].%(ext)s'
  ];

  const cookieArgs = cookiePath ? ['--cookies', cookiePath] : [];
  return [...common, ...cookieArgs, '-f', 'bestaudio/best', url];
}

function buildArgs({ url, format, quality, targetDir, cookiePath = null }) {
  if (detectSource(url) === 'soundcloud') {
    return buildScArgs({ url, format, targetDir, cookiePath });
  }
  return buildYtArgs({ url, format, quality, targetDir });
}
```

- [ ] **Schritt 2: Smoke-Test ausführen — YT-Pfad darf nicht brechen**

```
node scripts/smoke-test.js
```

Erwartete Ausgabe: `Smoke test passed.`

- [ ] **Schritt 3: `buildScArgs` + `buildYtArgs` zu exports hinzufügen**

```javascript
module.exports = {
  app,
  startServer,
  buildPublicClientConfig,
  verifyRequiredBinaries,
  detectSource,
  buildScArgs,
  buildYtArgs
};
```

- [ ] **Schritt 4: Unit-Tests für buildScArgs und buildYtArgs in `test-sc-helpers.js` ergänzen**

Ans Ende der Datei anhängen:

```javascript
const { buildScArgs, buildYtArgs } = require('../server');

console.log('\nbuildScArgs:');
test('enthält bestaudio/best', () => {
  const args = buildScArgs({ url: 'https://soundcloud.com/a/b', format: 'mp3', targetDir: '/tmp/x', cookiePath: null });
  assert.ok(args.includes('-f'));
  assert.ok(args.includes('bestaudio/best'));
});
test('enthält --cookies wenn cookiePath gesetzt', () => {
  const args = buildScArgs({ url: 'https://soundcloud.com/a/b', format: 'mp3', targetDir: '/tmp/x', cookiePath: '/tmp/sc.cookies' });
  assert.ok(args.includes('--cookies'));
  assert.ok(args.includes('/tmp/sc.cookies'));
});
test('kein --cookies wenn cookiePath null', () => {
  const args = buildScArgs({ url: 'https://soundcloud.com/a/b', format: 'mp3', targetDir: '/tmp/x', cookiePath: null });
  assert.ok(!args.includes('--cookies'));
});
test('kein --js-runtimes in SC-Args', () => {
  const args = buildScArgs({ url: 'https://soundcloud.com/a/b', format: 'mp3', targetDir: '/tmp/x', cookiePath: null });
  assert.ok(!args.includes('--js-runtimes'));
});

console.log('\nbuildYtArgs:');
test('enthält --js-runtimes deno', () => {
  const args = buildYtArgs({ url: 'https://youtube.com/watch?v=x', format: 'mp3', quality: '320', targetDir: '/tmp/x' });
  assert.ok(args.includes('--js-runtimes'));
  assert.ok(args.includes('deno'));
});
test('enthält extractor-args youtube', () => {
  const args = buildYtArgs({ url: 'https://youtube.com/watch?v=x', format: 'mp3', quality: '320', targetDir: '/tmp/x' });
  assert.ok(args.some((a) => a.startsWith('youtube:')));
});
```

- [ ] **Schritt 5: Tests ausführen**

```
node scripts/test-sc-helpers.js
```

Alle Tests müssen bestehen.

- [ ] **Schritt 6: Commit**

```bash
git add server.js scripts/test-sc-helpers.js
git commit -m "feat: split buildArgs into buildYtArgs + buildScArgs with SC routing"
```

---

## Task 3: writeTempCookieFile + checkScPreview

**Files:**
- Modify: `server.js` (neue Hilfsfunktionen nach `detectSource`)
- Modify: `scripts/test-sc-helpers.js`

- [ ] **Schritt 1: `writeTempCookieFile` nach `detectSource` in server.js einfügen**

```javascript
async function writeTempCookieFile(dirPath, token) {
  const cookiePath = path.join(dirPath, 'sc.cookies');
  const content = [
    '# Netscape HTTP Cookie File',
    `.soundcloud.com\tTRUE\t/\tTRUE\t2147483647\toauth_token\t${token}`
  ].join('\n');
  await fsp.writeFile(cookiePath, content, 'utf8');
  return cookiePath;
}
```

- [ ] **Schritt 2: `checkScPreview` nach `writeTempCookieFile` in server.js einfügen**

```javascript
async function checkScPreview(url) {
  try {
    const result = await runProcessCapture('yt-dlp', [
      '--dump-json', '--no-playlist', '--no-warnings', url
    ]);
    const info = JSON.parse(result.stdout.trim());
    return typeof info.duration === 'number' && info.duration <= 35;
  } catch {
    return false;
  }
}
```

`checkScPreview` gibt `false` zurück wenn yt-dlp fehlschlägt — im Zweifel den Download versuchen lassen.

- [ ] **Schritt 3: `writeTempCookieFile` zu exports hinzufügen**

```javascript
module.exports = {
  app,
  startServer,
  buildPublicClientConfig,
  verifyRequiredBinaries,
  detectSource,
  buildScArgs,
  buildYtArgs,
  writeTempCookieFile
};
```

- [ ] **Schritt 4: Unit-Test für `writeTempCookieFile` in `test-sc-helpers.js` ergänzen**

```javascript
const fsp = require('fs/promises');
const os = require('os');
const { writeTempCookieFile } = require('../server');

console.log('\nwriteTempCookieFile:');
test('schreibt Netscape-Cookie-Datei', async () => {
  const tmpDir = os.tmpdir();
  const cookiePath = await writeTempCookieFile(tmpDir, 'test-token-123');
  const content = await fsp.readFile(cookiePath, 'utf8');
  assert.ok(content.includes('oauth_token'));
  assert.ok(content.includes('test-token-123'));
  assert.ok(content.includes('.soundcloud.com'));
  await fsp.unlink(cookiePath);
});
```

Da der Test `async` ist, `main`-Funktion anpassen:

```javascript
async function main() {
  // bisherige synchrone Tests laufen weiterhin inline
  await testWriteTempCookieFile();
}

async function testWriteTempCookieFile() {
  const fsp = require('fs/promises');
  const os = require('os');
  const { writeTempCookieFile } = require('../server');
  console.log('\nwriteTempCookieFile:');
  try {
    const tmpDir = os.tmpdir();
    const cookiePath = await writeTempCookieFile(tmpDir, 'test-token-123');
    const content = await fsp.readFile(cookiePath, 'utf8');
    assert.ok(content.includes('oauth_token'), 'oauth_token fehlt');
    assert.ok(content.includes('test-token-123'), 'Token-Wert fehlt');
    assert.ok(content.includes('.soundcloud.com'), 'Domain fehlt');
    await fsp.unlink(cookiePath);
    console.log('  ✓ schreibt Netscape-Cookie-Datei');
  } catch (err) {
    console.error(`  ✗ schreibt Netscape-Cookie-Datei: ${err.message}`);
    process.exitCode = 1;
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
```

Dabei die bisherigen synchronen Tests und den alten abschließenden `process.exitCode`-Check integrieren.

Die vollständige `test-sc-helpers.js` nach der Überarbeitung:

```javascript
const assert = require('assert');
const path = require('path');
const fsp = require('fs/promises');
const os = require('os');
const { detectSource, buildScArgs, buildYtArgs, writeTempCookieFile } = require('../server');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('detectSource:');
test('soundcloud.com → soundcloud', () => {
  assert.strictEqual(detectSource('https://soundcloud.com/artist/track'), 'soundcloud');
});
test('www.soundcloud.com → soundcloud', () => {
  assert.strictEqual(detectSource('https://www.soundcloud.com/artist/track'), 'soundcloud');
});
test('youtube.com → other', () => {
  assert.strictEqual(detectSource('https://www.youtube.com/watch?v=abc'), 'other');
});
test('ungültige URL → other', () => {
  assert.strictEqual(detectSource('kein-link'), 'other');
});
test('leerer String → other', () => {
  assert.strictEqual(detectSource(''), 'other');
});

console.log('\nbuildScArgs:');
test('enthält bestaudio/best', () => {
  const args = buildScArgs({ url: 'https://soundcloud.com/a/b', format: 'mp3', targetDir: '/tmp/x', cookiePath: null });
  assert.ok(args.includes('-f'));
  assert.ok(args.includes('bestaudio/best'));
});
test('enthält --cookies wenn cookiePath gesetzt', () => {
  const args = buildScArgs({ url: 'https://soundcloud.com/a/b', format: 'mp3', targetDir: '/tmp/x', cookiePath: '/tmp/sc.cookies' });
  assert.ok(args.includes('--cookies'));
  assert.ok(args.includes('/tmp/sc.cookies'));
});
test('kein --cookies wenn cookiePath null', () => {
  const args = buildScArgs({ url: 'https://soundcloud.com/a/b', format: 'mp3', targetDir: '/tmp/x', cookiePath: null });
  assert.ok(!args.includes('--cookies'));
});
test('kein --js-runtimes in SC-Args', () => {
  const args = buildScArgs({ url: 'https://soundcloud.com/a/b', format: 'mp3', targetDir: '/tmp/x', cookiePath: null });
  assert.ok(!args.includes('--js-runtimes'));
});

console.log('\nbuildYtArgs:');
test('enthält --js-runtimes deno', () => {
  const args = buildYtArgs({ url: 'https://youtube.com/watch?v=x', format: 'mp3', quality: '320', targetDir: '/tmp/x' });
  assert.ok(args.includes('--js-runtimes'));
  assert.ok(args.includes('deno'));
});
test('enthält extractor-args youtube', () => {
  const args = buildYtArgs({ url: 'https://youtube.com/watch?v=x', format: 'mp3', quality: '320', targetDir: '/tmp/x' });
  assert.ok(args.some((a) => a.startsWith('youtube:')));
});

async function main() {
  console.log('\nwriteTempCookieFile:');
  try {
    const tmpDir = os.tmpdir();
    const cookiePath = await writeTempCookieFile(tmpDir, 'test-token-123');
    const content = await fsp.readFile(cookiePath, 'utf8');
    assert.ok(content.includes('oauth_token'), 'oauth_token fehlt');
    assert.ok(content.includes('test-token-123'), 'Token-Wert fehlt');
    assert.ok(content.includes('.soundcloud.com'), 'Domain fehlt');
    await fsp.unlink(cookiePath);
    console.log('  ✓ schreibt Netscape-Cookie-Datei');
  } catch (err) {
    console.error(`  ✗ schreibt Netscape-Cookie-Datei: ${err.message}`);
    process.exitCode = 1;
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
```

- [ ] **Schritt 5: Tests ausführen**

```
node scripts/test-sc-helpers.js
```

Alle Tests müssen bestehen.

- [ ] **Schritt 6: Commit**

```bash
git add server.js scripts/test-sc-helpers.js
git commit -m "feat: add writeTempCookieFile and checkScPreview helpers"
```

---

## Task 4: SC in /api/download-Handler einbinden

**Files:**
- Modify: `server.js` (Handler ab Zeile 676)

- [ ] **Schritt 1: `SC_TEST_TRACK_URL`-Konstante am Anfang von server.js ergänzen**

Nach den bestehenden Konstanten (nach Zeile 21, nach `PUBLIC_DEMO_MESSAGE`):

```javascript
// Go+-geschützter Track für Token-Verifikation. Muss ein Track sein,
// der ohne Abo als 30s-Preview ausgeliefert wird.
// Alternativ: SC_TEST_TRACK_URL in .env setzen.
const SC_TEST_TRACK_URL = process.env.SC_TEST_TRACK_URL || '';
```

**Hinweis zur Implementierung:** Vor dem ersten Deployment einen bekannten Go+-only Track (Laufzeit > 35s) suchen und als Fallback eintragen. Z.B. einen Go+-exklusiven Track eines bekannten Künstlers aus dem SC Go+-Katalog. Den URL kommentieren mit: `// Verifiziert am YYYY-MM-DD`.

- [ ] **Schritt 2: /api/download-Handler anpassen**

Die erste Zeile des Handlers ändern um `scToken` zu empfangen:

```javascript
const { url, format = 'mp3', quality = 'best', scToken } = req.body || {};
```

`requiresConversion` im Job-Objekt anpassen (SC hat kein MP4):

```javascript
requiresConversion: format === 'mp3' || (format === 'mp4' && detectSource(url) !== 'soundcloud'),
```

Den Block `const args = buildArgs(...)` + `const child = spawn(...)` (ca. Zeile 715–716) ersetzen durch das folgende SC-Handling, das **vor** `res.json({ id })` läuft:

```javascript
  // SC: Token in Cookie-Datei schreiben oder Preflight-Check
  let cookiePath = null;
  if (detectSource(url) === 'soundcloud') {
    if (scToken && typeof scToken === 'string' && scToken.trim()) {
      try {
        cookiePath = await writeTempCookieFile(targetDir, scToken.trim());
      } catch {
        job.status = 'error';
        job.stage = 'error';
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

Das bisherige `res.json({ id })` am Ende des Handlers (Zeile 850) bleibt unverändert als Normalfall.

**Wichtig:** `return res.json({ id })` in den Fehlerpfaden gibt dem Client die Job-ID zurück — er pollt `/api/status/:id` und sieht sofort den Error-State. Das ist korrekt.

- [ ] **Schritt 3: Smoke-Test + Unit-Tests ausführen**

```
node scripts/smoke-test.js && node scripts/test-sc-helpers.js
```

Beide müssen bestehen.

- [ ] **Schritt 4: Commit**

```bash
git add server.js
git commit -m "feat: wire SoundCloud token and preflight check into /api/download"
```

---

## Task 5: /api/sc-verify Endpoint

**Files:**
- Modify: `server.js` (neuer Endpoint, nach /api/download)
- Modify: `scripts/smoke-test.js`

- [ ] **Schritt 1: Endpoint in server.js einfügen (nach `app.post('/api/download', ...)`)**

```javascript
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
    const scRes = await fetch('https://api.soundcloud.com/me', {
      headers: { 'Authorization': `OAuth ${trimmedToken}` }
    });

    if (!scRes.ok) {
      return res.json({ valid: false, error: 'Token ungültig oder abgelaufen.' });
    }

    const data = await scRes.json();
    username = data.username || data.permalink || 'Unbekannt';
    const plan = (data.plan || '').toLowerCase();
    const productName = ((data.subscription || {}).product || {}).name || '';
    goPlus = plan.includes('go') || productName.toLowerCase().includes('go');
  } catch {
    return res.json({ valid: false, error: 'SC-API nicht erreichbar.' });
  }

  // Schritt 2: yt-dlp Duration-Check (nur wenn TEST_URL konfiguriert)
  if (SC_TEST_TRACK_URL) {
    const verifyDir = os.tmpdir();
    let tempCookiePath;
    try {
      tempCookiePath = await writeTempCookieFile(verifyDir, trimmedToken);
      // Umbenennen damit kein Konflikt mit Job-Cookie-Dateien entsteht
      const uniquePath = path.join(verifyDir, `sc-verify-${crypto.randomUUID()}.cookies`);
      await fsp.rename(tempCookiePath, uniquePath);
      tempCookiePath = uniquePath;

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
      if (tempCookiePath) {
        await fsp.unlink(tempCookiePath).catch(() => {});
      }
    }
  }

  return res.json({ valid: true, username, goPlus });
});
```

- [ ] **Schritt 2: Neue Route in smoke-test.js prüfen**

In `scripts/smoke-test.js` nach dem letzten `hasRoute`-Check ergänzen:

```javascript
if (!hasRoute(routes, 'POST', '/api/sc-verify')) {
  throw new Error('POST /api/sc-verify ist nicht registriert.');
}
```

- [ ] **Schritt 3: Smoke-Test ausführen**

```
node scripts/smoke-test.js
```

Erwartete Ausgabe: `Smoke test passed.`

- [ ] **Schritt 4: Commit**

```bash
git add server.js scripts/smoke-test.js
git commit -m "feat: add POST /api/sc-verify endpoint with SC API + yt-dlp duration check"
```

---

## Task 6: Frontend HTML (index.html)

**Files:**
- Modify: `public/index.html`

- [ ] **Schritt 1: Neue CSS-Regeln in `<style>` einfügen**

Nach `.footer { ... }` (ca. Zeile 111) die folgenden Regeln hinzufügen:

```css
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
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
.settings-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 8px;
  align-items: center;
}
.verify-result { font-size: 0.82rem; min-height: 1.2em; }
.verify-result.ok { color: #86efac; }
.verify-result.error { color: #fca5a5; }
.verify-result.pending { color: var(--muted); }
.banner.sc-warning {
  border-color: rgba(245, 158, 11, 0.4);
  background: rgba(120, 53, 15, 0.2);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.banner.sc-warning .link-btn {
  background: var(--panel-2);
  border: 1px solid var(--border);
  color: var(--muted);
  font-size: 0.82rem;
  padding: 5px 12px;
  border-radius: 8px;
  cursor: pointer;
  min-width: 0;
  flex-shrink: 0;
}
```

- [ ] **Schritt 2: Header-Bereich in `<body>` umbauen**

Den aktuellen Block:

```html
<div>
  <h1>yt-dlp Download-Server</h1>
  <p>Selbst hostbarer Download-Server fuer <code>yt-dlp</code> mit Weboberflaeche fuer Einzelvideos und Playlists.</p>
  <p>Die App laeuft als normaler Node-Server und kann bei Bedarf optional in Docker verpackt werden.</p>
</div>
```

Ersetzen durch:

```html
<div class="card-header">
  <div>
    <h1>yt-dlp Download-Server</h1>
    <p>Selbst hostbarer Download-Server fuer <code>yt-dlp</code> mit Weboberflaeche fuer Einzelvideos und Playlists.</p>
  </div>
  <button id="settingsToggle" type="button" class="settings-toggle">⚙ Einstellungen</button>
</div>
```

- [ ] **Schritt 3: Settings-Panel nach dem Header-Block einfügen**

Direkt nach dem neuen `<div class="card-header">...</div>`:

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

- [ ] **Schritt 4: SC-Banner nach `<form>` einfügen**

Direkt nach `</form>`:

```html
<div id="scBanner" class="banner sc-warning hidden">
  <span style="color:#fbbf24;font-size:0.88rem">
    ⚠ Kein SoundCloud-Token gesetzt — private oder Go+-Tracks können nicht geladen werden.
  </span>
  <button type="button" class="link-btn" id="scBannerTokenBtn">Token setzen →</button>
</div>
```

- [ ] **Schritt 5: Format-`<select>` anpassen — `original`-Option hinzufügen**

Den aktuellen `<select id="format">`:

```html
<select id="format">
  <option value="mp3" selected>MP3</option>
  <option value="mp4">MP4</option>
</select>
```

Ersetzen durch:

```html
<select id="format">
  <option value="mp3" selected>MP3</option>
  <option value="mp4">MP4</option>
  <option value="original" class="sc-only" style="display:none">Original (beste Qualität)</option>
</select>
```

- [ ] **Schritt 6: Smoke-Test ausführen**

```
node scripts/smoke-test.js
```

Erwartete Ausgabe: `Smoke test passed.`

- [ ] **Schritt 7: Commit**

```bash
git add public/index.html
git commit -m "feat: add settings panel, SC token banner and original format option to HTML"
```

---

## Task 7: Frontend JavaScript (app.js)

**Files:**
- Modify: `public/app.js`

- [ ] **Schritt 1: Neue DOM-Referenzen am Anfang von `bootstrapApp` ergänzen**

Nach den bestehenden `const`-Deklarationen (nach `apiInfo`):

```javascript
const settingsToggle = document.getElementById('settingsToggle');
const settingsPanel = document.getElementById('settingsPanel');
const scTokenInput = document.getElementById('scTokenInput');
const scTokenSave = document.getElementById('scTokenSave');
const scTokenVerify = document.getElementById('scTokenVerify');
const scVerifyResult = document.getElementById('scVerifyResult');
const scBanner = document.getElementById('scBanner');
const scBannerTokenBtn = document.getElementById('scBannerTokenBtn');
```

- [ ] **Schritt 2: Helper-Funktionen nach `createApiUrl` einfügen**

```javascript
function detectSoundCloud(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '') === 'soundcloud.com';
  } catch {
    return false;
  }
}

function loadScToken() {
  return localStorage.getItem('sc_oauth_token') || '';
}

function saveScToken(token) {
  if (token) {
    localStorage.setItem('sc_oauth_token', token);
  } else {
    localStorage.removeItem('sc_oauth_token');
  }
}

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
    const hasToken = Boolean(loadScToken());
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

- [ ] **Schritt 3: `fillQualityOptions` erweitern — `original` deaktiviert Qualitäts-Dropdown**

Die bestehende `fillQualityOptions`-Funktion anpassen:

```javascript
function fillQualityOptions(format) {
  qualitySelect.innerHTML = '';

  if (format === 'original') {
    qualitySelect.disabled = true;
    const el = document.createElement('option');
    el.value = '';
    el.textContent = '—';
    qualitySelect.appendChild(el);
    return;
  }

  qualitySelect.disabled = false;
  for (const option of qualityMap[format] || []) {
    const element = document.createElement('option');
    element.value = option.value;
    element.textContent = option.label;
    qualitySelect.appendChild(element);
  }
  if (format === 'mp3') qualitySelect.value = '320';
  if (format === 'mp4') qualitySelect.value = 'best';
}
```

- [ ] **Schritt 4: Event-Handler für Settings-Panel und Token registrieren**

Nach den bestehenden Event-Handlern (`formatSelect.addEventListener(...)`) einfügen:

```javascript
settingsToggle.addEventListener('click', () => {
  settingsPanel.classList.toggle('hidden');
  if (!settingsPanel.classList.contains('hidden')) {
    scTokenInput.value = loadScToken();
    scVerifyResult.textContent = '';
    scVerifyResult.className = 'verify-result';
  }
});

scBannerTokenBtn.addEventListener('click', () => {
  settingsPanel.classList.remove('hidden');
  scTokenInput.value = loadScToken();
  scVerifyResult.textContent = '';
  scVerifyResult.className = 'verify-result';
  scTokenInput.focus();
});

scTokenSave.addEventListener('click', () => {
  const token = scTokenInput.value.trim();
  saveScToken(token);
  const isSC = detectSoundCloud(document.getElementById('url').value);
  updateUiForSource(isSC);
  scVerifyResult.textContent = token ? 'Token gespeichert.' : 'Token entfernt.';
  scVerifyResult.className = 'verify-result ok';
});

scTokenVerify.addEventListener('click', async () => {
  const token = scTokenInput.value.trim();
  if (!token) {
    scVerifyResult.textContent = 'Bitte zuerst einen Token eingeben.';
    scVerifyResult.className = 'verify-result error';
    return;
  }

  scTokenVerify.disabled = true;
  scVerifyResult.textContent = 'Prüfe Token...';
  scVerifyResult.className = 'verify-result pending';

  try {
    const response = await fetch(createApiUrl('/api/sc-verify'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const data = await response.json();

    if (data.valid) {
      const goLabel = data.goPlus ? ' · SC Go+: ✓' : '';
      scVerifyResult.textContent = `✓ Token gültig · Nutzer: ${data.username}${goLabel}`;
      scVerifyResult.className = 'verify-result ok';
    } else {
      scVerifyResult.textContent = `✗ ${data.error || 'Token ungültig.'}`;
      scVerifyResult.className = 'verify-result error';
    }
  } catch {
    scVerifyResult.textContent = '✗ Verbindung zum Server fehlgeschlagen.';
    scVerifyResult.className = 'verify-result error';
  } finally {
    scTokenVerify.disabled = false;
  }
});
```

- [ ] **Schritt 5: `input`-Event auf URL-Feld erweitern**

Den bestehenden `url`-Input-Handler suchen — falls keiner vorhanden, ergänzen:

```javascript
document.getElementById('url').addEventListener('input', (e) => {
  updateUiForSource(detectSoundCloud(e.target.value));
});
```

- [ ] **Schritt 6: Submit-Handler — `scToken` mitsenden**

Im bestehenden `form.addEventListener('submit', ...)` den Fetch-Aufruf anpassen. Den Block wo `body` gebaut wird (Suche nach `JSON.stringify`):

Den POST-Body um `scToken` ergänzen:

```javascript
const isSC = detectSoundCloud(urlInput);
const scToken = isSC ? loadScToken() : undefined;

const response = await fetch(createApiUrl('/api/download'), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: urlInput,
    format: formatSelect.value,
    quality: qualitySelect.value,
    ...(scToken ? { scToken } : {})
  })
});
```

- [ ] **Schritt 7: Initiales Token aus localStorage beim Laden anzeigen**

Am Ende von `bootstrapApp`, vor der schließenden `}`:

```javascript
const savedToken = loadScToken();
if (savedToken) {
  scTokenInput.value = savedToken;
}
```

- [ ] **Schritt 8: Smoke-Test ausführen**

```
node scripts/smoke-test.js
```

Erwartete Ausgabe: `Smoke test passed.`

- [ ] **Schritt 9: Commit**

```bash
git add public/app.js
git commit -m "feat: add SoundCloud frontend logic — token management, URL detection, verify flow"
```

---

## Task 8: Abschließende Verifikation

- [ ] **Schritt 1: Alle Tests ausführen**

```
node scripts/smoke-test.js && node scripts/test-sc-helpers.js
```

Beide müssen vollständig bestehen.

- [ ] **Schritt 2: Server starten und manuell testen**

```
node server.js
```

Dann im Browser `http://localhost:3000` öffnen und folgende Szenarien prüfen:

| Szenario | Erwartetes Verhalten |
|----------|---------------------|
| YT-URL eingeben | MP3/MP4-Optionen, kein SC-Banner |
| SC-URL ohne Token | SC-Banner erscheint, Original-Option sichtbar, MP4 ausgeblendet |
| „Token setzen →" klicken | Settings-Panel öffnet sich |
| Token speichern | Banner verschwindet |
| „Prüfen"-Button ohne Token | Fehlermeldung im Panel |
| Öffentliche SC-URL ohne Token downloaden | Preflight läuft, Download startet oder Token-Fehler |

- [ ] **Schritt 3: `.gitignore` — `.superpowers/` eintragen falls noch nicht vorhanden**

```bash
grep -q '.superpowers' .gitignore || echo '.superpowers/' >> .gitignore
git add .gitignore
git commit -m "chore: ignore .superpowers brainstorm directory"
```

- [ ] **Schritt 4: `npm run check` ausführen**

```
npm run check
```

Erwartete Ausgabe: kein Fehler (Node.js Syntax-Check für alle JS-Dateien).

---

## Hinweise für die Implementierung

- **SC_TEST_TRACK_URL**: Vor dem ersten Deployment einen Go+-only Track mit bekannter Laufzeit > 35s eintragen und mit Datum kommentieren. Ohne diese URL wird Schritt 2 von `/api/sc-verify` übersprungen (Token gilt als valid wenn `/me` 200 zurückgibt).
- **Node-Version**: Native `fetch` erfordert Node 18+. Projekt läuft auf v25.9.0 — kein Problem.
- **SC `original`-Format**: yt-dlp lädt die beste verfügbare Qualität (FLAC bei Go+, AAC/Opus sonst). Kein ffmpeg-Re-Encode.
- **`requiresConversion` für SC**: Nur `mp3` löst eine Konvertierung aus. `original` und `mp4` (SC-seitig irrelevant) nicht.
