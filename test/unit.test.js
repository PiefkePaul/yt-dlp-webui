process.env.SESSION_ENCRYPTION_KEY = 'd29ea4ebf361d8ff1d4b1d08eb452dc5d29ea4ebf361d8ff1d4b1d08eb452dc5';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fsp = require('fs/promises');
const os = require('os');

const {
  encryptForClient,
  decryptFromClient,
  fetchScSession,
  writeTempCookieFile,
  checkScTrackFormats,
  detectSource,
  buildScArgs,
  buildYtArgs,
  buildPublicClientConfig,
  buildMp3ConvertArgs,
  collectTrackMetadata,
  stripKnownExtension,
  zipDirectory
} = require('../server');

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

test('checkScTrackFormats — DRM-only transcodings → canDownload: false', async (t) => {
  const originalFetch = global.fetch;
  try {
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
  } finally {
    global.fetch = originalFetch;
  }
});

test('checkScTrackFormats — hls vorhanden → canDownload: true', async (t) => {
  const originalFetch = global.fetch;
  try {
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
  } finally {
    global.fetch = originalFetch;
  }
});

test('checkScTrackFormats — API-Netzwerkfehler → canDownload: true (fail-open)', async (t) => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => { throw new Error('network error'); };
    const result = await checkScTrackFormats('https://soundcloud.com/artist/track', 'test-token');
    assert.deepEqual(result, { canDownload: true });
  } finally {
    global.fetch = originalFetch;
  }
});

test('checkScTrackFormats — non-200 Antwort → canDownload: true (fail-open)', async (t) => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => ({ ok: false, status: 401 });
    const result = await checkScTrackFormats('https://soundcloud.com/artist/track', 'test-token');
    assert.deepEqual(result, { canDownload: true });
  } finally {
    global.fetch = originalFetch;
  }
});

test('checkScTrackFormats — progressive vorhanden → canDownload: true', async (t) => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        media: {
          transcodings: [
            { format: { protocol: 'progressive', mime_type: 'audio/mpeg' } }
          ]
        }
      })
    });
    const result = await checkScTrackFormats('https://soundcloud.com/artist/track', 'test-token');
    assert.deepEqual(result, { canDownload: true });
  } finally {
    global.fetch = originalFetch;
  }
});

test('detectSource — identifies soundcloud and other sources', (t) => {
  assert.equal(detectSource('https://soundcloud.com/user/track'), 'soundcloud');
  assert.equal(detectSource('http://soundcloud.com/user/track'), 'soundcloud');
  assert.equal(detectSource('https://www.soundcloud.com/user/track'), 'soundcloud');
  assert.equal(detectSource('https://m.soundcloud.com/user/track'), 'soundcloud');
  assert.equal(detectSource('https://on.soundcloud.com/user/track'), 'soundcloud');
  assert.equal(detectSource('https://a.b.soundcloud.com/user/track'), 'soundcloud');

  assert.equal(detectSource('https://youtube.com/watch?v=12345'), 'other');
  assert.equal(detectSource('https://youtu.be/12345'), 'other');
  assert.equal(detectSource('https://www.youtube.com/watch?v=12345'), 'other');
  assert.equal(detectSource('https://google.com'), 'other');
  assert.equal(detectSource('not-a-url'), 'other');
  assert.equal(detectSource(''), 'other');
  assert.equal(detectSource(null), 'other');
  assert.equal(detectSource(undefined), 'other');
});

test('buildScArgs — builds arguments for SoundCloud correctly', (t) => {
  const url = 'https://soundcloud.com/artist/track';
  const targetDir = '/mock/target/dir';
  
  // Ohne cookiePath
  const argsWithoutCookie = buildScArgs({ url, format: 'mp3', targetDir });
  assert.ok(argsWithoutCookie.includes('--yes-playlist'));
  assert.ok(argsWithoutCookie.includes('--newline'));
  assert.ok(argsWithoutCookie.includes('--restrict-filenames'));
  assert.ok(argsWithoutCookie.includes('-P'));
  assert.equal(argsWithoutCookie[argsWithoutCookie.indexOf('-P') + 1], targetDir);
  assert.ok(argsWithoutCookie.includes('-o'));
  assert.equal(argsWithoutCookie[argsWithoutCookie.indexOf('-o') + 1], '%(title).200B [%(id)s].%(ext)s');
  assert.ok(argsWithoutCookie.includes('-f'));
  assert.equal(argsWithoutCookie[argsWithoutCookie.indexOf('-f') + 1], 'bestaudio/best');
  assert.equal(argsWithoutCookie[argsWithoutCookie.length - 1], url);
  assert.ok(!argsWithoutCookie.includes('--cookies'));

  // Mit cookiePath
  const cookiePath = '/mock/cookies.txt';
  const argsWithCookie = buildScArgs({ url, format: 'mp4', targetDir, cookiePath });
  assert.ok(argsWithCookie.includes('--cookies'));
  assert.equal(argsWithCookie[argsWithCookie.indexOf('--cookies') + 1], cookiePath);
  assert.equal(argsWithCookie[argsWithCookie.length - 1], url);
});

test('buildYtArgs — builds arguments for YouTube correctly based on formats and qualities', (t) => {
  const url = 'https://youtube.com/watch?v=12345';
  const targetDir = '/mock/target/dir';

  // Format mp3 (Audio)
  const argsMp3 = buildYtArgs({ url, format: 'mp3', targetDir });
  assert.ok(argsMp3.includes('--yes-playlist'));
  assert.ok(argsMp3.includes('--newline'));
  assert.ok(argsMp3.includes('--restrict-filenames'));
  assert.ok(argsMp3.includes('--js-runtimes'));
  assert.equal(argsMp3[argsMp3.indexOf('--js-runtimes') + 1], 'deno');
  assert.ok(argsMp3.includes('--remote-components'));
  assert.equal(argsMp3[argsMp3.indexOf('--remote-components') + 1], 'ejs:github');
  assert.ok(argsMp3.includes('--extractor-args'));
  assert.equal(argsMp3[argsMp3.indexOf('--extractor-args') + 1], 'youtube:player_client=android,web');
  assert.ok(argsMp3.includes('-P'));
  assert.equal(argsMp3[argsMp3.indexOf('-P') + 1], targetDir);
  assert.ok(argsMp3.includes('-f'));
  assert.equal(argsMp3[argsMp3.indexOf('-f') + 1], 'bestaudio/best');
  assert.equal(argsMp3[argsMp3.length - 1], url);

  // Format mp4 (Video) mit Quality 'best'
  const argsMp4Best = buildYtArgs({ url, format: 'mp4', quality: 'best', targetDir });
  assert.ok(argsMp4Best.includes('-f'));
  assert.equal(argsMp4Best[argsMp4Best.indexOf('-f') + 1], 'bv*+ba/b');

  // Format mp4 (Video) mit Quality '1080'
  const argsMp4_1080 = buildYtArgs({ url, format: 'mp4', quality: '1080', targetDir });
  assert.ok(argsMp4_1080.includes('-f'));
  assert.equal(argsMp4_1080[argsMp4_1080.indexOf('-f') + 1], 'bv*[height<=1080]+ba/b[height<=1080]/b');

  // Format mp4 (Video) mit Quality '720'
  const argsMp4_720 = buildYtArgs({ url, format: 'mp4', quality: '720', targetDir });
  assert.ok(argsMp4_720.includes('-f'));
  assert.equal(argsMp4_720[argsMp4_720.indexOf('-f') + 1], 'bv*[height<=720]+ba/b[height<=720]/b');

  // Format mp4 (Video) mit Quality '480'
  const argsMp4_480 = buildYtArgs({ url, format: 'mp4', quality: '480', targetDir });
  assert.ok(argsMp4_480.includes('-f'));
  assert.equal(argsMp4_480[argsMp4_480.indexOf('-f') + 1], 'bv*[height<=480]+ba/b[height<=480]/b');

  // Format mp4 (Video) mit ungültiger Quality
  const argsMp4_Invalid = buildYtArgs({ url, format: 'mp4', quality: 'invalid-quality', targetDir });
  assert.ok(argsMp4_Invalid.includes('-f'));
  assert.equal(argsMp4_Invalid[argsMp4_Invalid.indexOf('-f') + 1], 'bv*[height<=1080]+ba/b[height<=1080]/b');
});

test('buildYtArgs — cookies option enabled when cookies file exists', (t) => {
  const originalCookies = process.env.YTDLP_COOKIES_FILE;
  process.env.YTDLP_COOKIES_FILE = 'dummy_cookies.txt';

  const serverPath = require.resolve('../server');
  delete require.cache[serverPath];
  const freshServer = require('../server');

  const fs = require('fs');
  const originalExistsSync = fs.existsSync;
  fs.existsSync = (path) => {
    if (path === 'dummy_cookies.txt' || path.endsWith('dummy_cookies.txt')) {
      return true;
    }
    return originalExistsSync(path);
  };

  try {
    const args = freshServer.buildYtArgs({
      url: 'https://youtube.com/watch?v=123',
      format: 'mp3',
      targetDir: '/tmp/job'
    });

    assert.ok(args.includes('--cookies'));
    assert.ok(args.includes('dummy_cookies.txt') || args.some(a => a.endsWith('dummy_cookies.txt')));
  } finally {
    fs.existsSync = originalExistsSync;
    if (originalCookies === undefined) {
      delete process.env.YTDLP_COOKIES_FILE;
    } else {
      process.env.YTDLP_COOKIES_FILE = originalCookies;
    }
    delete require.cache[serverPath];
  }
});

test('buildPublicClientConfig — returns config object with fields', (t) => {
  const config = buildPublicClientConfig();
  assert.ok(config);
  assert.equal(typeof config.apiBaseUrl, 'string');
  assert.equal(typeof config.demoMode, 'boolean');
  assert.equal(typeof config.demoMessage, 'string');
});

test('buildPublicClientConfig — parsed values match env variables', (t) => {
  const originalApiUrl = process.env.PUBLIC_API_BASE_URL;
  const originalDemoMode = process.env.PUBLIC_DEMO_MODE;
  const originalDemoMessage = process.env.PUBLIC_DEMO_MESSAGE;

  process.env.PUBLIC_API_BASE_URL = 'https://api.my-downloader.com/';
  process.env.PUBLIC_DEMO_MODE = 'true';
  process.env.PUBLIC_DEMO_MESSAGE = 'Custom Demo Message';

  const serverPath = require.resolve('../server');
  delete require.cache[serverPath];
  const freshServer = require('../server');

  try {
    const config = freshServer.buildPublicClientConfig();
    assert.deepEqual(config, {
      apiBaseUrl: 'https://api.my-downloader.com',
      demoMode: true,
      demoMessage: 'Custom Demo Message'
    });
  } finally {
    if (originalApiUrl === undefined) delete process.env.PUBLIC_API_BASE_URL;
    else process.env.PUBLIC_API_BASE_URL = originalApiUrl;

    if (originalDemoMode === undefined) delete process.env.PUBLIC_DEMO_MODE;
    else process.env.PUBLIC_DEMO_MODE = originalDemoMode;

    if (originalDemoMessage === undefined) delete process.env.PUBLIC_DEMO_MESSAGE;
    else process.env.PUBLIC_DEMO_MESSAGE = originalDemoMessage;

    delete require.cache[serverPath];
  }
});

test('buildYtArgs — write-info-json/write-thumbnail nur bei format mp3', (t) => {
  const url = 'https://youtube.com/watch?v=12345';
  const targetDir = '/mock/target/dir';

  const argsMp3 = buildYtArgs({ url, format: 'mp3', targetDir });
  assert.ok(argsMp3.includes('--write-info-json'));
  assert.ok(argsMp3.includes('--write-thumbnail'));
  assert.ok(argsMp3.includes('--convert-thumbnails'));
  assert.equal(argsMp3[argsMp3.indexOf('--convert-thumbnails') + 1], 'jpg');

  const argsMp4 = buildYtArgs({ url, format: 'mp4', quality: 'best', targetDir });
  assert.ok(!argsMp4.includes('--write-info-json'));
  assert.ok(!argsMp4.includes('--write-thumbnail'));
  assert.ok(!argsMp4.includes('--convert-thumbnails'));
});

test('buildYtArgs — enthält --ignore-errors damit einzelne fehlerhafte Playlist-Titel den Job nicht abbrechen', (t) => {
  const args = buildYtArgs({ url: 'https://youtube.com/watch?v=12345', format: 'mp3', targetDir: '/mock/target/dir' });
  assert.ok(args.includes('--ignore-errors'));
});

test('buildScArgs — write-info-json/write-thumbnail nur bei format mp3', (t) => {
  const url = 'https://soundcloud.com/artist/track';
  const targetDir = '/mock/target/dir';

  const argsMp3 = buildScArgs({ url, format: 'mp3', targetDir });
  assert.ok(argsMp3.includes('--write-info-json'));
  assert.ok(argsMp3.includes('--write-thumbnail'));
  assert.ok(argsMp3.includes('--convert-thumbnails'));
  assert.equal(argsMp3[argsMp3.indexOf('--convert-thumbnails') + 1], 'jpg');

  const argsMp4 = buildScArgs({ url, format: 'mp4', targetDir });
  assert.ok(!argsMp4.includes('--write-info-json'));
  assert.ok(!argsMp4.includes('--write-thumbnail'));
  assert.ok(!argsMp4.includes('--convert-thumbnails'));
});

test('buildScArgs — enthält --ignore-errors damit einzelne fehlerhafte Playlist-Titel den Job nicht abbrechen', (t) => {
  const args = buildScArgs({ url: 'https://soundcloud.com/artist/track', format: 'mp3', targetDir: '/mock/target/dir' });
  assert.ok(args.includes('--ignore-errors'));
});

test('buildMp3ConvertArgs — ohne Tags und Cover', (t) => {
  const args = buildMp3ConvertArgs({
    inputPath: '/tmp/in.m4a',
    outputPath: '/tmp/out.mp3',
    bitrate: '320',
    tags: null,
    coverPath: null
  });

  assert.deepEqual(args, [
    '-y', '-i', '/tmp/in.m4a',
    '-map', '0:a:0',
    '-c:a', 'libmp3lame',
    '-b:a', '320k',
    '-id3v2_version', '3',
    '-write_id3v1', '1',
    '-map_metadata', '-1',
    '/tmp/out.mp3'
  ]);
});

test('buildMp3ConvertArgs — mit Tags, ohne Cover', (t) => {
  const args = buildMp3ConvertArgs({
    inputPath: '/tmp/in.m4a',
    outputPath: '/tmp/out.mp3',
    bitrate: '192',
    tags: { title: 'A', artist: 'B' },
    coverPath: null
  });

  assert.deepEqual(args, [
    '-y', '-i', '/tmp/in.m4a',
    '-map', '0:a:0',
    '-c:a', 'libmp3lame',
    '-b:a', '192k',
    '-id3v2_version', '3',
    '-write_id3v1', '1',
    '-map_metadata', '-1',
    '-metadata', 'title=A',
    '-metadata', 'artist=B',
    '/tmp/out.mp3'
  ]);
});

test('buildMp3ConvertArgs — mit Tags und Cover', (t) => {
  const args = buildMp3ConvertArgs({
    inputPath: '/tmp/in.m4a',
    outputPath: '/tmp/out.mp3',
    bitrate: '320',
    tags: { title: 'A' },
    coverPath: '/tmp/cover.jpg'
  });

  assert.deepEqual(args, [
    '-y', '-i', '/tmp/in.m4a',
    '-i', '/tmp/cover.jpg',
    '-map', '0:a:0',
    '-map', '1:0',
    '-c:a', 'libmp3lame',
    '-b:a', '320k',
    '-id3v2_version', '3',
    '-write_id3v1', '1',
    '-map_metadata', '-1',
    '-metadata', 'title=A',
    '-c:v', 'mjpeg',
    '-metadata:s:v', 'title=Album cover',
    '-metadata:s:v', 'comment=Cover (front)',
    '-disposition:v', 'attached_pic',
    '/tmp/out.mp3'
  ]);
});

test('buildMp3ConvertArgs — bereits mp3 nutzt Copy-Codec statt Re-Encoding', (t) => {
  const args = buildMp3ConvertArgs({
    inputPath: '/tmp/in.mp3',
    outputPath: '/tmp/out.mp3',
    bitrate: '320',
    tags: null,
    coverPath: null
  });

  assert.deepEqual(args, [
    '-y', '-i', '/tmp/in.mp3',
    '-map', '0:a:0',
    '-c:a', 'copy',
    '-id3v2_version', '3',
    '-write_id3v1', '1',
    '-map_metadata', '-1',
    '/tmp/out.mp3'
  ]);
});

test('stripKnownExtension — entfernt letzte Extension', (t) => {
  assert.equal(stripKnownExtension('Song [abc].webp'), 'Song [abc]');
  assert.equal(stripKnownExtension('Song [abc].m4a'), 'Song [abc]');
  assert.equal(stripKnownExtension('Song [abc]'), 'Song [abc]');
});

test('collectTrackMetadata — matched info.json und Thumbnail nach Dateinamen-Stamm', (t) => {
  const names = [
    'Song Title [abc123].info.json',
    'Song Title [abc123].webp',
    'Song Title [abc123].m4a',
    'Other Song [xyz789].info.json',
    'Other Song [xyz789].jpg',
    'Other Song [xyz789].opus'
  ];

  const map = collectTrackMetadata(names, '/tmp/job');

  assert.equal(map.size, 2);
  assert.deepEqual(map.get('Song Title [abc123]'), {
    infoPath: path.join('/tmp/job', 'Song Title [abc123].info.json'),
    thumbnailPath: path.join('/tmp/job', 'Song Title [abc123].webp')
  });
  assert.deepEqual(map.get('Other Song [xyz789]'), {
    infoPath: path.join('/tmp/job', 'Other Song [xyz789].info.json'),
    thumbnailPath: path.join('/tmp/job', 'Other Song [xyz789].jpg')
  });
});

test('collectTrackMetadata — ignoriert Mediendateien und unbekannte Extensions', (t) => {
  const names = ['Track.m4a', 'Track.info.json', 'Track.exe'];
  const map = collectTrackMetadata(names, '/tmp/job');
  assert.equal(map.size, 1);
  assert.ok(!map.get('Track').thumbnailPath);
});

test('collectTrackMetadata — info.json ohne Thumbnail funktioniert', (t) => {
  const names = ['Track.info.json'];
  const map = collectTrackMetadata(names, '/tmp/job');
  assert.equal(map.get('Track').infoPath, path.join('/tmp/job', 'Track.info.json'));
  assert.ok(!map.get('Track').thumbnailPath);
});

test('zipDirectory — schließt sc.cookies immer aus, unabhängig von excludeFileName', async (t) => {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'test-zip-'));
  try {
    await fsp.writeFile(path.join(tmpDir, 'track.mp3'), 'dummy-audio-content');
    await fsp.writeFile(path.join(tmpDir, 'sc.cookies'), 'oauth_token\tsecret-token-value');

    const zipName = 'out.zip';
    const zipPath = path.join(tmpDir, zipName);
    await zipDirectory(tmpDir, zipPath, zipName);

    const zipBuffer = await fsp.readFile(zipPath);
    const zipText = zipBuffer.toString('latin1');

    assert.ok(zipText.includes('track.mp3'), 'ZIP sollte die Mediendatei enthalten');
    assert.ok(!zipText.includes('sc.cookies'), 'ZIP darf die Cookie-Datei nicht enthalten');
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
});
