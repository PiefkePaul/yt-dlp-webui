const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildM3u8Content } = require('../lib/m3u8-playlist');

test('buildM3u8Content — einzelner Track mit Artist und Duration', (t) => {
  const content = buildM3u8Content([
    { title: 'Never Gonna Give You Up', artist: 'Rick Astley', duration: 213, fileName: 'rick_astley.mp3' }
  ]);

  assert.equal(
    content,
    '#EXTM3U\n#EXTINF:213,Rick Astley - Never Gonna Give You Up\nrick_astley.mp3\n'
  );
});

test('buildM3u8Content — Track ohne Artist zeigt nur den Titel im Label', (t) => {
  const content = buildM3u8Content([
    { title: 'Some Track', artist: null, duration: 100, fileName: 'some_track.mp3' }
  ]);

  assert.equal(content, '#EXTM3U\n#EXTINF:100,Some Track\nsome_track.mp3\n');
});

test('buildM3u8Content — Track ohne Duration nutzt -1 (M3U8-Standard fuer unbekannt)', (t) => {
  const content = buildM3u8Content([
    { title: 'Some Track', artist: null, duration: null, fileName: 'some_track.mp3' }
  ]);

  assert.equal(content, '#EXTM3U\n#EXTINF:-1,Some Track\nsome_track.mp3\n');
});

test('buildM3u8Content — mehrere Tracks behalten Eingabe-Reihenfolge', (t) => {
  const content = buildM3u8Content([
    { title: 'Track A', artist: 'Artist A', duration: 100, fileName: 'a.mp3' },
    { title: 'Track B', artist: 'Artist B', duration: 200, fileName: 'b.mp3' }
  ]);

  assert.equal(
    content,
    '#EXTM3U\n#EXTINF:100,Artist A - Track A\na.mp3\n#EXTINF:200,Artist B - Track B\nb.mp3\n'
  );
});

test('buildM3u8Content — Sonderzeichen im Titel werden unveraendert durchgereicht', (t) => {
  const content = buildM3u8Content([
    { title: 'Röck, Jäzz & Pöp', artist: 'Ünïcode Ärtïst', duration: 50, fileName: 'x.mp3' }
  ]);

  assert.equal(content, '#EXTM3U\n#EXTINF:50,Ünïcode Ärtïst - Röck, Jäzz & Pöp\nx.mp3\n');
});

test('buildM3u8Content — leeres Array ergibt nur den Header', (t) => {
  assert.equal(buildM3u8Content([]), '#EXTM3U\n');
});
