const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const { spawn } = require('child_process');
const archiver = require('archiver');

const app = express();
const PORT = process.env.PORT || 3000;
const TMP_DIR = process.env.TMP_DIR || path.join(__dirname, 'tmp');
const JOB_TTL_MS = Number(process.env.JOB_TTL_MS || 30 * 60 * 1000); // 30 minutes

const FFMPEG_DURATION_RE = /Duration:\s+(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/;
const FFMPEG_TIME_RE = /time=(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/;
const YTDLP_PERCENT_RE = /\[download\]\s+(\d+(?:\.\d+)?)%/;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const jobs = new Map();

function safeBaseName(name) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

async function ensureDirs() {
  await fsp.mkdir(TMP_DIR, { recursive: true });
}

async function cleanupTmpOnStartup() {
  const entries = await fsp.readdir(TMP_DIR, { withFileTypes: true });

  await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(TMP_DIR, entry.name);
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
      if (job.format === 'mp3') {
        appendEvent(job, 'Download abgeschlossen, Konvertierung startet...');
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

function processFfmpegOutput(job, text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    const durationMatch = line.match(FFMPEG_DURATION_RE);
    if (durationMatch) {
      job.conversionDurationSec = toSeconds(durationMatch[1], durationMatch[2], durationMatch[3]);
      appendEvent(job, 'Audio wird in MP3 konvertiert...');
      updateProgress(job, 60, 'convert');
      continue;
    }

    const timeMatch = line.match(FFMPEG_TIME_RE);
    if (timeMatch && job.conversionDurationSec) {
      const processedSec = toSeconds(timeMatch[1], timeMatch[2], timeMatch[3]);
      const ratio = Math.min(processedSec / job.conversionDurationSec, 1);
      updateProgress(job, 60 + (ratio * 35), 'convert');
      continue;
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

function getAudioArgs(_quality) {
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
  const cookieFile = process.env.YTDLP_COOKIES_FILE;
  if (cookieFile && fs.existsSync(cookieFile)) {
    return ['--cookies', cookieFile];
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
  const cookieArgs = getCookieArgs();

  return [...common, ...cookieArgs, ...formatArgs, url];
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

    ffmpeg.stdout.on('data', (buf) => logFn(buf.toString()));
    ffmpeg.stderr.on('data', (buf) => logFn(buf.toString()));

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

  job.expiresAt = new Date(Date.now() + JOB_TTL_MS).toISOString();

  job.cleanupTimer = setTimeout(async () => {
    try {
      await cleanupDirectory(job.targetDir);
    } finally {
      jobs.delete(job.id);
    }
  }, JOB_TTL_MS);
}

app.post('/api/download', async (req, res) => {
  const { url, format = 'mp3', quality = 'best' } = req.body || {};

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Bitte einen gueltigen Link angeben.' });
  }

  const id = crypto.randomUUID();
  const targetDir = path.join(TMP_DIR, id);
  await fsp.mkdir(targetDir, { recursive: true });

  const job = {
    id,
    url,
    format,
    quality,
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
    conversionDurationSec: null
  };

  jobs.set(id, job);
  appendEvent(job, 'Job gestartet.');
  updateProgress(job, 1, 'queued');

  const args = buildArgs({ url, format, quality, targetDir });
  const child = spawn('yt-dlp', args);

  child.stdout.on('data', (buf) => handleProcessOutput(job, 'ytdlp', buf.toString()));
  child.stderr.on('data', (buf) => handleProcessOutput(job, 'ytdlp', buf.toString()));

  child.on('error', (err) => {
    job.status = 'error';
    job.stage = 'error';
    job.error = `yt-dlp konnte nicht gestartet werden: ${err.message}`;
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

          const mp3Path = await convertToMp3(entry.full, bitrate, (text) => handleProcessOutput(job, 'ffmpeg', text));

          converted.push({
            name: path.basename(mp3Path),
            full: mp3Path
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
    } catch (err) {
      job.status = 'error';
      job.stage = 'error';
      job.error = err.message;
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
    downloadUrl: job.status === 'done' ? `/api/file/${job.id}` : null,
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
  res.json({ ok: true });
});

ensureDirs()
  .then(cleanupTmpOnStartup)
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server laeuft auf Port ${PORT}`);
      console.log(`TMP_DIR: ${TMP_DIR}`);
      console.log(`JOB_TTL_MS: ${JOB_TTL_MS}`);
      console.log('Temporaere Job-Dateien beim Start bereinigt.');
    });
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });



