const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

function sanitizeInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function normalizeBoolean(value, fallback) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function normalizeBaseUrl(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }

  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function normalizeHwAccelPreference(value) {
  const normalized = String(value || 'auto').trim().toLowerCase();
  return ['auto', 'none', 'qsv'].includes(normalized) ? normalized : 'auto';
}

function resolvePathValue(value, cwd = process.cwd()) {
  if (!value) {
    return '';
  }

  return path.isAbsolute(value) ? value : path.resolve(cwd, value);
}

function parseAllowedOrigins(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return [];
  }

  if (normalized === '*') {
    return ['*'];
  }

  return normalized
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function createConfig(env = process.env) {
  const publicDemoMessage = (env.PUBLIC_DEMO_MESSAGE || '').trim()
    || 'Diese Seite ist aktuell nur eine statische Vorschau ohne angebundenes Backend.';

  return {
    repoRoot: REPO_ROOT,
    port: sanitizeInteger(env.PORT || 3000, 3000, 0, 65535),
    tmpDir: resolvePathValue(env.TMP_DIR || path.join(REPO_ROOT, 'tmp')),
    jobTtlMs: sanitizeInteger(env.JOB_TTL_MS || (30 * 60 * 1000), 30 * 60 * 1000, 60 * 1000, 24 * 60 * 60 * 1000),
    maxConcurrentJobs: sanitizeInteger(env.MAX_CONCURRENT_JOBS || 1, 1, 1, 4),
    inspectEntryLimit: sanitizeInteger(env.INSPECT_ENTRY_LIMIT || 12, 12, 1, 50),
    ytdlpCookiesFile: env.YTDLP_COOKIES_FILE ? resolvePathValue(env.YTDLP_COOKIES_FILE) : '',
    publicApiBaseUrl: normalizeBaseUrl(env.PUBLIC_API_BASE_URL || ''),
    publicDemoMode: normalizeBoolean(env.PUBLIC_DEMO_MODE, false),
    publicDemoMessage,
    corsAllowedOrigins: parseAllowedOrigins(env.CORS_ALLOWED_ORIGINS),
    skipRuntimeChecks: normalizeBoolean(env.SKIP_RUNTIME_CHECKS, false),
    skipFfmpegProbe: normalizeBoolean(env.SKIP_FFMPEG_PROBE, false),
    ffmpeg: {
      requestedHwAccel: normalizeHwAccelPreference(env.FFMPEG_HWACCEL),
      mp4HwEncoder: (env.FFMPEG_MP4_HW_ENCODER || 'h264_qsv').trim().toLowerCase(),
      qsvPreset: (env.FFMPEG_QSV_PRESET || 'medium').trim().toLowerCase(),
      qsvGlobalQuality: sanitizeInteger(env.FFMPEG_QSV_GLOBAL_QUALITY, 23, 1, 51),
      x264Preset: (env.FFMPEG_X264_PRESET || 'medium').trim().toLowerCase(),
      x264Crf: sanitizeInteger(env.FFMPEG_X264_CRF, 23, 0, 51),
      aacBitrate: sanitizeInteger(env.FFMPEG_AAC_BITRATE, 192, 32, 320)
    }
  };
}

function buildPublicClientConfig(config) {
  return {
    apiBaseUrl: config.publicApiBaseUrl ? config.publicApiBaseUrl.replace(/\/$/, '') : '',
    demoMode: config.publicDemoMode,
    demoMessage: config.publicDemoMessage
  };
}

module.exports = {
  buildPublicClientConfig,
  createConfig,
  normalizeBoolean,
  normalizeBaseUrl,
  normalizeHwAccelPreference,
  parseAllowedOrigins,
  REPO_ROOT,
  resolvePathValue,
  sanitizeInteger
};
