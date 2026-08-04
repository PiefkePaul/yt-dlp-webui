const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildId3Tags, buildFfmpegMetadataArgs } = require('../lib/id3-tags');

test('buildId3Tags — vollständige YouTube-Music-Metadaten ergeben alle Felder', (t) => {
  const info = {
    track: 'Song Title',
    title: 'Song Title (Official Audio)',
    artist: 'Some Artist',
    album: 'Some Album',
    album_artist: 'Some Artist',
    release_year: 2023,
    genre: 'Pop',
    track_number: 5,
    playlist_index: 2
  };

  const tags = buildId3Tags(info, 'other');

  assert.deepEqual(tags, {
    title: 'Song Title',
    artist: 'Some Artist',
    album_artist: 'Some Artist',
    album: 'Some Album',
    date: '2023',
    genre: 'Pop',
    track: '5'
  });
});

test('buildId3Tags — SoundCloud ohne album/track wird trotzdem getaggt, Fallbacks greifen', (t) => {
  const info = {
    title: 'Karma (Extended Mix)',
    uploader: 'ViniVici',
    upload_date: '20230615'
  };

  const tags = buildId3Tags(info, 'soundcloud');

  assert.deepEqual(tags, {
    title: 'Karma (Extended Mix)',
    artist: 'ViniVici',
    album_artist: 'ViniVici',
    date: '2023'
  });
});

test('buildId3Tags — reguläres YouTube-Video ohne track/artist wird nicht getaggt', (t) => {
  const info = {
    title: 'How to fix your bike',
    uploader: 'Some Channel',
    upload_date: '20220101'
  };

  assert.equal(buildId3Tags(info, 'other'), null);
});

test('buildId3Tags — release_year hat Vorrang vor release_date und upload_date', (t) => {
  const info = {
    track: 'X', artist: 'Y',
    release_year: 2019,
    release_date: '20200101',
    upload_date: '20210101'
  };

  assert.equal(buildId3Tags(info, 'other').date, '2019');
});

test('buildId3Tags — release_date greift wenn release_year fehlt', (t) => {
  const info = { track: 'X', artist: 'Y', release_date: '20200101', upload_date: '20210101' };
  assert.equal(buildId3Tags(info, 'other').date, '2020');
});

test('buildId3Tags — playlist_index als Tracknummer-Fallback bei Playlist-Downloads', (t) => {
  const info = { track: 'X', artist: 'Y', playlist_index: 3 };
  assert.equal(buildId3Tags(info, 'other').track, '3');
});

test('buildId3Tags — playlist_title als Album-Fallback', (t) => {
  const info = { track: 'X', artist: 'Y', playlist_title: 'My YT Music Album' };
  assert.equal(buildId3Tags(info, 'other').album, 'My YT Music Album');
});

test('buildId3Tags — parst Artist/Titel aus Video-Titel wenn track/artist fehlen, aber categories=Music vorhanden', (t) => {
  const info = {
    title: 'Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)',
    categories: ['Music'],
    channel: 'Rick Astley'
  };

  const tags = buildId3Tags(info, 'other');

  assert.equal(tags.artist, 'Rick Astley');
  assert.equal(tags.title, 'Never Gonna Give You Up');
});

test('buildId3Tags — Titel-Parsing entfernt Hashtag-Suffixe', (t) => {
  const info = {
    title: 'Teik Arô - Acid Resurrection Pt 2 (#Acid #Techno)',
    categories: ['Music'],
    channel: 'Teik Arô'
  };

  const tags = buildId3Tags(info, 'other');

  assert.equal(tags.artist, 'Teik Arô');
  assert.equal(tags.title, 'Acid Resurrection Pt 2');
});

test('buildId3Tags — Titel-Parsing greift NICHT ohne categories=Music (verhindert False-Positives)', (t) => {
  const info = {
    title: 'How to fix your bike - Beginner Tutorial',
    categories: ['Howto & Style'],
    channel: 'Some Channel'
  };

  assert.equal(buildId3Tags(info, 'other'), null);
});

test('buildId3Tags — categories=Music aber Titel ohne "Artist - Track"-Muster bleibt ungetaggt', (t) => {
  const info = {
    title: 'Some Random Video Without A Separator',
    categories: ['Music'],
    channel: 'Some Channel'
  };

  assert.equal(buildId3Tags(info, 'other'), null);
});

test('buildId3Tags — native track/artist haben Vorrang vor Titel-Parsing', (t) => {
  const info = {
    track: 'Real Track Title',
    artist: 'Real Artist',
    title: 'Something Else - Not The Real Data (Official Video)',
    categories: ['Music']
  };

  const tags = buildId3Tags(info, 'other');

  assert.equal(tags.artist, 'Real Artist');
  assert.equal(tags.title, 'Real Track Title');
});

test('buildId3Tags — leere/kaputte info gibt null zurück', (t) => {
  assert.equal(buildId3Tags(null, 'soundcloud'), null);
  assert.equal(buildId3Tags(undefined, 'other'), null);
  assert.equal(buildId3Tags({}, 'soundcloud'), null);
});

test('buildFfmpegMetadataArgs — baut -metadata Paare für gesetzte Felder in Reihenfolge', (t) => {
  const args = buildFfmpegMetadataArgs({ title: 'A', artist: 'B' });
  assert.deepEqual(args, ['-metadata', 'title=A', '-metadata', 'artist=B']);
});

test('buildFfmpegMetadataArgs — leere/null Tags ergeben leeres Array', (t) => {
  assert.deepEqual(buildFfmpegMetadataArgs(null), []);
  assert.deepEqual(buildFfmpegMetadataArgs({}), []);
});
