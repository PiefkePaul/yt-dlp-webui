const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const { spawn } = require('child_process');
const archiver = require('archiver');

const DEFAULT_PORT = Number(process.env.PORT || 3000);
const DEFAULT_TMP_DIR = resolvePathValue(process.env.TMP_DIR || path.join(__dirname, 'tmp'));
const JOB_TTL_MS = Number(process.env.JOB_TTL_MS || 30 * 60 * 1000);
const YTDLP_COOKIES_FILE = process.env.YTDLP_COOKIES_FILE
  ? resolvePathValue(process.env.YTDLP_COOKIES_FILE)
  : '';

const PUBLIC_API_BASE_URL = normalizeBaseUrl(process.env.PUBLIC_API_BASE_URL || '');
const PUBLIC_DEMO_MODE = normalizeBoolean(process.env.PUBLIC_DEMO_MODE, false);
const PUBLIC_DEMO_MESSAGE = (process.env.PUBLIC_DEMO_MESSAGE || '').trim()
  || 'Diese Seite ist aktuell nur eine statische Vorschau ohne angebundenes Backend.';
const CORS_ALLOWED_ORIGINS = parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS);
const SKIP_RUNTIME_CHECKS = normalizeBoolean(process.env.SKIP_RUNTIME_CHECKS, false);
const SKIP_FFMPEG_PROBE = normalizeBoolean(process.env.SKIP_FFMPEG_PROBE, false);

const FFMPEG_HWACCEL = normalizeHwAccelPreference(process.env.FFMPEG_HWACCEL);
const FFMPEG_MP4_HW_ENCODER = (process.env.FFMPEG_MP4_HW_ENCODER || 'h264_qsv').trim().toLowerCase();
const FFMPEG_QSV_PRESET = (process.env.FFMPEG_QSV_PRESET || 'medium').trim().toLowerCase();
const FFMPEG_QSV_GLOBAL_QUALITY = sanitizeInteger(process.env.FFMPEG_QSV_GLOBAL_QUALITY, 23, 1, 51);
const FFMPEG_X264_PRESET = (process.env.FFMPEG_X264_PRESET || 'medium').trim().toLowerCase();
const FFMPEG_X264_CRF = sanitizeInteger(process.env.FFMPEG_X264_CRF, 23, 0, 51);
const FFMPEG_AAC_BITRATE = sanitizeInteger(process.env.FFMPEG_AAC_BITRATE, 192, 32, 320);

const FFMPEG_DURATION_RE = /Duration:\s+(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/;
const FFMPEG_TIME_RE = /time=(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/;
const YTDLP_PERCENT_RE = /\[download\]\s+(\d+(?:\.\d+)?)%/;

const app = express();
const jobs = new Map();

const runtimeState = {
  tmpDir: DEFAULT_TMP_DIR,
  jobTtlMs: JOB_TTL_MS,
  runtimeChecksSkipped: SKIP_RUNTIME_CHECKS,
  ffmpegProbeSkipped: SKIP_FFMPEG_PROBE
};

let ffmpegRuntime = createDefaultFfmpegRuntime();

app.set('trust proxy', true);
app.use(createCorsMiddleware());
app.use(express.json());
app.get('/app-config.js', (_req, res) => {
  res.type('application/javascript');
  res.send(`window.APP_CONFIG = ${JSON.stringify(buildPublicClientConfig(), null, 2)};\n`);
});
app.use(express.static(path.join(__dirname, 'public')));

function sanitizeInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function normalizeBoolean(value, fallback) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function normalizeBaseUrl(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function normalizeHwAccelPreference(value) {
  const normalized = String(value || 'auto').trim().toLowerCase();
  return ['auto', 'none', 'qsv'].includes(normalized) ? normalized : 'auto';
}

function resolvePathValue(value) {
  if (!value) return '';
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

function parseAllowedOrigins(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return [];
  if (normalized === '*') return ['*'];
  return normalized.split(',').map((item) => item.trim()).filter(Boolean);
}

function appendVary(currentValue, value) {
  const values = String(currentValue || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (!values.includes(value)) {
    values.push(value);
  }

  return values.join(', ');
}

function createCorsMiddleware() {
  return (req, res, next) => {
    const origin = req.get('origin');
    const allowedOrigin = resolveAllowedOrigin(origin);

    if (allowedOrigin) {
      res.set('Access-Control-Allow-Origin', allowedOrigin);
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      if (allowedOrigin !== '*') {
        res.set('Vary', appendVary(res.get('Vary'), 'Origin'));
      }
    }

    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }

    next();
  };
}

function resolveAllowedOrigin(origin) {
  if (!origin || CORS_ALLOWED_ORIGINS.length === 0) {
    return null;
  }

  if (CORS_ALLOWED_ORIGINS.includes('*')) {
    return '*';
  }

  return CORS_ALLOWED_ORIGINS.includes(origin) ? origin : null;
}

function buildPublicClientConfig() {
  return {
    apiBaseUrl: PUBLIC_API_BASE_URL ? PUBLIC_API_BASE_URL.replace(/\/$/, '') : '',
    demoMode: PUBLIC_DEMO_MODE,
    demoMessage: PUBLIC_DEMO_MESSAGE
  };
}

function getSoftwareMp4TranscodeProfile() {
  return {
    mode: 'software',
    label: 'Software (libx264)',
    videoCodec: 'libx264',
    videoArgs: [
      '-preset', FFMPEG_X264_PRESET,
      '-crf', String(FFMPEG_X264_CRF),
      '-pix_fmt', 'yuv420p'
    ],
    audioCodec: 'aac',
    audioArgs: ['-b:a', `${FFMPEG_AAC_BITRATE}k`]
  };
}

function getQuickSyncMp4TranscodeProfile() {
  return {
    mode: 'qsv',
    label: `Intel Quick Sync (${FFMPEG_MP4_HW_ENCODER})`,
    videoCodec: FFMPEG_MP4_HW_ENCODER,
    videoArgs: [
      '-preset', FFMPEG_QSV_PRESET,
      '-global_quality', String(FFMPEG_QSV_GLOBAL_QUALITY)
    ],
    audioCodec: 'aac',
    audioArgs: ['-b:a', `${FFMPEG_AAC_BITRATE}k`]
  };
}

function createDefaultFfmpegRuntime() {
  return {
    version: null,
    hwaccels: [],
    encoders: [],
    quickSyncDetected: false,
    quickSyncAvailable: false,
    requestedHwAccel: FFMPEG_HWACCEL,
    preferredMp4Profile: getSoftwareMp4TranscodeProfile(),
    probeError: null,
    quickSyncProbeError: null,
    probedAt: null
  };
}

function parseFfmpegHwaccels(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => /^[a-z0-9_]+$/.test(line) && line !== 'hardware acceleration methods:');
}

function parseFfmpegEncoders(text) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^\s*[A-Z.]{6}\s+([^\s]+)/);
      return match ? match[1].toLowerCase() : null;
    })
    .filter(Boolean);
}

function resolvePreferredMp4TranscodeProfile(runtime) {
  if (FFMPEG_HWACCEL === 'none') {
    return getSoftwareMp4TranscodeProfile();
  }

  if (runtime.quickSyncAvailable) {
    return getQuickSyncMp4TranscodeProfile();
  }

  return getSoftwareMp4TranscodeProfile();
}

async function runProcessCapture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (buffer) => {
      stdout += buffer.toString();
    });

    child.stderr.on('data', (buffer) => {
      stderr += buffer.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, combined: `${stdout}${stderr}` });
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} fehlgeschlagen (Exit-Code ${code}).`));
    });
  });
}

async function verifyRequiredBinaries() {
  const binaries = [
    {
      command: 'yt-dlp',
      args: ['--version'],
      hint: 'Installiere yt-dlp und stelle sicher, dass `yt-dlp` im PATH liegt.'
    },
    {
      command: 'ffmpeg',
      args: ['-hide_banner', '-version'],
      hint: 'Installiere FFmpeg und stelle sicher, dass `ffmpeg` im PATH liegt.'
    },
    {
      command: 'deno',
      args: ['--version'],
      hint: 'Installiere Deno oder entferne die Abhaengigkeit in den yt-dlp-JS-Runtime-Optionen.'
    }
  ];

  const missing = [];

  for (const binary of binaries) {
    try {
      await runProcessCapture(binary.command, binary.args);
    } catch (error) {
      missing.push({
        command: binary.command,
        hint: binary.hint,
        error: error.message
      });
    }
  }

  if (missing.length === 0) {
    return;
  }

  const message = [
    'Fehlende Runtime-Abhaengigkeiten erkannt:',
    ...missing.map((item) => `- ${item.command}: ${item.hint} (${item.error})`),
    '',
    'Du kannst alternativ weiterhin Docker verwenden; dort werden die benoetigten Binaries beim Image-Build installiert.'
  ].join('\n');

  throw new Error(message);
}

async function probeFfmpegRuntime() {
  const runtime = createDefaultFfmpegRuntime();
  runtime.probedAt = new Date().toISOString();

  try {
    const versionResult = await runProcessCapture('ffmpeg', ['-hide_banner', '-version']);
    runtime.version = versionResult.combined.split(/\r?\n/).find(Boolean)?.trim() || null;

    const hwaccelsResult = await runProcessCapture('ffmpeg', ['-hide_banner', '-hwaccels']);
    runtime.hwaccels = parseFfmpegHwaccels(hwaccelsResult.combined);

    const encodersResult = await runProcessCapture('ffmpeg', ['-hide_banner', '-encoders']);
    runtime.encoders = parseFfmpegEncoders(encodersResult.combined);
    runtime.quickSyncDetected = runtime.hwaccels.includes('qsv') && runtime.encoders.includes(FFMPEG_MP4_HW_ENCODER);

    if (runtime.quickSyncDetected && FFMPEG_HWACCEL !== 'none') {
      try {
        await runProcessCapture('ffmpeg', [
          '-hide_banner',
          '-loglevel', 'error',
          '-f', 'lavfi',
          '-i', 'testsrc2=size=128x72:rate=30',
          '-frames:v', '1',
          '-an',
          '-c:v', FFMPEG_MP4_HW_ENCODER,
          '-preset', FFMPEG_QSV_PRESET,
          '-global_quality', String(FFMPEG_QSV_GLOBAL_QUALITY),
          '-f', 'null',
          '-'
        ]);

        runtime.quickSyncAvailable = true;
      } catch (error) {
        runtime.quickSyncProbeError = error.message;
      }
    }
  } catch (error) {
    runtime.probeError = error.message;
  }

  runtime.preferredMp4Profile = resolvePreferredMp4TranscodeProfile(runtime);
  return runtime;
}

function safeBaseName(name) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

async function ensureDirs() {
  await fsp.mkdir(runtimeState.tmpDir, { recursive: true });
}

async function cleanupTmpOnStartup() {
  const entries = await fsp.readdir(runtimeState.tmpDir, { withFileTypes: true });

  await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(runtimeState.tmpDir, entry.name);
    await fsp.rm(entryPath, { recursive: true, force: true });
  }));
}

function appendRawLog(job, text) {
  if (!text) return;
  job.rawLog.push(text);
  if (job.rawLog.length > 400) job.rawLog.shift();
}

function appendEvent(job, text) {
  if (!text) return;

  const normalized = text.trim();
  if (!normalized) return;
  if (job.log[job.log.length - 1] === normalized) return;

  job.log.push(normalized);
  if (job.log.length > 50) job.log.shift();
}

function clampProgress(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function updateProgress(job, value, stage) {
  job.progress = clampProgress(value);
  if (stage) {
    job.stage = stage;
  }
}

function toSeconds(hours, minutes, seconds) {
  return (Number(hours) * 3600) + (Number(minutes) * 60) + Number(seconds);
}

function processYtdlpOutput(job, text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    if (line.startsWith('[youtube] Extracting URL:')) {
      appendEvent(job, 'Link wird analysiert...');
      updateProgress(job, 5, 'analyze');
      continue;
    }

    if (line.includes('Downloading webpage')) {
      appendEvent(job, 'Videoinformationen werden geladen...');
      updateProgress(job, 10, 'analyze');
      continue;
    }

    if (line.includes('Downloading android') || line.includes('Downloading player')) {
      appendEvent(job, 'Quelle wird vorbereitet...');
      updateProgress(job, 15, 'analyze');
      continue;
    }

    if (line.startsWith('[info]') && line.includes('Downloading')) {
      appendEvent(job, 'Download wird vorbereitet...');
      updateProgress(job, 20, 'download');
      continue;
    }

    if (line.startsWith('[download] Destination:')) {
      appendEvent(job, 'Datei wird heruntergeladen...');
      updateProgress(job, 25, 'download');
      continue;
    }

    const percentMatch = line.match(YTDLP_PERCENT_RE);
    if (percentMatch) {
      const percent = Number(percentMatch[1]);
      updateProgress(job, 25 + (percent * 0.5), 'download');
      continue;
    }

    if (line.startsWith('[download] Download completed')) {
      if (job.requiresConversion) {
        appendEvent(job, job.format === 'mp4'
          ? 'Download abgeschlossen, MP4-Konvertierung startet...'
          : 'Download abgeschlossen, MP3-Konvertierung startet...');
        updateProgress(job, 55, 'convert');
      } else {
        appendEvent(job, 'Download abgeschlossen.');
        updateProgress(job, 100, 'done');
      }
      continue;
    }

    if (line.startsWith('WARNING:')) {
      appendEvent(job, `Hinweis: ${line.replace(/^WARNING:\s*/, '')}`);
    }
  }
}

function getConversionStatusText(job) {
  if (job.conversionKind === 'mp4') {
    return job.ffmpegMode === 'qsv'
      ? 'Video wird mit Intel Quick Sync in MP4 konvertiert...'
      : 'Video wird in MP4 konvertiert...';
  }

  return 'Audio wird in MP3 konvertiert...';
}

function processFfmpegOutput(job, text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    const durationMatch = line.match(FFMPEG_DURATION_RE);
    if (durationMatch) {
      job.conversionDurationSec = toSeconds(durationMatch[1], durationMatch[2], durationMatch[3]);
      appendEvent(job, getConversionStatusText(job));
      updateProgress(job, 60, 'convert');
      continue;
    }

    const timeMatch = line.match(FFMPEG_TIME_RE);
    if (timeMatch && job.conversionDurationSec) {
      const processedSec = toSeconds(timeMatch[1], timeMatch[2], timeMatch[3]);
      const ratio = Math.min(processedSec / job.conversionDurationSec, 1);
      updateProgress(job, 60 + (ratio * 35), 'convert');
    }
  }
}

function handleProcessOutput(job, source, text) {
  appendRawLog(job, text);

  if (source === 'ytdlp') {
    processYtdlpOutput(job, text);
    return;
  }

  if (source === 'ffmpeg') {
    processFfmpegOutput(job, text);
  }
}

function getAudioArgs() {
  return ['-f', 'bestaudio/best'];
}

function getAudioBitrate(quality) {
  return ['320', '192', '128'].includes(quality) ? quality : '320';
}

function getVideoArgs(quality) {
  if (quality === 'best') {
    return ['-f', 'bv*+ba/b'];
  }

  const height = ['1080', '720', '480'].includes(quality) ? quality : '1080';
  return ['-f', `bv*[height<=${height}]+ba/b[height<=${height}]/b`];
}

function getCookieArgs() {
  if (YTDLP_COOKIES_FILE && fs.existsSync(YTDLP_COOKIES_FILE)) {
    return ['--cookies', YTDLP_COOKIES_FILE];
  }
  return [];
}

function buildArgs({ url, format, quality, targetDir }) {
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

  const formatArgs = format === 'mp4' ? getVideoArgs(quality) : getAudioArgs(quality);
  return [...common, ...getCookieArgs(), ...formatArgs, url];
}

async function convertToMp3(inputPath, bitrate, logFn) {
  const outputPath = inputPath.replace(/\.[^.]+$/, '') + '.mp3';

  await new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-y',
      '-i', inputPath,
      '-vn',
      '-c:a', 'libmp3lame',
      '-b:a', `${bitrate}k`,
      outputPath
    ]);

    ffmpeg.stdout.on('data', (buffer) => logFn(buffer.toString()));
    ffmpeg.stderr.on('data', (buffer) => logFn(buffer.toString()));

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error('FFmpeg-Konvertierung nach MP3 ist fehlgeschlagen.'));
      }
    });

    ffmpeg.on('error', reject);
  });

  await fsp.unlink(inputPath);
  return outputPath;
}

async function convertToMp4(inputPath, profile, logFn) {
  const targetPath = inputPath.replace(/\.[^.]+$/, '') + '.mp4';
  const tempOutputPath = inputPath.toLowerCase().endsWith('.mp4')
    ? inputPath.replace(/\.mp4$/i, '.converted.mp4')
    : targetPath;

  await new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-y',
      '-i', inputPath,
      '-map', '0:v:0?',
      '-map', '0:a?',
      '-movflags', '+faststart',
      '-c:v', profile.videoCodec,
      ...profile.videoArgs,
      '-c:a', profile.audioCodec,
      ...profile.audioArgs,
      tempOutputPath
    ]);

    ffmpeg.stdout.on('data', (buffer) => logFn(buffer.toString()));
    ffmpeg.stderr.on('data', (buffer) => logFn(buffer.toString()));

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error('FFmpeg-Konvertierung nach MP4 ist fehlgeschlagen.'));
      }
    });

    ffmpeg.on('error', reject);
  });

  await fsp.unlink(inputPath);

  if (tempOutputPath !== targetPath) {
    await fsp.rename(tempOutputPath, targetPath);
  }

  return targetPath;
}

async function zipDirectory(sourceDir, outPath, excludeFileName = null) {
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);

    archive.pipe(output);
    archive.glob('**/*', {
      cwd: sourceDir,
      nodir: true,
      ignore: excludeFileName ? [excludeFileName] : []
    });

    archive.finalize();
  });
}

async function cleanupDirectory(dirPath) {
  try {
    await fsp.rm(dirPath, { recursive: true, force: true });
  } catch {
    // Cleanup soll keinen laufenden oder fertigen Job stoeren
  }
}

function scheduleJobCleanup(job) {
  if (job.cleanupTimer) {
    clearTimeout(job.cleanupTimer);
  }

  job.expiresAt = new Date(Date.now() + runtimeState.jobTtlMs).toISOString();

  job.cleanupTimer = setTimeout(async () => {
    try {
      await cleanupDirectory(job.targetDir);
    } finally {
      jobs.delete(job.id);
    }
  }, runtimeState.jobTtlMs);
}

function resolveRequestBaseUrl(req) {
  if (PUBLIC_API_BASE_URL) {
    return PUBLIC_API_BASE_URL;
  }

  const host = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  if (!host) {
    return '';
  }

  const protocol = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
  return `${protocol}://${host}/`;
}

function resolveDownloadUrl(req, job) {
  const relativePath = `/api/file/${job.id}`;
  const baseUrl = resolveRequestBaseUrl(req);
  if (!baseUrl) {
    return relativePath;
  }

  return new URL(relativePath, baseUrl).toString();
}

app.post('/api/download', async (req, res) => {
  const { url, format = 'mp3', quality = 'best' } = req.body || {};

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
    requiresConversion: ['mp3', 'mp4'].includes(format),
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

  const args = buildArgs({ url, format, quality, targetDir });
  const child = spawn('yt-dlp', args);

  child.stdout.on('data', (buffer) => handleProcessOutput(job, 'ytdlp', buffer.toString()));
  child.stderr.on('data', (buffer) => handleProcessOutput(job, 'ytdlp', buffer.toString()));

  child.on('error', (error) => {
    job.status = 'error';
    job.stage = 'error';
    job.error = `yt-dlp konnte nicht gestartet werden: ${error.message}`;
    appendEvent(job, 'Fehler beim Start von yt-dlp.');
    scheduleJobCleanup(job);
  });

  child.on('close', async (code) => {
    try {
      if (code !== 0) {
        job.status = 'error';
        job.stage = 'error';
        job.error = 'yt-dlp wurde mit einem Fehler beendet.';
        appendEvent(job, 'Download fehlgeschlagen.');
        scheduleJobCleanup(job);
        return;
      }

      let entries = (await fsp.readdir(targetDir, { withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .map((entry) => ({
          name: entry.name,
          full: path.join(targetDir, entry.name)
        }));

      if (entries.length === 0) {
        job.status = 'error';
        job.stage = 'error';
        job.error = 'Es wurde keine Datei erzeugt.';
        appendEvent(job, 'Keine Ausgabedatei erzeugt.');
        scheduleJobCleanup(job);
        return;
      }

      if (format === 'mp3') {
        const bitrate = getAudioBitrate(quality);
        const converted = [];

        for (const entry of entries) {
          if (entry.name.toLowerCase().endsWith('.mp3')) {
            converted.push(entry);
            continue;
          }

          job.conversionKind = 'mp3';
          job.ffmpegMode = 'software';
          job.conversionDurationSec = null;
          const mp3Path = await convertToMp3(entry.full, bitrate, (text) => handleProcessOutput(job, 'ffmpeg', text));

          converted.push({
            name: path.basename(mp3Path),
            full: mp3Path
          });
        }

        entries = converted;
      }

      if (format === 'mp4') {
        const converted = [];
        const preferredProfile = ffmpegRuntime.preferredMp4Profile || getSoftwareMp4TranscodeProfile();

        for (const entry of entries) {
          job.conversionKind = 'mp4';
          job.ffmpegMode = preferredProfile.mode;
          job.conversionDurationSec = null;

          let mp4Path;

          try {
            mp4Path = await convertToMp4(entry.full, preferredProfile, (text) => handleProcessOutput(job, 'ffmpeg', text));
          } catch (error) {
            if (preferredProfile.mode !== 'qsv') {
              throw error;
            }

            appendEvent(job, 'Intel Quick Sync konnte nicht genutzt werden, Software-Encoding wird verwendet...');
            job.ffmpegMode = 'software';
            job.conversionDurationSec = null;
            mp4Path = await convertToMp4(entry.full, getSoftwareMp4TranscodeProfile(), (text) => handleProcessOutput(job, 'ffmpeg', text));
          }

          converted.push({
            name: path.basename(mp4Path),
            full: mp4Path
          });
        }

        entries = converted;
      }

      let finalPath;
      let finalName;

      if (entries.length === 1) {
        finalPath = entries[0].full;
        finalName = entries[0].name;
      } else {
        appendEvent(job, 'Playlist wird als ZIP bereitgestellt...');
        updateProgress(job, 97, 'pack');

        const zipName = `${safeBaseName(id)}.zip`;
        const zipPath = path.join(targetDir, zipName);

        await zipDirectory(targetDir, zipPath, zipName);

        finalPath = zipPath;
        finalName = zipName;
      }

      job.status = 'done';
      job.stage = 'done';
      job.completedAt = new Date().toISOString();
      job.downloadPath = finalPath;
      job.downloadName = finalName;
      job.progress = 100;
      appendEvent(job, 'Datei steht zum Download bereit.');

      scheduleJobCleanup(job);
    } catch (error) {
      job.status = 'error';
      job.stage = 'error';
      job.error = error.message;
      appendEvent(job, 'Verarbeitung fehlgeschlagen.');
      scheduleJobCleanup(job);
    }
  });

  res.json({ id });
});

app.get('/api/status/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job nicht gefunden.' });
  }

  res.json({
    id: job.id,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    error: job.error,
    log: job.log.slice(-10).join('\n'),
    rawLog: job.rawLog.slice(-200).join(''),
    downloadName: job.downloadName,
    downloadUrl: job.status === 'done' ? resolveDownloadUrl(req, job) : null,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    expiresAt: job.expiresAt
  });
});

app.get('/api/file/:id', async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== 'done' || !job.downloadPath) {
    return res.status(404).send('Datei nicht gefunden.');
  }

  try {
    await fsp.access(job.downloadPath, fs.constants.R_OK);
  } catch {
    return res.status(404).send('Datei nicht gefunden.');
  }

  res.download(job.downloadPath, job.downloadName);
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    publicClientConfig: buildPublicClientConfig(),
    runtimeChecksSkipped: runtimeState.runtimeChecksSkipped,
    ffmpegProbeSkipped: runtimeState.ffmpegProbeSkipped,
    ffmpeg: {
      version: ffmpegRuntime.version,
      requestedHwAccel: ffmpegRuntime.requestedHwAccel,
      quickSyncDetected: ffmpegRuntime.quickSyncDetected,
      quickSyncAvailable: ffmpegRuntime.quickSyncAvailable,
      selectedMp4Mode: ffmpegRuntime.preferredMp4Profile.mode,
      selectedMp4VideoCodec: ffmpegRuntime.preferredMp4Profile.videoCodec,
      hwaccels: ffmpegRuntime.hwaccels,
      probeError: ffmpegRuntime.probeError,
      quickSyncProbeError: ffmpegRuntime.quickSyncProbeError,
      probedAt: ffmpegRuntime.probedAt
    }
  });
});

async function startServer(options = {}) {
  runtimeState.tmpDir = resolvePathValue(options.tmpDir || runtimeState.tmpDir);
  runtimeState.jobTtlMs = Number(options.jobTtlMs || runtimeState.jobTtlMs);
  runtimeState.runtimeChecksSkipped = options.skipRuntimeChecks ?? SKIP_RUNTIME_CHECKS;
  runtimeState.ffmpegProbeSkipped = options.skipFfmpegProbe ?? SKIP_FFMPEG_PROBE;

  await ensureDirs();
  await cleanupTmpOnStartup();

  if (!runtimeState.runtimeChecksSkipped) {
    await verifyRequiredBinaries();
  }

  ffmpegRuntime = runtimeState.ffmpegProbeSkipped
    ? createDefaultFfmpegRuntime()
    : await probeFfmpegRuntime();

  const port = options.port ?? DEFAULT_PORT;
  const quiet = options.quiet === true;

  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(port, () => resolve(instance));
    instance.on('error', reject);
  });

  const address = server.address();
  const resolvedPort = typeof address === 'object' && address ? address.port : port;

  if (!quiet) {
    logStartupSummary(resolvedPort);
  }

  return {
    app,
    server,
    port: resolvedPort,
    tmpDir: runtimeState.tmpDir,
    ffmpegRuntime
  };
}

function logStartupSummary(port) {
  console.log(`Server laeuft auf Port ${port}`);
  console.log(`TMP_DIR: ${runtimeState.tmpDir}`);
  console.log(`JOB_TTL_MS: ${runtimeState.jobTtlMs}`);
  console.log(`FFMPEG_HWACCEL: ${FFMPEG_HWACCEL}`);

  if (ffmpegRuntime.version) {
    console.log(ffmpegRuntime.version);
  }

  if (runtimeState.runtimeChecksSkipped) {
    console.log('Runtime-Checks wurden fuer diesen Start uebersprungen.');
  }

  if (runtimeState.ffmpegProbeSkipped) {
    console.log('FFmpeg-Probe wurde fuer diesen Start uebersprungen.');
    return;
  }

  if (ffmpegRuntime.probeError) {
    console.log(`FFmpeg-Probe fehlgeschlagen: ${ffmpegRuntime.probeError}`);
  } else if (ffmpegRuntime.quickSyncAvailable) {
    console.log(`Intel Quick Sync erkannt, MP4-Encoding nutzt ${ffmpegRuntime.preferredMp4Profile.videoCodec}.`);
  } else if (ffmpegRuntime.quickSyncDetected) {
    console.log(`Intel Quick Sync im FFmpeg-Build gefunden, aber nicht nutzbar: ${ffmpegRuntime.quickSyncProbeError}`);
    console.log('MP4-Encoding faellt deshalb standardmaessig auf libx264 zurueck.');
  } else {
    console.log('Intel Quick Sync nicht verfuegbar, MP4-Encoding faellt auf libx264 zurueck.');
  }

  console.log('MP3-Konvertierung bleibt CPU-basiert, weil dafuer libmp3lame verwendet wird.');
  console.log('Temporaere Job-Dateien beim Start bereinigt.');
}

module.exports = {
  app,
  startServer,
  buildPublicClientConfig,
  verifyRequiredBinaries
};

if (require.main === module) {
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
