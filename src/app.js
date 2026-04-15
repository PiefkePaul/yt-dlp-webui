const express = require('express');
const path = require('path');
const fs = require('fs');

const { buildPublicClientConfig, resolvePathValue } = require('./config');
const { createMediaTools } = require('./media-tools');
const { createInspector } = require('./inspect');
const { createJobManager } = require('./job-manager');
const { sanitizeSessionOptions } = require('./session-options');

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

function createServerApplication(config) {
  const runtimeState = {
    tmpDir: config.tmpDir,
    jobTtlMs: config.jobTtlMs,
    runtimeChecksSkipped: config.skipRuntimeChecks,
    ffmpegProbeSkipped: config.skipFfmpegProbe
  };

  const app = express();
  const mediaTools = createMediaTools(config);
  const inspector = createInspector(config, mediaTools);
  const jobManager = createJobManager({
    config,
    runtimeState,
    mediaTools
  });

  app.set('trust proxy', true);
  app.use(createCorsMiddleware());
  app.use(express.json({ limit: '256kb' }));
  app.get('/app-config.js', (_req, res) => {
    res.type('application/javascript');
    res.send(`window.APP_CONFIG = ${JSON.stringify(buildPublicClientConfig(config), null, 2)};\n`);
  });
  app.use(express.static(path.join(config.repoRoot, 'public')));

  app.post('/api/inspect', async (req, res) => {
    const { url } = req.body || {};

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Bitte einen gueltigen Link angeben.' });
    }

    let sessionOptions;
    try {
      sessionOptions = sanitizeSessionOptions(req.body?.advanced);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    try {
      const payload = await inspector.inspectUrl(url.trim(), sessionOptions);
      return res.json(payload);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/download', async (req, res) => {
    const { url, format = 'mp3', quality = 'best' } = req.body || {};

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Bitte einen gueltigen Link angeben.' });
    }

    let sessionOptions;
    try {
      sessionOptions = sanitizeSessionOptions(req.body?.advanced);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    try {
      const inspection = await inspector.inspectUrl(url.trim(), sessionOptions);

      if (inspection.requirements?.soundcloudTokenRequired && !sessionOptions.soundcloudOauthToken) {
        return res.status(400).json({
          code: 'SOUNDCLOUD_TOKEN_REQUIRED',
          error: 'Fuer diesen SoundCloud-Track ist ein OAuth-Token erforderlich, sonst bleibt nur die 30-Sekunden-Vorschau verfuegbar.',
          inspection
        });
      }

      const job = await jobManager.createJob({
        url,
        format,
        quality,
        sessionOptions,
        inspection
      });
      return res.status(202).json({
        id: job.id,
        status: job.status,
        queuePosition: jobManager.getQueuePosition(job.id)
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/download/:id', (req, res) => {
    const result = jobManager.cancelJob(req.params.id);

    if (!result.found) {
      return res.status(404).json({ error: 'Job nicht gefunden.' });
    }

    if (!result.changed) {
      return res.json({
        id: result.job.id,
        status: result.job.status,
        changed: false
      });
    }

    return res.json({
      id: result.job.id,
      status: result.job.status,
      changed: true
    });
  });

  app.get('/api/status/:id', (req, res) => {
    const payload = jobManager.getJobPayload(req.params.id, (job) => resolveDownloadUrl(req, job));

    if (!payload) {
      return res.status(404).json({ error: 'Job nicht gefunden.' });
    }

    return res.json(payload);
  });

  app.get('/api/file/:id', async (req, res) => {
    const job = jobManager.getJob(req.params.id);
    if (!job || job.status !== 'done' || !job.downloadPath) {
      return res.status(404).send('Datei nicht gefunden.');
    }

    try {
      await fs.promises.access(job.downloadPath, fs.constants.R_OK);
    } catch {
      return res.status(404).send('Datei nicht gefunden.');
    }

    return res.download(job.downloadPath, job.downloadName);
  });

  app.get('/health', (_req, res) => {
    const ffmpegRuntime = jobManager.getFfmpegRuntime();
    return res.json({
      ok: true,
      publicClientConfig: buildPublicClientConfig(config),
      runtimeChecksSkipped: runtimeState.runtimeChecksSkipped,
      ffmpegProbeSkipped: runtimeState.ffmpegProbeSkipped,
      queue: jobManager.getHealthSummary(),
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

  async function initializeRuntime(options = {}) {
    runtimeState.tmpDir = resolvePathValue(options.tmpDir || runtimeState.tmpDir);
    runtimeState.jobTtlMs = Number(options.jobTtlMs || runtimeState.jobTtlMs);
    runtimeState.runtimeChecksSkipped = options.skipRuntimeChecks ?? runtimeState.runtimeChecksSkipped;
    runtimeState.ffmpegProbeSkipped = options.skipFfmpegProbe ?? runtimeState.ffmpegProbeSkipped;

    await jobManager.prepareRuntime();

    if (!runtimeState.runtimeChecksSkipped) {
      await jobManager.verifyRequiredBinaries();
    }

    const ffmpegRuntime = runtimeState.ffmpegProbeSkipped
      ? mediaTools.createDefaultFfmpegRuntime()
      : await mediaTools.probeFfmpegRuntime();
    jobManager.setFfmpegRuntime(ffmpegRuntime);

    return ffmpegRuntime;
  }

  async function startServer(options = {}) {
    const ffmpegRuntime = await initializeRuntime(options);

    const port = options.port ?? config.port;
    const quiet = options.quiet === true;

    const server = await new Promise((resolve, reject) => {
      const instance = app.listen(port, () => resolve(instance));
      instance.on('error', reject);
    });

    const address = server.address();
    const resolvedPort = typeof address === 'object' && address ? address.port : port;

    if (!quiet) {
      logStartupSummary(resolvedPort, ffmpegRuntime);
    }

    return {
      app,
      server,
      port: resolvedPort,
      tmpDir: runtimeState.tmpDir,
      ffmpegRuntime
    };
  }

  function createCorsMiddleware() {
    return (req, res, next) => {
      const origin = req.get('origin');
      const allowedOrigin = resolveAllowedOrigin(origin);

      if (allowedOrigin) {
        res.set('Access-Control-Allow-Origin', allowedOrigin);
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        res.set('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
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
    if (!origin || config.corsAllowedOrigins.length === 0) {
      return null;
    }

    if (config.corsAllowedOrigins.includes('*')) {
      return '*';
    }

    return config.corsAllowedOrigins.includes(origin) ? origin : null;
  }

  function resolveRequestBaseUrl(req) {
    if (config.publicApiBaseUrl) {
      return config.publicApiBaseUrl;
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

  function logStartupSummary(port, ffmpegRuntime) {
    console.log(`Server laeuft auf Port ${port}`);
    console.log(`TMP_DIR: ${runtimeState.tmpDir}`);
    console.log(`JOB_TTL_MS: ${runtimeState.jobTtlMs}`);
    console.log(`MAX_CONCURRENT_JOBS: ${config.maxConcurrentJobs}`);
    console.log(`INSPECT_ENTRY_LIMIT: ${config.inspectEntryLimit}`);
    console.log(`FFMPEG_HWACCEL: ${config.ffmpeg.requestedHwAccel}`);

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
    console.log('Inspect-, Queue- und Cancel-Funktionen sind aktiv.');
    console.log('Temporaere Job-Dateien beim Start bereinigt.');
  }

  return {
    app,
    buildPublicClientConfig: () => buildPublicClientConfig(config),
    initializeRuntime,
    startServer,
    verifyRequiredBinaries: jobManager.verifyRequiredBinaries
  };
}

module.exports = {
  createServerApplication
};
