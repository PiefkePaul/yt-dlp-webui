const fs = require('fs/promises');
const path = require('path');
const assert = require('node:assert/strict');
const { app, buildPublicClientConfig, buildArgs } = require('../server');

function collectRoutes(expressApp) {
  const router = expressApp._router;
  if (!router || !Array.isArray(router.stack)) {
    return [];
  }

  return router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) => {
      const methods = Object.keys(layer.route.methods || {}).filter((method) => layer.route.methods[method]);
      return methods.map((method) => ({
        method: method.toUpperCase(),
        path: layer.route.path
      }));
    });
}

function hasRoute(routes, method, routePath) {
  return routes.some((route) => route.method === method && route.path === routePath);
}

async function main() {
  // Regression #1: let yt-dlp select supported YouTube clients, retaining
  // separate video/audio streams needed for HD instead of forcing legacy clients.
  for (const [quality, selector] of [
    ['best', 'bv*+ba/b'],
    ['1080', 'bv*[height<=1080]+ba/b[height<=1080]/b'],
    ['720', 'bv*[height<=720]+ba/b[height<=720]/b']
  ]) {
    const args = buildArgs({ url: 'https://www.youtube.com/watch?v=test', format: 'mp4', quality, targetDir: 'tmp-smoke' });
    assert.equal(args[args.indexOf('-f') + 1], selector);
    assert.ok(!args.includes('--extractor-args'), 'Do not force YouTube player clients');
    assert.equal(args.at(-1), 'https://www.youtube.com/watch?v=test');
  }
  const routes = collectRoutes(app);
  const publicConfig = buildPublicClientConfig();
  const indexHtml = await fs.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const frontendScript = await fs.readFile(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

  if (!hasRoute(routes, 'GET', '/health')) {
    throw new Error('GET /health ist nicht registriert.');
  }

  if (!hasRoute(routes, 'POST', '/api/download')) {
    throw new Error('POST /api/download ist nicht registriert.');
  }

  if (!hasRoute(routes, 'GET', '/api/status/:id')) {
    throw new Error('GET /api/status/:id ist nicht registriert.');
  }

  if (!hasRoute(routes, 'GET', '/api/file/:id')) {
    throw new Error('GET /api/file/:id ist nicht registriert.');
  }

  if (!hasRoute(routes, 'GET', '/app-config.js')) {
    throw new Error('GET /app-config.js ist nicht registriert.');
  }

  if (!indexHtml.includes('yt-dlp Download-Server')) {
    throw new Error('Die Startseite enthaelt nicht den erwarteten Titel.');
  }

  if (!frontendScript.includes('window.APP_CONFIG')) {
    throw new Error('Das Frontend verwendet keine APP_CONFIG-Konfiguration.');
  }

  if (typeof publicConfig.demoMode !== 'boolean') {
    throw new Error('Die oeffentliche Client-Konfiguration ist unvollstaendig.');
  }
}

main()
  .then(() => {
    console.log('Smoke test passed.');
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
