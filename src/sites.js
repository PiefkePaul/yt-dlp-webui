function getHostname(url) {
  try {
    return new URL(url).hostname.trim().toLowerCase();
  } catch {
    return '';
  }
}

function looksLikeSoundCloudUrl(url) {
  const hostname = getHostname(url);
  return hostname === 'soundcloud.com'
    || hostname === 'm.soundcloud.com'
    || hostname === 'api.soundcloud.com'
    || hostname === 'on.soundcloud.com'
    || hostname.endsWith('.soundcloud.com')
    || hostname === 'snd.sc';
}

function inferSiteKey({ url, extractor }) {
  const hostname = getHostname(url);
  const normalizedExtractor = String(extractor || '').trim().toLowerCase();

  if (normalizedExtractor.includes('soundcloud') || looksLikeSoundCloudUrl(url)) {
    return 'soundcloud';
  }

  if (normalizedExtractor.includes('vimeo') || hostname === 'vimeo.com' || hostname.endsWith('.vimeo.com')) {
    return 'vimeo';
  }

  if (normalizedExtractor.includes('youtube')
    || hostname === 'youtube.com'
    || hostname.endsWith('.youtube.com')
    || hostname === 'youtu.be') {
    return 'youtube';
  }

  if (normalizedExtractor.includes('bandcamp') || hostname.endsWith('.bandcamp.com')) {
    return 'bandcamp';
  }

  if (normalizedExtractor.includes('tiktok') || hostname.endsWith('.tiktok.com')) {
    return 'tiktok';
  }

  if (normalizedExtractor.includes('twitch')
    || hostname === 'twitch.tv'
    || hostname.endsWith('.twitch.tv')) {
    return 'twitch';
  }

  return 'generic';
}

function getSiteLabel(siteKey, extractor) {
  const labels = {
    soundcloud: 'SoundCloud',
    vimeo: 'Vimeo',
    youtube: 'YouTube',
    bandcamp: 'Bandcamp',
    tiktok: 'TikTok',
    twitch: 'Twitch',
    generic: extractor || 'Unterstuetzte Quelle'
  };

  return labels[siteKey] || labels.generic;
}

module.exports = {
  getSiteLabel,
  inferSiteKey,
  looksLikeSoundCloudUrl
};
