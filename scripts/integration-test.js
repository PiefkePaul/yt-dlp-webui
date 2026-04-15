const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');

const { createConfig } = require('../src/config');
const { createMediaTools } = require('../src/media-tools');
const { createInspector } = require('../src/inspect');
const { createJobManager } = require('../src/job-manager');
const { sanitizeSessionOptions } = require('../src/session-options');
const { looksLikeSoundCloudUrl } = require('../src/sites');

async function createExecutable(filePath, content) {
  await fs.writeFile(filePath, content, 'utf8');
  await fs.chmod(filePath, 0o755);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJobStatus(jobManager, jobId, expectedStatuses, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const job = jobManager.getJob(jobId);
    assert.ok(job, `Job ${jobId} sollte vorhanden sein.`);

    if (expectedStatuses.includes(job.status)) {
      return job;
    }

    await sleep(150);
  }

  throw new Error(`Job ${jobId} hat innerhalb von ${timeoutMs} ms keinen erwarteten Status erreicht.`);
}

function assertIncludesPair(args, flag, value) {
  const index = args.indexOf(flag);
  assert.notEqual(index, -1, `${flag} sollte gesetzt sein.`);
  assert.equal(args[index + 1], value, `${flag} sollte den erwarteten Wert tragen.`);
}

async function main() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'yt-dlp-webui-integration-'));
  const binDir = path.join(tempRoot, 'bin');
  const tmpDir = path.join(tempRoot, 'tmp');

  await fs.mkdir(binDir, { recursive: true });
  await fs.mkdir(tmpDir, { recursive: true });

  await createExecutable(path.join(binDir, 'yt-dlp'), `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = process.argv.slice(2);
  const url = args[args.length - 1] || '';

  if (args.includes('--version')) {
    console.log('2026.04.01');
    return;
  }

  if (args.includes('--dump-single-json')) {
    if (url.includes('soundcloud.com/demo/preview')) {
      console.log(JSON.stringify({
        id: 'sc-preview',
        title: 'Preview Only Track',
        duration: 30,
        uploader: 'Demo Artist',
        extractor_key: 'Soundcloud',
        webpage_url: url,
        media: {
          transcodings: [
            {
              quality: 'sq',
              snipped: true,
              url: 'https://api-v2.soundcloud.com/media/soundcloud:tracks:1/preview/stream'
            }
          ]
        },
        formats: [
          {
            format_id: 'http_preview',
            url: 'https://cf-media.sndcdn.com/example/preview/0/30/file.mp3'
          }
        ]
      }));
      return;
    }

    if (url.includes('soundcloud.com/demo/hq')) {
      console.log(JSON.stringify({
        id: 'sc-hq',
        title: 'HQ Track',
        duration: 245,
        uploader: 'Demo Artist',
        extractor_key: 'Soundcloud',
        webpage_url: url,
        media: {
          transcodings: [
            {
              quality: 'sq',
              url: 'https://api-v2.soundcloud.com/media/soundcloud:tracks:2/stream'
            },
            {
              quality: 'hq',
              url: 'https://api-v2.soundcloud.com/media/soundcloud:tracks:2/hq'
            }
          ]
        },
        formats: [
          {
            format_id: 'http_mp3',
            url: 'https://cf-media.sndcdn.com/example/stream/file.mp3'
          },
          {
            format_id: 'hls_aac',
            format_note: 'Premium',
            quality: 'hq',
            url: 'https://cf-media.sndcdn.com/example/hq/file.m3u8'
          }
        ]
      }));
      return;
    }

    if (url.includes('playlist')) {
      console.log(JSON.stringify({
        _type: 'playlist',
        title: 'Demo Playlist',
        extractor_key: 'YouTube',
        playlist_count: 2,
        entries: [
          { id: 'pl-1', title: 'Track One', duration: 61, uploader: 'Playlist Owner', url: 'https://example.com/watch?v=pl-1' },
          { id: 'pl-2', title: 'Track Two', duration: 95, uploader: 'Playlist Owner', url: 'https://example.com/watch?v=pl-2' }
        ]
      }));
      return;
    }

    console.log(JSON.stringify({
      id: 'video-1',
      title: 'Sample Video',
      duration: 125,
      uploader: 'Test Channel',
      extractor_key: 'YouTube',
      thumbnail: 'https://example.com/thumb.jpg',
      webpage_url: url
    }));
    return;
  }

  const targetDir = args[args.indexOf('-P') + 1];
  fs.mkdirSync(targetDir, { recursive: true });

  console.log('[youtube] Extracting URL: ' + url);
  console.log('[download] Destination: ' + path.join(targetDir, 'temp.webm'));

  if (url.includes('slow')) {
    console.log('[download] 10.0% of 10.00MiB');
    await sleep(1200);
  }

  console.log('[download] 100.0% of 10.00MiB');
  console.log('[download] Download completed');

  if (url.includes('playlist')) {
    fs.writeFileSync(path.join(targetDir, 'Track One [pl-1].webm'), 'one');
    fs.writeFileSync(path.join(targetDir, 'Track Two [pl-2].webm'), 'two');
    return;
  }

  fs.writeFileSync(path.join(targetDir, 'Sample Video [video-1].webm'), 'video');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
`);

  await createExecutable(path.join(binDir, 'ffmpeg'), `#!/usr/bin/env node
const fs = require('fs');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('-version')) {
    console.log('ffmpeg version integration-test');
    return;
  }

  if (args.includes('-hwaccels')) {
    console.log('Hardware acceleration methods:');
    return;
  }

  if (args.includes('-encoders')) {
    console.log(' V..... libx264');
    return;
  }

  const outputPath = args[args.length - 1];
  process.stderr.write('Duration: 00:00:02.00\\n');
  await sleep(50);
  process.stderr.write('time=00:00:01.00\\n');
  await sleep(50);
  fs.writeFileSync(outputPath, 'converted');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
`);

  await createExecutable(path.join(binDir, 'deno'), `#!/usr/bin/env node
console.log('deno 2.7.12');
`);

  await createExecutable(path.join(binDir, 'failing-tool'), `#!/usr/bin/env node
process.exit(23);
`);

  process.env.TMP_DIR = tmpDir;
  process.env.MAX_CONCURRENT_JOBS = '1';
  process.env.INSPECT_ENTRY_LIMIT = '5';
  process.env.PATH = `${binDir}:${process.env.PATH}`;

  const config = createConfig(process.env);
  const runtimeState = {
    tmpDir: config.tmpDir,
    jobTtlMs: config.jobTtlMs,
    runtimeChecksSkipped: false,
    ffmpegProbeSkipped: false
  };
  const mediaTools = createMediaTools(config);
  const inspector = createInspector(config, mediaTools);
  const jobManager = createJobManager({
    config,
    runtimeState,
    mediaTools
  });

  await jobManager.prepareRuntime();
  await jobManager.verifyRequiredBinaries();
  jobManager.setFfmpegRuntime(await mediaTools.probeFfmpegRuntime());

  await assert.rejects(
    mediaTools.runProcessCapture('failing-tool', ['--password', 'super-secret', '--add-header', 'Cookie: session=abc123']),
    (error) => {
      assert.match(error.message, /failing-tool fehlgeschlagen \(Exit-Code 23\)\./);
      assert.doesNotMatch(error.message, /super-secret/);
      assert.doesNotMatch(error.message, /Cookie:\s*session=abc123/);
      assert.doesNotMatch(error.message, /--password/);
      return true;
    }
  );

  assert.equal(looksLikeSoundCloudUrl('https://soundcloud.com/demo/hq'), true);
  assert.equal(looksLikeSoundCloudUrl('https://on.soundcloud.com/abc123'), true);
  assert.equal(looksLikeSoundCloudUrl('https://example.com/not-soundcloud'), false);

  const rawSessionOptions = {
    cookieHeader: 'session=abc123',
    cookiesText: '# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tTRUE\t2147483647\tsessionid\tabc123',
    referer: 'https://example.com/embed',
    extraHeaders: 'Authorization: Bearer 123\nX-Test: enabled',
    extractorArgs: 'vimeo:client=ios',
    soundcloudOauthToken: 'sc-oauth-token'
  };
  const sanitizedSessionOptions = sanitizeSessionOptions(rawSessionOptions);
  const resanitizedSessionOptions = sanitizeSessionOptions(sanitizedSessionOptions);

  assert.deepEqual(resanitizedSessionOptions.extraHeaders, sanitizedSessionOptions.extraHeaders);
  assert.deepEqual(resanitizedSessionOptions.extractorArgs, sanitizedSessionOptions.extractorArgs);

  const preparedRequest = await mediaTools.prepareRequestOptions({
    url: 'https://on.soundcloud.com/abc123',
    sessionOptions: resanitizedSessionOptions,
    workingDirectory: tmpDir,
    filePrefix: 'prepared-request'
  });

  const cookiesIndex = preparedRequest.args.indexOf('--cookies');
  assert.notEqual(cookiesIndex, -1, '--cookies sollte fuer Session-Cookies gesetzt sein.');
  assert.ok(preparedRequest.args[cookiesIndex + 1].startsWith(tmpDir), 'Die temporaere Cookie-Datei sollte im TMP-Verzeichnis liegen.');
  assertIncludesPair(preparedRequest.args, '--referer', 'https://example.com/embed');
  assertIncludesPair(preparedRequest.args, '--add-header', 'Cookie: session=abc123');
  assert.ok(preparedRequest.args.includes('Authorization: Bearer 123'), 'Authorization-Header sollte uebernommen werden.');
  assert.ok(preparedRequest.args.includes('X-Test: enabled'), 'Zusatz-Header sollte uebernommen werden.');
  assertIncludesPair(preparedRequest.args, '--extractor-args', 'vimeo:client=ios');
  assertIncludesPair(preparedRequest.args, '--username', 'oauth');
  assertIncludesPair(preparedRequest.args, '--password', 'sc-oauth-token');

  const preparedCookiePath = preparedRequest.args[cookiesIndex + 1];
  await preparedRequest.cleanup();
  await assert.rejects(fs.access(preparedCookiePath));

  const singleInspect = await inspector.inspectUrl('https://example.com/watch?v=video-1');
  assert.equal(singleInspect.title, 'Sample Video');
  assert.equal(singleInspect.isPlaylist, false);

  const playlistInspect = await inspector.inspectUrl('https://example.com/playlist?id=demo');
  assert.equal(playlistInspect.isPlaylist, true);
  assert.equal(playlistInspect.entries.length, 2);

  const soundcloudPreviewInspect = await inspector.inspectUrl('https://soundcloud.com/demo/preview');
  assert.equal(soundcloudPreviewInspect.siteKey, 'soundcloud');
  assert.equal(soundcloudPreviewInspect.requirements.soundcloudTokenRequired, true);
  assert.equal(soundcloudPreviewInspect.soundcloud.hasPreviewFormats, true);

  const soundcloudHqInspect = await inspector.inspectUrl('https://soundcloud.com/demo/hq');
  assert.equal(soundcloudHqInspect.siteKey, 'soundcloud');
  assert.equal(soundcloudHqInspect.requirements.soundcloudTokenRecommended, true);
  assert.equal(soundcloudHqInspect.requirements.soundcloudTokenRequired, false);
  assert.equal(soundcloudHqInspect.soundcloud.hasPremiumFormats, true);

  const slowJob = await jobManager.createJob({
    url: 'https://example.com/watch?v=slow',
    format: 'mp3',
    quality: '320'
  });

  const queuedJob = await jobManager.createJob({
    url: 'https://example.com/watch?v=video-queued',
    format: 'mp3',
    quality: '320'
  });

  const queuedStatus = await waitForJobStatus(jobManager, queuedJob.id, ['queued']);
  assert.equal(jobManager.getQueuePosition(queuedStatus.id), 1);

  const cancelResult = jobManager.cancelJob(slowJob.id);
  assert.equal(cancelResult.found, true);
  assert.equal(cancelResult.changed, true);

  const cancelledStatus = await waitForJobStatus(jobManager, slowJob.id, ['cancelled']);
  assert.equal(cancelledStatus.status, 'cancelled');

  const completedStatus = await waitForJobStatus(jobManager, queuedJob.id, ['done']);
  assert.equal(completedStatus.status, 'done');
  assert.ok(completedStatus.downloadPath);

  const downloadedContent = await fs.readFile(completedStatus.downloadPath, 'utf8');
  assert.equal(downloadedContent, 'converted');

  const queueSummary = jobManager.getHealthSummary();
  assert.equal(queueSummary.maxConcurrentJobs, 1);
  assert.equal(jobManager.getFfmpegRuntime().preferredMp4Profile.mode, 'software');

  console.log('Integration test passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
