const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const archiver = require('archiver');

const { sanitizeSessionOptions } = require('./session-options');

const YTDLP_PERCENT_RE = /\[download\]\s+(\d+(?:\.\d+)?)%/;

class JobCancelledError extends Error {
  constructor(message = 'Job wurde abgebrochen.') {
    super(message);
    this.name = 'JobCancelledError';
  }
}

function createJobManager({ config, runtimeState, mediaTools }) {
  const jobs = new Map();
  const queuedJobIds = [];
  const activeJobIds = new Set();
  let ffmpegRuntime = mediaTools.createDefaultFfmpegRuntime();

  function setFfmpegRuntime(runtime) {
    ffmpegRuntime = runtime || mediaTools.createDefaultFfmpegRuntime();
  }

  function getFfmpegRuntime() {
    return ffmpegRuntime;
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

  async function prepareRuntime() {
    await ensureDirs();
    await cleanupTmpOnStartup();
  }

  function safeBaseName(name) {
    return name.replace(/[^a-zA-Z0-9._-]+/g, '_');
  }

  function appendRawLog(job, text) {
    if (!text) {
      return;
    }

    job.rawLog.push(text);
    if (job.rawLog.length > 400) {
      job.rawLog.shift();
    }
  }

  function appendEvent(job, text) {
    if (!text) {
      return;
    }

    const normalized = text.trim();
    if (!normalized) {
      return;
    }

    if (job.log[job.log.length - 1] === normalized) {
      return;
    }

    job.log.push(normalized);
    if (job.log.length > 50) {
      job.log.shift();
    }
  }

  function clampProgress(value) {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.max(0, Math.min(100, Math.round(value)));
  }

  function updateProgress(job, value, stage) {
    job.progress = clampProgress(value);
    if (stage) {
      job.stage = stage;
    }
  }

  function processYtdlpOutput(job, text) {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

    for (const line of lines) {
      if (/^\[[^\]]+\]\s+Extracting URL:/.test(line)) {
        appendEvent(job, 'Link wird analysiert...');
        updateProgress(job, 5, 'analyze');
        continue;
      }

      if (line.includes('Downloading webpage')) {
        appendEvent(job, 'Quellinformationen werden geladen...');
        updateProgress(job, 10, 'analyze');
        continue;
      }

      if (line.includes('Downloading android')
        || line.includes('Downloading player')
        || line.includes('Downloading api JSON')
        || line.includes('Downloading m3u8 information')
        || line.includes('Downloading MPD manifest')) {
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
    const progress = mediaTools.extractFfmpegProgress(text);

    if (progress.durationSec) {
      job.conversionDurationSec = progress.durationSec;
      appendEvent(job, getConversionStatusText(job));
      updateProgress(job, 60, 'convert');
    }

    if (Number.isFinite(progress.processedRatio)) {
      updateProgress(job, 60 + (progress.processedRatio * 35), 'convert');
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

    if (typeof job.cleanupTimer.unref === 'function') {
      job.cleanupTimer.unref();
    }
  }

  function isTerminalStatus(status) {
    return ['done', 'error', 'cancelled'].includes(status);
  }

  function getQueuePosition(jobId) {
    const index = queuedJobIds.indexOf(jobId);
    return index === -1 ? null : index + 1;
  }

  function setActiveChild(job, key, child) {
    job.processes[key] = child;
  }

  function clearActiveChildren(job) {
    job.processes.ytdlp = null;
    job.processes.ffmpeg = null;
  }

  function requestCancellation(job) {
    if (isTerminalStatus(job.status) || job.cancelRequested) {
      return;
    }

    job.cancelRequested = true;
    appendEvent(job, 'Abbruch wird angefordert...');
    updateProgress(job, job.progress, 'cancel');

    for (const child of Object.values(job.processes)) {
      if (!child || child.killed) {
        continue;
      }

      try {
        child.kill('SIGTERM');
      } catch {
        // Prozess wurde bereits beendet
      }
    }
  }

  function finalizeCancelled(job, message) {
    if (isTerminalStatus(job.status)) {
      return;
    }

    job.status = 'cancelled';
    job.stage = 'cancelled';
    job.completedAt = new Date().toISOString();
    job.error = null;
    appendEvent(job, message || 'Job wurde abgebrochen.');
    scheduleJobCleanup(job);
  }

  function finalizeError(job, error) {
    if (isTerminalStatus(job.status)) {
      return;
    }

    job.status = 'error';
    job.stage = 'error';
    job.completedAt = new Date().toISOString();
    job.error = error;
    appendEvent(job, 'Verarbeitung fehlgeschlagen.');
    scheduleJobCleanup(job);
  }

  function finalizeSuccess(job, finalPath, finalName) {
    job.status = 'done';
    job.stage = 'done';
    job.completedAt = new Date().toISOString();
    job.downloadPath = finalPath;
    job.downloadName = finalName;
    job.progress = 100;
    appendEvent(job, 'Datei steht zum Download bereit.');
    scheduleJobCleanup(job);
  }

  async function collectOutputEntries(targetDir) {
    return (await fsp.readdir(targetDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => ({
        name: entry.name,
        full: path.join(targetDir, entry.name)
      }));
  }

  async function runYtDlpDownload(job) {
    const requestOptions = await mediaTools.prepareRequestOptions({
      url: job.url,
      sessionOptions: job.sessionOptions,
      workingDirectory: job.targetDir,
      filePrefix: `download-${job.id}`
    });

    try {
      const args = mediaTools.buildDownloadArgs({
        url: job.url,
        format: job.format,
        quality: job.quality,
        targetDir: job.targetDir,
        requestArgs: requestOptions.args
      });

      await new Promise((resolve, reject) => {
        const child = spawn('yt-dlp', args);
        setActiveChild(job, 'ytdlp', child);

        child.stdout.on('data', (buffer) => handleProcessOutput(job, 'ytdlp', buffer.toString()));
        child.stderr.on('data', (buffer) => handleProcessOutput(job, 'ytdlp', buffer.toString()));

        child.on('error', (error) => {
          setActiveChild(job, 'ytdlp', null);
          reject(new Error(`yt-dlp konnte nicht gestartet werden: ${error.message}`));
        });

        child.on('close', (code) => {
          setActiveChild(job, 'ytdlp', null);

          if (job.cancelRequested) {
            reject(new JobCancelledError());
            return;
          }

          if (code === 0) {
            resolve();
            return;
          }

          reject(new Error('yt-dlp wurde mit einem Fehler beendet.'));
        });
      });
    } finally {
      await requestOptions.cleanup();
    }
  }

  async function convertEntries(job, entries) {
    if (job.cancelRequested) {
      throw new JobCancelledError();
    }

    if (job.format === 'mp3') {
      const bitrate = mediaTools.getAudioBitrate(job.quality);
      const converted = [];

      for (const entry of entries) {
        if (job.cancelRequested) {
          throw new JobCancelledError();
        }

        if (entry.name.toLowerCase().endsWith('.mp3')) {
          converted.push(entry);
          continue;
        }

        job.conversionKind = 'mp3';
        job.ffmpegMode = 'software';
        job.conversionDurationSec = null;

        const mp3Path = await mediaTools.convertToMp3(
          entry.full,
          bitrate,
          (text) => handleProcessOutput(job, 'ffmpeg', text),
          (child) => setActiveChild(job, 'ffmpeg', child)
        );

        converted.push({
          name: path.basename(mp3Path),
          full: mp3Path
        });
      }

      return converted;
    }

    if (job.format === 'mp4') {
      const converted = [];
      const preferredProfile = ffmpegRuntime.preferredMp4Profile || mediaTools.getSoftwareMp4TranscodeProfile();

      for (const entry of entries) {
        if (job.cancelRequested) {
          throw new JobCancelledError();
        }

        job.conversionKind = 'mp4';
        job.ffmpegMode = preferredProfile.mode;
        job.conversionDurationSec = null;

        let mp4Path;

        try {
          mp4Path = await mediaTools.convertToMp4(
            entry.full,
            preferredProfile,
            (text) => handleProcessOutput(job, 'ffmpeg', text),
            (child) => setActiveChild(job, 'ffmpeg', child)
          );
        } catch (error) {
          if (preferredProfile.mode !== 'qsv' || job.cancelRequested) {
            throw error;
          }

          appendEvent(job, 'Intel Quick Sync konnte nicht genutzt werden, Software-Encoding wird verwendet...');
          job.ffmpegMode = 'software';
          job.conversionDurationSec = null;

          mp4Path = await mediaTools.convertToMp4(
            entry.full,
            mediaTools.getSoftwareMp4TranscodeProfile(),
            (text) => handleProcessOutput(job, 'ffmpeg', text),
            (child) => setActiveChild(job, 'ffmpeg', child)
          );
        }

        converted.push({
          name: path.basename(mp4Path),
          full: mp4Path
        });
      }

      return converted;
    }

    return entries;
  }

  async function finalizeOutput(job, entries) {
    if (entries.length === 0) {
      throw new Error('Es wurde keine Datei erzeugt.');
    }

    if (entries.length === 1) {
      return {
        finalPath: entries[0].full,
        finalName: entries[0].name
      };
    }

    appendEvent(job, 'Playlist wird als ZIP bereitgestellt...');
    updateProgress(job, 97, 'pack');

    const zipName = `${safeBaseName(job.id)}.zip`;
    const zipPath = path.join(job.targetDir, zipName);
    await zipDirectory(job.targetDir, zipPath, zipName);

    return {
      finalPath: zipPath,
      finalName: zipName
    };
  }

  async function executeJob(job) {
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    appendEvent(job, 'Job wird ausgefuehrt.');
    updateProgress(job, 3, 'queued');

    try {
      await runYtDlpDownload(job);

      if (job.cancelRequested) {
        throw new JobCancelledError();
      }

      let entries = await collectOutputEntries(job.targetDir);
      if (entries.length === 0) {
        throw new Error('Es wurde keine Ausgabedatei erzeugt.');
      }

      entries = await convertEntries(job, entries);

      if (job.cancelRequested) {
        throw new JobCancelledError();
      }

      const { finalPath, finalName } = await finalizeOutput(job, entries);
      finalizeSuccess(job, finalPath, finalName);
    } catch (error) {
      if (error instanceof JobCancelledError || job.cancelRequested) {
        finalizeCancelled(job, error.message);
      } else {
        finalizeError(job, error.message);
      }
    } finally {
      clearActiveChildren(job);
      activeJobIds.delete(job.id);
      startQueuedJobs();
    }
  }

  function startQueuedJobs() {
    while (activeJobIds.size < config.maxConcurrentJobs && queuedJobIds.length > 0) {
      const nextJobId = queuedJobIds.shift();
      const nextJob = jobs.get(nextJobId);

      if (!nextJob || nextJob.status !== 'queued') {
        continue;
      }

      activeJobIds.add(nextJob.id);
      void executeJob(nextJob);
    }
  }

  async function createJob({ url, format, quality, sessionOptions, inspection }) {
    const normalizedUrl = String(url || '').trim();
    const normalizedFormat = ['mp3', 'mp4'].includes(format) ? format : 'mp3';
    const normalizedQuality = String(quality || 'best').trim();
    const normalizedSessionOptions = sanitizeSessionOptions(sessionOptions);

    if (!normalizedUrl) {
      throw new Error('Bitte einen gueltigen Link angeben.');
    }

    const id = crypto.randomUUID();
    const targetDir = path.join(runtimeState.tmpDir, id);
    await fsp.mkdir(targetDir, { recursive: true });

    const job = {
      id,
      url: normalizedUrl,
      format: normalizedFormat,
      quality: normalizedQuality,
      sessionOptions: normalizedSessionOptions,
      siteKey: inspection?.siteKey || null,
      siteLabel: inspection?.siteLabel || null,
      requiresConversion: ['mp3', 'mp4'].includes(normalizedFormat),
      status: 'queued',
      stage: 'queued',
      progress: 0,
      createdAt: new Date().toISOString(),
      startedAt: null,
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
      ffmpegMode: null,
      cancelRequested: false,
      processes: {
        ytdlp: null,
        ffmpeg: null
      }
    };

    jobs.set(id, job);
    queuedJobIds.push(id);
    appendEvent(job, activeJobIds.size < config.maxConcurrentJobs
      ? 'Job wird vorbereitet...'
      : 'Job wurde in die Warteschlange aufgenommen.');
    updateProgress(job, 1, 'queued');
    startQueuedJobs();
    return job;
  }

  function cancelJob(jobId) {
    const job = jobs.get(jobId);
    if (!job) {
      return { found: false };
    }

    if (isTerminalStatus(job.status)) {
      return {
        found: true,
        changed: false,
        job
      };
    }

    if (job.status === 'queued') {
      const index = queuedJobIds.indexOf(job.id);
      if (index !== -1) {
        queuedJobIds.splice(index, 1);
      }

      requestCancellation(job);
      finalizeCancelled(job, 'Job wurde vor dem Start abgebrochen.');
      startQueuedJobs();
      return {
        found: true,
        changed: true,
        job
      };
    }

    requestCancellation(job);
    return {
      found: true,
      changed: true,
      job
    };
  }

  function getJob(jobId) {
    return jobs.get(jobId) || null;
  }

  function getJobPayload(jobId, resolveDownloadUrl) {
    const job = getJob(jobId);
    if (!job) {
      return null;
    }

    return {
      id: job.id,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      error: job.error,
      log: job.log.slice(-10).join('\n'),
      rawLog: job.rawLog.slice(-200).join(''),
      downloadName: job.downloadName,
      downloadUrl: job.status === 'done' ? resolveDownloadUrl(job) : null,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      expiresAt: job.expiresAt,
      queuePosition: job.status === 'queued' ? getQueuePosition(job.id) : null,
      cancelRequested: job.cancelRequested
    };
  }

  function getHealthSummary() {
    return {
      activeJobs: activeJobIds.size,
      queuedJobs: queuedJobIds.length,
      totalTrackedJobs: jobs.size,
      maxConcurrentJobs: config.maxConcurrentJobs,
      tmpDir: runtimeState.tmpDir,
      jobTtlMs: runtimeState.jobTtlMs
    };
  }

  return {
    cancelJob,
    createJob,
    getFfmpegRuntime,
    getHealthSummary,
    getJob,
    getJobPayload,
    getQueuePosition,
    prepareRuntime,
    setFfmpegRuntime,
    verifyRequiredBinaries: mediaTools.verifyRequiredBinaries
  };
}

module.exports = {
  createJobManager
};
