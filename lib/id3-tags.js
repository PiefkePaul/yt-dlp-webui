function pickFirstNonEmpty(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') {
      return value;
    }
  }
  return null;
}

function yearFromDateString(value) {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value)) {
    return null;
  }
  return value.slice(0, 4);
}

function parseArtistTitleFromVideoTitle(rawTitle) {
  if (typeof rawTitle !== 'string' || !rawTitle.trim()) {
    return null;
  }

  let title = rawTitle.trim();

  // Strip trailing annotations like "(Official Video)", "[4K Remaster]" — yt-dlp
  // doesn't natively expose track/artist for most YouTube videos, so we parse the
  // "Artist - Track" convention out of the title as a best-effort fallback.
  let strippedAnnotation = true;
  while (strippedAnnotation) {
    const withoutTrailingGroup = title.replace(/\s*[([][^()[\]]*[)\]]\s*$/, '');
    strippedAnnotation = withoutTrailingGroup !== title;
    title = withoutTrailingGroup;
  }

  // Strip trailing hashtag clusters, e.g. "#Acid #Techno"
  title = title.replace(/(\s*#\S+)+\s*$/, '').trim();

  const separatorMatch = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (!separatorMatch) {
    return null;
  }

  const artist = separatorMatch[1].trim();
  const track = separatorMatch[2].trim();

  if (!artist || !track) {
    return null;
  }

  return { artist, track };
}

function normalizeOverrides(overrides) {
  if (!overrides || typeof overrides !== 'object') {
    return null;
  }
  const normalized = {};
  for (const key of ['title', 'artist', 'album', 'year', 'genre']) {
    const value = overrides[key];
    if (typeof value === 'string' && value.trim() !== '') {
      normalized[key] = value.trim();
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : null;
}

function buildId3Tags(info, source, options = {}) {
  if (!info || typeof info !== 'object') {
    return null;
  }

  const { forceMusic = false, overrides: rawOverrides = null } = options;
  const overrides = normalizeOverrides(rawOverrides);

  const hasNativeMusicFields = Boolean(info.track && info.artist);
  const categories = Array.isArray(info.categories) ? info.categories : [];
  const isMusicCategory = categories.includes('Music');
  const parsedFromTitle = !hasNativeMusicFields && isMusicCategory
    ? parseArtistTitleFromVideoTitle(info.title)
    : null;

  const isRecognizedAsMusic = hasNativeMusicFields
    || Boolean(parsedFromTitle)
    || forceMusic
    || Boolean(overrides);

  if (source !== 'soundcloud' && !isRecognizedAsMusic) {
    return null;
  }

  const title = pickFirstNonEmpty(
    overrides && overrides.title,
    info.track,
    parsedFromTitle && parsedFromTitle.track,
    info.title
  );
  const artist = pickFirstNonEmpty(
    overrides && overrides.artist,
    info.artist,
    parsedFromTitle && parsedFromTitle.artist,
    info.creator,
    info.uploader,
    info.channel
  );
  const albumArtist = pickFirstNonEmpty(info.album_artist, artist);
  const album = pickFirstNonEmpty(overrides && overrides.album, info.album, info.playlist_title);
  const year = pickFirstNonEmpty(
    overrides && overrides.year,
    info.release_year != null ? String(info.release_year) : null,
    yearFromDateString(info.release_date),
    yearFromDateString(info.upload_date)
  );
  const genre = pickFirstNonEmpty(overrides && overrides.genre, info.genre);
  const trackNumber = pickFirstNonEmpty(
    info.track_number != null ? String(info.track_number) : null,
    info.playlist_index != null ? String(info.playlist_index) : null
  );

  const tags = {};
  if (title) tags.title = String(title);
  if (artist) tags.artist = String(artist);
  if (albumArtist) tags.album_artist = String(albumArtist);
  if (album) tags.album = String(album);
  if (year) tags.date = String(year);
  if (genre) tags.genre = String(genre);
  if (trackNumber) tags.track = String(trackNumber);

  return Object.keys(tags).length > 0 ? tags : null;
}

function buildFfmpegMetadataArgs(tags) {
  if (!tags) {
    return [];
  }

  const args = [];
  for (const [key, value] of Object.entries(tags)) {
    if (value === null || value === undefined || value === '') {
      continue;
    }
    args.push('-metadata', `${key}=${value}`);
  }
  return args;
}

module.exports = { buildId3Tags, buildFfmpegMetadataArgs };
