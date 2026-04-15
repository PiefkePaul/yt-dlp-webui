const fs = require('fs');
const { spawn } = require('child_process');

const { prepareSessionArtifacts } = require('./session-options');
const { looksLikeSoundCloudUrl } = require('./sites');

const FFMPEG_DURATION_RE = /Duration:\s+(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/;
const FFMPEG_TIME_RE = /time=(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/;

function runProcessCapture(command, args) {
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

    child.on('error', (error) => {
      reject(new Error(`${command} konnte nicht gestartet werden: ${error.message}`));
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, combined: `${stdout}${stderr}` });
        return;
      }

      reject(new Error(`${command} fehlgeschlagen (Exit-Code ${code}).`));
    });
  });
}

function createMediaTools(config) {
  function getSoftwareMp4TranscodeProfile() {
    return {
      mode: 'software',
      label: 'Software (libx264)',
      videoCodec: 'libx264',
      videoArgs: [
        '-preset', config.ffmpeg.x264Preset,
        '-crf', String(config.ffmpeg.x264Crf),
        '-pix_fmt', 'yuv420p'
      ],
      audioCodec: 'aac',
      audioArgs: ['-b:a', `${config.ffmpeg.aacBitrate}k`]
    };
  }

  function getQuickSyncMp4TranscodeProfile() {
    return {
      mode: 'qsv',
      label: `Intel Quick Sync (${config.ffmpeg.mp4HwEncoder})`,
      videoCodec: config.ffmpeg.mp4HwEncoder,
      videoArgs: [
        '-preset', config.ffmpeg.qsvPreset,
        '-global_quality', String(config.ffmpeg.qsvGlobalQuality)
      ],
      audioCodec: 'aac',
      audioArgs: ['-b:a', `${config.ffmpeg.aacBitrate}k`]
    };
  }

  function createDefaultFfmpegRuntime() {
    return {
      version: null,
      hwaccels: [],
      encoders: [],
      quickSyncDetected: false,
      quickSyncAvailable: false,
      requestedHwAccel: config.ffmpeg.requestedHwAccel,
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
    if (config.ffmpeg.requestedHwAccel === 'none') {
      return getSoftwareMp4TranscodeProfile();
    }

    if (runtime.quickSyncAvailable) {
      return getQuickSyncMp4TranscodeProfile();
    }

    return getSoftwareMp4TranscodeProfile();
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
      runtime.quickSyncDetected = runtime.hwaccels.includes('qsv')
        && runtime.encoders.includes(config.ffmpeg.mp4HwEncoder);

      if (runtime.quickSyncDetected && config.ffmpeg.requestedHwAccel !== 'none') {
        try {
          await runProcessCapture('ffmpeg', [
            '-hide_banner',
            '-loglevel', 'error',
            '-f', 'lavfi',
            '-i', 'testsrc2=size=128x72:rate=30',
            '-frames:v', '1',
            '-an',
            '-c:v', config.ffmpeg.mp4HwEncoder,
            '-preset', config.ffmpeg.qsvPreset,
            '-global_quality', String(config.ffmpeg.qsvGlobalQuality),
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

  function getAudioBitrate(quality) {
    return ['320', '192', '128'].includes(quality) ? quality : '320';
  }

  function getAudioArgs() {
    return ['-f', 'bestaudio/best'];
  }

  function getVideoArgs(quality) {
    if (quality === 'best') {
      return ['-f', 'bv*+ba/b'];
    }

    const height = ['1080', '720', '480'].includes(quality) ? quality : '1080';
    return ['-f', `bv*[height<=${height}]+ba/b[height<=${height}]/b`];
  }

  function getCookieArgs() {
    if (config.ytdlpCookiesFile && fs.existsSync(config.ytdlpCookiesFile)) {
      return ['--cookies', config.ytdlpCookiesFile];
    }

    return [];
  }

  function getSharedYtdlpArgs() {
    return [
      '--js-runtimes', 'deno',
      '--remote-components', 'ejs:github',
      '--extractor-args', 'youtube:player_client=android,web'
    ];
  }

  async function prepareRequestOptions({ url, sessionOptions, workingDirectory, filePrefix }) {
    const sessionArtifacts = await prepareSessionArtifacts({
      sessionOptions,
      workingDirectory,
      filePrefix
    });

    const requestArgs = [];

    if (!sessionArtifacts.options.cookiesText) {
      requestArgs.push(...getCookieArgs());
    }

    requestArgs.push(...sessionArtifacts.args);

    if (sessionArtifacts.options.soundcloudOauthToken && looksLikeSoundCloudUrl(url)) {
      requestArgs.push('--username', 'oauth', '--password', sessionArtifacts.options.soundcloudOauthToken);
    }

    return {
      options: sessionArtifacts.options,
      args: requestArgs,
      cleanup: sessionArtifacts.cleanup
    };
  }

  function buildDownloadArgs({ url, format, quality, targetDir, requestArgs = [] }) {
    const common = [
      '--yes-playlist',
      '--newline',
      '--restrict-filenames',
      ...getSharedYtdlpArgs(),
      '-P', targetDir,
      '-o', '%(title).200B [%(id)s].%(ext)s'
    ];

    const formatArgs = format === 'mp4' ? getVideoArgs(quality) : getAudioArgs(quality);
    return [...common, ...requestArgs, ...formatArgs, url];
  }

  function buildInspectArgs(url, requestArgs = []) {
    return [
      '--dump-single-json',
      '--skip-download',
      '--flat-playlist',
      '--playlist-end', String(config.inspectEntryLimit),
      '--no-warnings',
      ...getSharedYtdlpArgs(),
      ...requestArgs,
      url
    ];
  }

  async function convertToMp3(inputPath, bitrate, logFn, setActiveChild) {
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

      if (setActiveChild) {
        setActiveChild(ffmpeg);
      }

      ffmpeg.stdout.on('data', (buffer) => logFn(buffer.toString()));
      ffmpeg.stderr.on('data', (buffer) => logFn(buffer.toString()));

      ffmpeg.on('close', (code) => {
        if (setActiveChild) {
          setActiveChild(null);
        }

        if (code === 0) {
          resolve();
        } else {
          reject(new Error('FFmpeg-Konvertierung nach MP3 ist fehlgeschlagen.'));
        }
      });

      ffmpeg.on('error', (error) => {
        if (setActiveChild) {
          setActiveChild(null);
        }

        reject(error);
      });
    });

    fs.unlinkSync(inputPath);
    return outputPath;
  }

  async function convertToMp4(inputPath, profile, logFn, setActiveChild) {
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

      if (setActiveChild) {
        setActiveChild(ffmpeg);
      }

      ffmpeg.stdout.on('data', (buffer) => logFn(buffer.toString()));
      ffmpeg.stderr.on('data', (buffer) => logFn(buffer.toString()));

      ffmpeg.on('close', (code) => {
        if (setActiveChild) {
          setActiveChild(null);
        }

        if (code === 0) {
          resolve();
        } else {
          reject(new Error('FFmpeg-Konvertierung nach MP4 ist fehlgeschlagen.'));
        }
      });

      ffmpeg.on('error', (error) => {
        if (setActiveChild) {
          setActiveChild(null);
        }

        reject(error);
      });
    });

    fs.unlinkSync(inputPath);

    if (tempOutputPath !== targetPath) {
      fs.renameSync(tempOutputPath, targetPath);
    }

    return targetPath;
  }

  function extractFfmpegProgress(text) {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const progress = {
      durationSec: null,
      processedRatio: null
    };

    for (const line of lines) {
      const durationMatch = line.match(FFMPEG_DURATION_RE);
      if (durationMatch) {
        progress.durationSec = toSeconds(durationMatch[1], durationMatch[2], durationMatch[3]);
      }

      const timeMatch = line.match(FFMPEG_TIME_RE);
      if (timeMatch && progress.durationSec) {
        const processedSec = toSeconds(timeMatch[1], timeMatch[2], timeMatch[3]);
        progress.processedRatio = Math.min(processedSec / progress.durationSec, 1);
      }
    }

    return progress;
  }

  return {
    buildDownloadArgs,
    buildInspectArgs,
    prepareRequestOptions,
    convertToMp3,
    convertToMp4,
    createDefaultFfmpegRuntime,
    extractFfmpegProgress,
    getAudioBitrate,
    getQuickSyncMp4TranscodeProfile,
    getSoftwareMp4TranscodeProfile,
    probeFfmpegRuntime,
    runProcessCapture,
    verifyRequiredBinaries
  };
}

function toSeconds(hours, minutes, seconds) {
  return (Number(hours) * 3600) + (Number(minutes) * 60) + Number(seconds);
}

module.exports = {
  createMediaTools,
  runProcessCapture,
  toSeconds
};
