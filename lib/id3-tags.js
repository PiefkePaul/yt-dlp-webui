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

function buildId3Tags(info, source) {
  if (!info || typeof info !== 'object') {
    return null;
  }

  const hasNativeMusicFields = Boolean(info.track && info.artist);
  const categories = Array.isArray(info.categories) ? info.categories : [];
  const isMusicCategory = categories.includes('Music');
  const parsedFromTitle = !hasNativeMusicFields && isMusicCategory
    ? parseArtistTitleFromVideoTitle(info.title)
    : null;

  const isRecognizedAsMusic = hasNativeMusicFields || Boolean(parsedFromTitle);
  if (source !== 'soundcloud' && !isRecognizedAsMusic) {
    return null;
  }

  const title = pickFirstNonEmpty(info.track, parsedFromTitle && parsedFromTitle.track, info.title);
  const artist = pickFirstNonEmpty(
    info.artist,
    parsedFromTitle && parsedFromTitle.artist,
    info.creator,
    info.uploader,
    info.channel
  );
  const albumArtist = pickFirstNonEmpty(info.album_artist, artist);
  const album = pickFirstNonEmpty(info.album, info.playlist_title);
  const year = pickFirstNonEmpty(
    info.release_year != null ? String(info.release_year) : null,
    yearFromDateString(info.release_date),
    yearFromDateString(info.upload_date)
  );
  const genre = info.genre || null;
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
