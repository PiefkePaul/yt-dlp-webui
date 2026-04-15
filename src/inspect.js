const { getSiteLabel, inferSiteKey } = require('./sites');

function createInspector(config, mediaTools) {
  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return '';
    }

    const totalSeconds = Math.round(seconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const remainingSeconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
    }

    return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
  }

  function normalizeEntry(entry) {
    if (!entry || typeof entry !== 'object') {
      return null;
    }

    const duration = Number(entry.duration);
    return {
      id: entry.id || null,
      title: entry.title || 'Unbenannter Eintrag',
      url: entry.url || entry.webpage_url || null,
      duration: Number.isFinite(duration) ? duration : null,
      durationLabel: Number.isFinite(duration) ? formatDuration(duration) : '',
      uploader: entry.uploader || entry.channel || null
    };
  }

  function isSoundcloudPreviewCandidate(item) {
    const text = [
      item?.url,
      item?.format_id,
      item?.format_note,
      item?.quality
    ].filter(Boolean).join(' ').toLowerCase();

    return Boolean(item?.snipped)
      || text.includes('/preview/')
      || /\/(?:preview|playlist)\/0\/30\//.test(text)
      || text.includes('preview');
  }

  function isSoundcloudPremiumCandidate(item) {
    const quality = String(item?.quality || '').trim().toLowerCase();
    const formatNote = String(item?.format_note || '').trim().toLowerCase();
    return quality === 'hq' || formatNote.includes('premium');
  }

  function getSoundcloudSignals(payload) {
    const transcodings = Array.isArray(payload?.media?.transcodings) ? payload.media.transcodings : [];
    const formats = Array.isArray(payload?.formats) ? payload.formats : [];
    const candidates = [...transcodings, ...formats];

    const hasPreviewFormats = candidates.some(isSoundcloudPreviewCandidate);
    const hasPremiumFormats = candidates.some(isSoundcloudPremiumCandidate);
    const hasStandardFormats = candidates.some((item) => (
      !isSoundcloudPreviewCandidate(item) && !isSoundcloudPremiumCandidate(item)
    ));

    return {
      hasPreviewFormats,
      hasPremiumFormats,
      hasStandardFormats,
      tokenRequired: hasPreviewFormats && !hasStandardFormats,
      tokenRecommended: hasPremiumFormats && !(hasPreviewFormats && !hasStandardFormats)
    };
  }

  function buildInspectMessages({ siteKey, isPlaylist, soundcloudSignals }) {
    const messages = [
      {
        tone: 'info',
        text: isPlaylist
          ? 'Playlist erkannt. Mehrere Dateien werden nach dem Download bei Bedarf als ZIP gebuendelt.'
          : 'Einzelner Eintrag erkannt. Der Download kann direkt gestartet werden.'
      }
    ];

    if (siteKey === 'soundcloud') {
      if (soundcloudSignals.tokenRequired) {
        messages.push({
          tone: 'warning',
          text: 'Der Track wirkt aktuell wie eine 30-Sekunden-SoundCloud-Vorschau. Trage im erweiterten Menue zuerst einen SoundCloud OAuth-Token ein, sonst wird nur die Preview geladen.'
        });
      } else if (soundcloudSignals.tokenRecommended) {
        messages.push({
          tone: 'info',
          text: 'Fuer SoundCloud-Go+/HQ-Varianten ist ein OAuth-Token sinnvoll. Ohne Token greift yt-dlp meist nur auf die frei verfuegbaren Varianten zu.'
        });
      } else {
        messages.push({
          tone: 'info',
          text: 'Bei SoundCloud helfen je nach Track Cookies oder ein OAuth-Token fuer diese Session, z.B. fuer private, region-gebundene oder HQ-Varianten.'
        });
      }
    } else if (siteKey === 'vimeo') {
      messages.push({
        tone: 'info',
        text: 'Bei Vimeo kannst du im erweiterten Menue bei Bedarf Referer, Video-Passwort, Cookies oder zusaetzliche extractor args fuer diese Session setzen.'
      });
    } else if (siteKey === 'generic') {
      messages.push({
        tone: 'info',
        text: 'Die Weboberflaeche arbeitet generisch mit yt-dlp. Fuer spezielle Seiten kannst du im erweiterten Menue Cookies, Header, Referer oder extractor args pro Session mitgeben.'
      });
    }

    return messages;
  }

  function normalizeInspectData(url, payload, sessionOptions) {
    const playlistEntries = Array.isArray(payload.entries)
      ? payload.entries.map(normalizeEntry).filter(Boolean)
      : [];
    const isPlaylist = payload._type === 'playlist' || playlistEntries.length > 0;
    const duration = Number(payload.duration);
    const extractor = payload.extractor_key || payload.extractor || null;
    const siteKey = inferSiteKey({ url, extractor });
    const soundcloudSignals = siteKey === 'soundcloud'
      ? getSoundcloudSignals(payload)
      : {
          hasPreviewFormats: false,
          hasPremiumFormats: false,
          hasStandardFormats: false,
          tokenRequired: false,
          tokenRecommended: false
        };

    return {
      originalUrl: url,
      webpageUrl: payload.webpage_url || payload.original_url || url,
      title: payload.title || payload.playlist_title || 'Unbekannter Inhalt',
      uploader: payload.uploader || payload.channel || null,
      extractor,
      siteKey,
      siteLabel: getSiteLabel(siteKey, extractor),
      duration: Number.isFinite(duration) ? duration : null,
      durationLabel: Number.isFinite(duration) ? formatDuration(duration) : '',
      thumbnail: payload.thumbnail || null,
      isPlaylist,
      playlistCount: Number.isFinite(Number(payload.playlist_count))
        ? Number(payload.playlist_count)
        : (Number.isFinite(Number(payload.n_entries)) ? Number(payload.n_entries) : playlistEntries.length),
      entries: playlistEntries.slice(0, config.inspectEntryLimit),
      entriesTruncated: playlistEntries.length >= config.inspectEntryLimit
        && (Number(payload.playlist_count) || playlistEntries.length) > config.inspectEntryLimit,
      requirements: {
        soundcloudTokenRequired: soundcloudSignals.tokenRequired,
        soundcloudTokenRecommended: soundcloudSignals.tokenRecommended,
        soundcloudTokenProvided: Boolean(sessionOptions?.soundcloudOauthToken)
      },
      soundcloud: siteKey === 'soundcloud' ? soundcloudSignals : null,
      messages: buildInspectMessages({
        siteKey,
        isPlaylist,
        soundcloudSignals
      })
    };
  }

  async function inspectUrl(url, sessionOptions) {
    const requestOptions = await mediaTools.prepareRequestOptions({
      url,
      sessionOptions,
      workingDirectory: config.tmpDir,
      filePrefix: 'inspect'
    });

    try {
      const result = await mediaTools.runProcessCapture(
        'yt-dlp',
        mediaTools.buildInspectArgs(url, requestOptions.args)
      );
      const trimmed = result.stdout.trim();

      if (!trimmed) {
        throw new Error('yt-dlp hat keine auswertbaren Metadaten geliefert.');
      }

      let payload;
      try {
        payload = JSON.parse(trimmed);
      } catch (error) {
        throw new Error(`Inspect-Ausgabe konnte nicht gelesen werden: ${error.message}`);
      }

      return normalizeInspectData(url, payload, requestOptions.options);
    } finally {
      await requestOptions.cleanup();
    }
  }

  return {
    inspectUrl
  };
}

module.exports = {
  createInspector
};
